package com.pogmail.android.data.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.first
import org.json.JSONObject

private val Context.mobileSessionDataStore by preferencesDataStore(name = "mobile_session")
private val encryptedSessionKey = stringPreferencesKey("encrypted_session")
private const val keyAlias = "pogmail.mobile.session.v1"

/** Stores the refresh token only as AES-GCM ciphertext backed by Android Keystore. */
class SecureTokenStore(private val context: Context) {
    suspend fun read(): MobileSession? {
        val encrypted = context.mobileSessionDataStore.data.first()[encryptedSessionKey] ?: return null
        return try {
            parse(decrypt(encrypted))
        } catch (_: Exception) {
            // A restored backup or a rotated Keystore key cannot be decrypted safely.
            clear()
            null
        }
    }

    suspend fun save(session: MobileSession) {
        context.mobileSessionDataStore.edit { preferences ->
            preferences[encryptedSessionKey] = encrypt(serialize(session))
        }
    }

    suspend fun clear() {
        context.mobileSessionDataStore.edit { preferences -> preferences.remove(encryptedSessionKey) }
    }

    private fun serialize(session: MobileSession): String = JSONObject()
        .put("deviceSessionId", session.deviceSessionId)
        .put("accessToken", session.accessToken)
        .put("accessTokenExpiresAt", session.accessTokenExpiresAt)
        .put("refreshToken", session.refreshToken)
        .put("refreshTokenExpiresAt", session.refreshTokenExpiresAt)
        .put("user", JSONObject().put("id", session.user.id).put("email", session.user.email).put("name", session.user.name))
        .toString()

    private fun parse(value: String): MobileSession {
        val json = JSONObject(value)
        val user = json.getJSONObject("user")
        return MobileSession(
            deviceSessionId = json.getString("deviceSessionId"),
            accessToken = json.getString("accessToken"),
            accessTokenExpiresAt = json.getLong("accessTokenExpiresAt"),
            refreshToken = json.getString("refreshToken"),
            refreshTokenExpiresAt = json.getLong("refreshTokenExpiresAt"),
            user = MobileUser(id = user.getString("id"), email = user.getString("email"), name = user.getString("name")),
        )
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val ciphertext = Base64.encodeToString(cipher.doFinal(value.encodeToByteArray()), Base64.NO_WRAP)
        return "$iv:$ciphertext"
    }

    private fun decrypt(value: String): String {
        val parts = value.split(":", limit = 2)
        require(parts.size == 2) { "Malformed encrypted mobile session" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            secretKey(),
            GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)),
        )
        return cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)).decodeToString()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }
}
