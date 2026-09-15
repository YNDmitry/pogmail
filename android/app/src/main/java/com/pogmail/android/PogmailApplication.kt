package com.pogmail.android

import android.app.Application
import com.pogmail.android.data.auth.MobileApiClient
import com.pogmail.android.data.auth.InstanceUrlStore
import com.pogmail.android.data.auth.MobileSessionRepository
import com.pogmail.android.data.auth.PasskeyAuthenticator
import com.pogmail.android.data.auth.SecureTokenStore
import com.pogmail.android.data.cache.MailCacheDatabase
import com.pogmail.android.data.cache.MailSyncRepository

class PogmailApplication : Application() {
    val instanceUrlStore by lazy { InstanceUrlStore(applicationContext) }
    val mobileApiClient by lazy { MobileApiClient(instanceUrlStore) }
    val mailCacheDatabase by lazy { MailCacheDatabase.create(applicationContext) }

    val mobileSessionRepository: MobileSessionRepository by lazy {
        MobileSessionRepository(
            apiClient = mobileApiClient,
            tokenStore = SecureTokenStore(applicationContext),
        )
    }

    val passkeyAuthenticator by lazy { PasskeyAuthenticator(mobileApiClient) }

    val mailSyncRepository: MailSyncRepository by lazy {
        MailSyncRepository(mobileApiClient, mailCacheDatabase)
    }
}
