package com.pogmail.android.data.auth

data class MobileUser(
    val id: String,
    val email: String,
    val name: String,
)

/** The only long-lived app credential is persisted through [SecureTokenStore]. */
data class MobileSession(
    val deviceSessionId: String,
    val accessToken: String,
    val accessTokenExpiresAt: Long,
    val refreshToken: String,
    val refreshTokenExpiresAt: Long,
    val user: MobileUser,
)

class MobileApiException(
    val statusCode: Int,
    override val message: String,
) : Exception(message)
