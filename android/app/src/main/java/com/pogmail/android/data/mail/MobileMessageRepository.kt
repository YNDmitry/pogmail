package com.pogmail.android.data.mail

import com.pogmail.android.data.auth.MobileApiClient
import com.pogmail.android.data.auth.MobileApiException
import com.pogmail.android.data.auth.MobileMessageDetail
import com.pogmail.android.data.auth.MobileSession
import com.pogmail.android.data.auth.MobileSessionRepository

class MobileMessageRepository(
    private val apiClient: MobileApiClient,
    private val sessionRepository: MobileSessionRepository,
) {
    suspend fun load(session: MobileSession, messageId: String): LoadedMobileMessage {
        val activeSession = sessionRepository.refreshIfExpiring(session)
        return try {
            LoadedMobileMessage(activeSession, apiClient.message(activeSession.accessToken, messageId))
        } catch (error: MobileApiException) {
            if (error.statusCode != 401) throw error
            val refreshedSession = sessionRepository.refresh(activeSession)
            LoadedMobileMessage(refreshedSession, apiClient.message(refreshedSession.accessToken, messageId))
        }
    }
}

data class LoadedMobileMessage(
    val session: MobileSession,
    val message: MobileMessageDetail,
)
