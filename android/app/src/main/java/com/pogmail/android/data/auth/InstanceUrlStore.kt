package com.pogmail.android.data.auth

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.net.URI
import kotlinx.coroutines.flow.first

private val Context.instanceDataStore by preferencesDataStore(name = "pogmail_instance")
private val instanceUrlKey = stringPreferencesKey("base_url")

/** Public, user-selected Worker origin. Tokens remain in [SecureTokenStore]. */
class InstanceUrlStore(private val context: Context) {
    @Volatile
    private var cachedUrl: String? = null

    suspend fun restore(): String? {
        val stored = context.instanceDataStore.data.first()[instanceUrlKey] ?: return null
        return runCatching { normalize(stored) }
            .onFailure { clear() }
            .getOrNull()
            .also { cachedUrl = it }
    }

    suspend fun save(value: String): String {
        val normalized = normalize(value)
        context.instanceDataStore.edit { preferences -> preferences[instanceUrlKey] = normalized }
        cachedUrl = normalized
        return normalized
    }

    suspend fun clear() {
        context.instanceDataStore.edit { preferences -> preferences.remove(instanceUrlKey) }
        cachedUrl = null
    }

    fun requireUrl(): String = cachedUrl
        ?: throw MobileApiException(400, "Choose a Pogmail URL first.")

    companion object {
        fun normalize(value: String): String {
            val uri = runCatching { URI(value.trim()) }
                .getOrElse { throw MobileApiException(400, "Enter a valid HTTPS URL.") }
            if (
                !uri.scheme.equals("https", ignoreCase = true) ||
                uri.host.isNullOrBlank() ||
                uri.userInfo != null ||
                uri.query != null ||
                uri.fragment != null ||
                (uri.path != null && uri.path != "/")
            ) {
                throw MobileApiException(400, "Enter the HTTPS address of a Pogmail instance.")
            }
            return URI("https", null, uri.host.lowercase(), uri.port, null, null, null).toString()
        }
    }
}
