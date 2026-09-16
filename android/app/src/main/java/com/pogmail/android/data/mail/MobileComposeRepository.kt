package com.pogmail.android.data.mail

import com.pogmail.android.data.auth.MobileApiClient
import com.pogmail.android.data.auth.MobileApiException
import com.pogmail.android.data.auth.MobileComposeRequest
import com.pogmail.android.data.auth.MobileSender
import com.pogmail.android.data.auth.MobileSendResult
import com.pogmail.android.data.auth.MobileSession
import com.pogmail.android.data.auth.MobileSessionRepository

class MobileComposeRepository(
    private val apiClient: MobileApiClient,
    private val sessionRepository: MobileSessionRepository,
) {
    suspend fun senders(session: MobileSession): AuthenticatedSenders = authenticated(session) { active ->
        apiClient.senders(active.accessToken)
    }

    suspend fun send(session: MobileSession, request: MobileComposeRequest): AuthenticatedSend = authenticated(session) { active ->
        apiClient.send(active.accessToken, request)
    }

    private suspend fun <T> authenticated(
        session: MobileSession,
        request: suspend (MobileSession) -> T,
    ): AuthenticatedResult<T> {
        val activeSession = sessionRepository.refreshIfExpiring(session)
        return try {
            AuthenticatedResult(activeSession, request(activeSession))
        } catch (error: MobileApiException) {
            if (error.statusCode != 401) throw error
            val refreshedSession = sessionRepository.refresh(activeSession)
            AuthenticatedResult(refreshedSession, request(refreshedSession))
        }
    }
}

data class AuthenticatedResult<T>(
    val session: MobileSession,
    val value: T,
)

typealias AuthenticatedSenders = AuthenticatedResult<List<MobileSender>>
typealias AuthenticatedSend = AuthenticatedResult<MobileSendResult>
