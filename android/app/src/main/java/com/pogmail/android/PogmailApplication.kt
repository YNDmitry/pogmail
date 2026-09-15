package com.pogmail.android

import android.app.Application
import com.pogmail.android.data.auth.MobileApiClient
import com.pogmail.android.data.auth.MobileSessionRepository
import com.pogmail.android.data.auth.SecureTokenStore

class PogmailApplication : Application() {
    val mobileSessionRepository: MobileSessionRepository by lazy {
        MobileSessionRepository(
            apiClient = MobileApiClient(BuildConfig.POGMAIL_API_BASE_URL),
            tokenStore = SecureTokenStore(applicationContext),
        )
    }
}
