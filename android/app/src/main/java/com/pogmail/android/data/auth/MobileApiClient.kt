package com.pogmail.android.data.auth

import android.os.Build
import com.pogmail.android.BuildConfig
import com.pogmail.android.data.cache.CachedFolder
import com.pogmail.android.data.cache.CachedMailbox
import com.pogmail.android.data.cache.CachedMessage
import com.pogmail.android.data.cache.MailSyncBatch
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

    suspend fun sync(accessToken: String, cursor: Long): MailSyncBatch = parseSync(
        requestJson("/sync?cursor=$cursor", body = null, accessToken = accessToken, method = "GET"),
    )

    private suspend fun requestSession(path: String, body: JSONObject): MobileSession =
        parseSession(requestJson(path, body))

    private suspend fun requestTokens(path: String, body: JSONObject): MobileSession =
        parseSession(requestJson(path, body), userRequired = false)

    private suspend fun requestJson(
        path: String,
        body: JSONObject?,
        accessToken: String? = null,
        method: String = "POST",
    ): JSONObject = withContext(Dispatchers.IO) {
        val connection = (URL("$baseUrl/api/mobile$path").openConnection() as HttpsURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = false
            doOutput = body != null
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("User-Agent", "Pogmail-Android/${BuildConfig.VERSION_NAME}")
            accessToken?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        try {
            body?.let { connection.outputStream.bufferedWriter(Charsets.UTF_8).use { writer -> writer.write(it.toString()) } }
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

    private fun parseSync(json: JSONObject): MailSyncBatch {
        val tombstones = json.getJSONArray("tombstones")
        return MailSyncBatch(
            cursor = json.getLong("cursor"),
            hasMore = json.getBoolean("hasMore"),
            mailboxes = json.getJSONArray("mailboxes").mapItems { item ->
                CachedMailbox(item.getString("id"), item.getString("address"), item.stringOrNull("displayName"), item.getString("source"), item.getBoolean("disabled"))
            },
            folders = json.getJSONArray("folders").mapItems { item ->
                CachedFolder(item.getString("id"), item.getString("mailboxId"), item.getString("name"), item.stringOrNull("color"), item.getInt("position"))
            },
            messages = json.getJSONArray("messages").mapItems { item ->
                CachedMessage(item.getString("id"), item.getString("mailboxId"), item.stringOrNull("folderId"), item.stringOrNull("subject"), item.getString("fromAddress"), item.stringOrNull("fromName"), item.stringOrNull("snippet"), parseDate(item.getString("receivedAt")), item.getBoolean("read"), item.getBoolean("starred"), item.getBoolean("hasAttachments"))
            },
            deletedMailboxIds = tombstones.filterItems { it.getString("resourceType") == "mailbox" }.map { it.getString("resourceId") },
            deletedFolderIds = tombstones.filterItems { it.getString("resourceType") == "folder" }.map { it.getString("resourceId") },
            deletedMessageIds = tombstones.filterItems { it.getString("resourceType") == "message" }.map { it.getString("resourceId") },
        )
    }
}

private inline fun <T> org.json.JSONArray.mapItems(transform: (JSONObject) -> T): List<T> =
    List(length()) { index -> transform(getJSONObject(index)) }

private inline fun org.json.JSONArray.filterItems(predicate: (JSONObject) -> Boolean): List<JSONObject> =
    List(length()) { index -> getJSONObject(index) }.filter(predicate)

private fun JSONObject.stringOrNull(name: String): String? = if (isNull(name)) null else getString(name)

private fun requireSecureBaseUrl(value: String) {
    val uri = runCatching { URI(value) }.getOrElse { throw IllegalArgumentException("Invalid API base URL") }
    require(uri.scheme == "https" && !uri.host.isNullOrBlank()) { "Pogmail API URL must use HTTPS" }
}
