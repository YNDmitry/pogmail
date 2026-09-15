package com.pogmail.android.data.auth

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class MobileSessionRepository(
    private val apiClient: MobileApiClient,
    private val tokenStore: SecureTokenStore,
) {
    private val refreshMutex = Mutex()

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

    /** Coalesces concurrent refreshes and renews before a request can expire in flight. */
    suspend fun refreshIfExpiring(session: MobileSession): MobileSession {
        if (session.accessTokenExpiresAt > System.currentTimeMillis() + ACCESS_TOKEN_SKEW_MS) return session
        return refreshMutex.withLock {
            val persisted = tokenStore.read()?.takeIf { it.deviceSessionId == session.deviceSessionId } ?: session
            if (persisted.accessTokenExpiresAt > System.currentTimeMillis() + ACCESS_TOKEN_SKEW_MS) persisted else refresh(persisted)
        }
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

    private companion object {
        const val ACCESS_TOKEN_SKEW_MS = 60_000L
    }
}
