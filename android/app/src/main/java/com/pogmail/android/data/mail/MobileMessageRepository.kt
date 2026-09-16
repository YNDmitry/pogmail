package com.pogmail.android.data.mail

import com.pogmail.android.data.auth.MobileApiClient
import com.pogmail.android.data.auth.MobileApiException
import com.pogmail.android.data.auth.MobileMessageDetail
import com.pogmail.android.data.auth.MobileMessageState
import com.pogmail.android.data.auth.MobileSession
import com.pogmail.android.data.auth.MobileSessionRepository

class MobileMessageRepository(
    private val apiClient: MobileApiClient,
    private val sessionRepository: MobileSessionRepository,
) {
    suspend fun updateMany(session: MobileSession, ids: List<String>, read: Boolean? = null, status: String? = null): MobileSession {
        val active = sessionRepository.refreshIfExpiring(session)
        try { apiClient.updateMessages(active.accessToken, ids, read, status); return active }
        catch (error: MobileApiException) {
            if (error.statusCode != 401) throw error
            val refreshed = sessionRepository.refresh(active)
            apiClient.updateMessages(refreshed.accessToken, ids, read, status)
            return refreshed
        }
    }
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

    suspend fun update(
        session: MobileSession,
        messageId: String,
        read: Boolean? = null,
        starred: Boolean? = null,
        status: String? = null,
        folderId: String? = null,
        clearFolder: Boolean = false,
        snoozedUntil: Long? = null,
        clearSnooze: Boolean = false,
    ): UpdatedMobileMessage {
        val activeSession = sessionRepository.refreshIfExpiring(session)
        return try {
            UpdatedMobileMessage(activeSession, apiClient.updateMessage(activeSession.accessToken, messageId, read, starred, status, folderId, clearFolder, snoozedUntil, clearSnooze))
        } catch (error: MobileApiException) {
            if (error.statusCode != 401) throw error
            val refreshedSession = sessionRepository.refresh(activeSession)
            UpdatedMobileMessage(refreshedSession, apiClient.updateMessage(refreshedSession.accessToken, messageId, read, starred, status, folderId, clearFolder, snoozedUntil, clearSnooze))
        }
    }
}

data class LoadedMobileMessage(
    val session: MobileSession,
    val message: MobileMessageDetail,
)

data class UpdatedMobileMessage(
    val session: MobileSession,
    val message: MobileMessageState,
)
