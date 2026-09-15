package com.pogmail.android.data.auth

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException

class PasskeyAuthenticator(private val apiClient: MobileApiClient) {
    suspend fun signIn(activity: Activity): MobileSession {
        val options = apiClient.passkeyOptions()
        val request = GetCredentialRequest(
            credentialOptions = listOf(GetPublicKeyCredentialOption(options.requestJson)),
        )
        val credential = try {
            CredentialManager.create(activity).getCredential(activity, request).credential
        } catch (error: GetCredentialException) {
            val message = if (error is NoCredentialException) {
                "No passkey is available for this Pogmail domain."
            } else {
                "Passkey sign-in was not completed."
            }
            throw PasskeySignInException(message, error)
        }
        val assertion = (credential as? PublicKeyCredential)?.authenticationResponseJson
            ?: throw PasskeySignInException("The selected credential is not a passkey.")
        return apiClient.loginWithPasskey(options.challengeId, assertion)
    }
}

class PasskeySignInException(message: String, cause: Throwable? = null) : Exception(message, cause)
