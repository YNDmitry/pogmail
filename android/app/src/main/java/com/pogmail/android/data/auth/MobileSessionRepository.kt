package com.pogmail.android.data.auth

class MobileSessionRepository(
    private val apiClient: MobileApiClient,
    private val tokenStore: SecureTokenStore,
) {
    suspend fun restore(): MobileSession? = tokenStore.read()

    suspend fun login(email: String, password: String): MobileSession {
        val session = apiClient.login(email, password)
        tokenStore.save(session)
        return session
    }

    suspend fun refresh(session: MobileSession): MobileSession {
        val refreshed = apiClient.refresh(session)
        tokenStore.save(refreshed)
        return refreshed
    }

    suspend fun logout(session: MobileSession) {
        try {
            apiClient.logout(session.accessToken)
        } finally {
            // A local logout must also clear a potentially expired token offline.
            tokenStore.clear()
        }
    }

    /** Used when switching servers, where the old Worker may no longer be reachable. */
    suspend fun clearLocalSession() {
        tokenStore.clear()
    }
}
