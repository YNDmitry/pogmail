package com.pogmail.android.data.cache

import com.pogmail.android.data.auth.MobileApiClient
import com.pogmail.android.data.auth.MobileSession

/** Applies every server batch before advancing its cursor, making retries safe. */
class MailSyncRepository(
    private val apiClient: MobileApiClient,
    private val database: MailCacheDatabase,
) {
    suspend fun sync(session: MobileSession) {
        var cursor = database.dao().cursor(MailCacheDatabase.SYNC_CURSOR_KEY) ?: 0
        do {
            val batch = apiClient.sync(session.accessToken, cursor)
            database.apply(batch)
            cursor = batch.cursor
        } while (batch.hasMore)
    }
}
