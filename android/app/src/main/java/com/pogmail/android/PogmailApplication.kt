package com.pogmail.android

import android.app.Application
import com.pogmail.android.data.auth.MobileApiClient
import com.pogmail.android.data.auth.MobileSessionRepository
import com.pogmail.android.data.auth.SecureTokenStore
import com.pogmail.android.data.cache.MailCacheDatabase
import com.pogmail.android.data.cache.MailSyncRepository

class PogmailApplication : Application() {
    private val apiClient by lazy { MobileApiClient(BuildConfig.POGMAIL_API_BASE_URL) }

    val mobileSessionRepository: MobileSessionRepository by lazy {
        MobileSessionRepository(
            apiClient = apiClient,
            tokenStore = SecureTokenStore(applicationContext),
        )
    }

    val mailSyncRepository: MailSyncRepository by lazy {
        MailSyncRepository(apiClient, MailCacheDatabase.create(applicationContext))
    }
}
