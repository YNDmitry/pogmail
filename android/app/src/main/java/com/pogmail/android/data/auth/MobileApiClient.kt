package com.pogmail.android.data.auth

import android.os.Build
import com.pogmail.android.BuildConfig
import java.net.URI
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MobileApiClient(baseUrl: String) {
    private val baseUrl = baseUrl.trimEnd('/').also(::requireSecureBaseUrl)

    suspend fun login(email: String, password: String): MobileSession = requestSession(
        path = "/auth/login",
        body = JSONObject()
            .put("email", email.trim())
            .put("password", password)
            .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(120))
            .put("appVersion", BuildConfig.VERSION_NAME),
    )

    suspend fun refresh(session: MobileSession): MobileSession {
        val refreshed = requestTokens(
            path = "/auth/refresh",
            body = JSONObject()
                .put("refreshToken", session.refreshToken)
                .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(120))
                .put("appVersion", BuildConfig.VERSION_NAME),
        )
        return refreshed.copy(user = session.user)
    }

    suspend fun logout(accessToken: String) {
        requestJson("/auth/logout", JSONObject(), accessToken)
    }

    private suspend fun requestSession(path: String, body: JSONObject): MobileSession =
        parseSession(requestJson(path, body))

    private suspend fun requestTokens(path: String, body: JSONObject): MobileSession =
        parseSession(requestJson(path, body), userRequired = false)

    private suspend fun requestJson(path: String, body: JSONObject, accessToken: String? = null): JSONObject = withContext(Dispatchers.IO) {
        val connection = (URL("$baseUrl/api/mobile$path").openConnection() as HttpsURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = false
            doOutput = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("User-Agent", "Pogmail-Android/${BuildConfig.VERSION_NAME}")
            accessToken?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        try {
            connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body.toString()) }
            val status = connection.responseCode
            val payload = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)
                ?.use { it.readText() }
                .orEmpty()
            if (status !in 200..299) {
                val message = runCatching { JSONObject(payload).optString("error") }
                    .getOrDefault("")
                    .ifBlank { "Request failed" }
                throw MobileApiException(status, message)
            }
            JSONObject(payload)
        } finally {
            connection.disconnect()
        }
    }

    private fun parseSession(json: JSONObject, userRequired: Boolean = true): MobileSession {
        val user = json.optJSONObject("user")
        if (userRequired && user == null) throw MobileApiException(502, "Invalid server response")
        return MobileSession(
            deviceSessionId = json.getString("deviceSessionId"),
            accessToken = json.getString("accessToken"),
            accessTokenExpiresAt = json.getString("accessTokenExpiresAt").let(::parseDate),
            refreshToken = json.getString("refreshToken"),
            refreshTokenExpiresAt = json.getString("refreshTokenExpiresAt").let(::parseDate),
            user = user?.let { MobileUser(it.getString("id"), it.getString("email"), it.getString("name")) }
                ?: MobileUser("", "", ""),
        )
    }

    private fun parseDate(value: String): Long = java.time.Instant.parse(value).toEpochMilli()
}

private fun requireSecureBaseUrl(value: String) {
    val uri = runCatching { URI(value) }.getOrElse { throw IllegalArgumentException("Invalid API base URL") }
    require(uri.scheme == "https" && !uri.host.isNullOrBlank()) { "Pogmail API URL must use HTTPS" }
}
