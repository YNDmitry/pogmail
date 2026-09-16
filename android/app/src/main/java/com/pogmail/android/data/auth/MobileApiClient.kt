package com.pogmail.android.data.auth

import android.os.Build
import com.pogmail.android.BuildConfig
import com.pogmail.android.data.cache.CachedFolder
import com.pogmail.android.data.cache.CachedMailbox
import com.pogmail.android.data.cache.CachedMessage
import com.pogmail.android.data.cache.MailSyncBatch
import java.io.File
import java.net.URL
import java.net.URLEncoder
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MobileApiClient(private val instanceUrlStore: InstanceUrlStore) {
    suspend fun verifyInstance(value: String): String {
        val baseUrl = InstanceUrlStore.normalize(value)
        val status = requestJsonAt(baseUrl, "/api/setup/status", body = null, method = "GET")
        if (status.optBoolean("needsSetup", false)) {
            throw MobileApiException(409, "Finish initial setup for this Pogmail instance in the web app first.")
        }
        return baseUrl
    }

    suspend fun login(email: String, password: String): MobileSession = requestSession(
        path = "/auth/login",
        body = JSONObject()
            .put("email", email.trim())
            .put("password", password)
            .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(120))
            .put("appVersion", BuildConfig.VERSION_NAME),
    )

    suspend fun passkeyOptions(): PasskeyAuthenticationOptions {
        val response = requestJson("/auth/passkeys/options", JSONObject())
        return PasskeyAuthenticationOptions(
            challengeId = response.getString("challengeId"),
            requestJson = response.getJSONObject("publicKey").toString(),
        )
    }

    suspend fun loginWithPasskey(challengeId: String, credentialJson: String): MobileSession = requestSession(
        path = "/auth/passkeys/verify",
        body = JSONObject()
            .put("challengeId", challengeId)
            .put("credential", JSONObject(credentialJson))
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

    suspend fun message(accessToken: String, messageId: String): MobileMessageDetail = parseMessage(
        requestJson(
            "/messages/${URLEncoder.encode(messageId, Charsets.UTF_8)}",
            body = null,
            accessToken = accessToken,
            method = "GET",
        ),
    )

    suspend fun updateMessage(
        accessToken: String,
        messageId: String,
        read: Boolean? = null,
        starred: Boolean? = null,
        status: String? = null,
        folderId: String? = null,
        clearFolder: Boolean = false,
        snoozedUntil: Long? = null,
        clearSnooze: Boolean = false,
    ): MobileMessageState = requestJson(
        "/messages/${URLEncoder.encode(messageId, Charsets.UTF_8)}",
        JSONObject().apply {
            read?.let { put("read", it) }
            starred?.let { put("starred", it) }
            status?.let { put("status", it) }
            if (clearFolder) put("folderId", JSONObject.NULL) else folderId?.let { put("folderId", it) }
            if (clearSnooze) put("snoozedUntil", JSONObject.NULL) else snoozedUntil?.let { put("snoozedUntil", it) }
        },
        accessToken,
        method = "PATCH",
    ).let { response ->
        MobileMessageState(
            id = response.getString("id"),
            read = response.getBoolean("read"),
            starred = response.getBoolean("starred"),
            status = response.getString("status"),
            folderId = response.stringOrNull("folderId"),
            snoozedUntil = response.stringOrNull("snoozedUntil")?.let(::parseDate),
        )
    }

    suspend fun senders(accessToken: String): List<MobileSender> =
        requestJson("/senders", body = null, accessToken = accessToken, method = "GET")
            .getJSONArray("items")
            .mapItems { sender ->
                MobileSender(
                    id = sender.getString("id"),
                    address = sender.getString("address"),
                    displayName = sender.stringOrNull("displayName"),
                )
            }

    suspend fun send(accessToken: String, request: MobileComposeRequest): MobileSendResult =
        requestJson(
            "/send",
            JSONObject()
                .put("mailboxId", request.mailboxId)
                .put("to", org.json.JSONArray(request.recipients.map { address -> JSONObject().put("address", address) }))
                .put("subject", request.subject)
                .put("bodyText", request.bodyText)
                .apply { request.replyToMessageId?.let { put("replyToMessageId", it) } },
            accessToken,
        ).let { response -> MobileSendResult(response.getString("id"), response.getString("jobId")) }

    /** Downloads to app-private storage; callers expose it through FileProvider. */
    suspend fun downloadAttachment(
        accessToken: String,
        messageId: String,
        attachmentId: String,
        destination: File,
    ): String = withContext(Dispatchers.IO) {
        val encodedMessageId = URLEncoder.encode(messageId, Charsets.UTF_8)
        val encodedAttachmentId = URLEncoder.encode(attachmentId, Charsets.UTF_8)
        val baseUrl = instanceUrlStore.requireUrl()
        val connection = (URL("$baseUrl/api/mobile/messages/$encodedMessageId/attachments/$encodedAttachmentId").openConnection() as HttpsURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 60_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/octet-stream")
            setRequestProperty("User-Agent", "Pogmail-Android/${BuildConfig.VERSION_NAME}")
            setRequestProperty("Authorization", "Bearer $accessToken")
        }
        try {
            val status = connection.responseCode
            if (status !in 200..299) {
                val payload = connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                val message = runCatching { JSONObject(payload).optString("error") }
                    .getOrDefault("")
                    .ifBlank { "The server returned HTTP $status." }
                throw MobileApiException(status, message)
            }
            destination.parentFile?.mkdirs()
            connection.inputStream.use { input ->
                destination.outputStream().buffered().use { output -> input.copyTo(output) }
            }
            connection.contentType?.substringBefore(";")?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
        } catch (exception: Exception) {
            destination.delete()
            throw exception
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun requestSession(path: String, body: JSONObject): MobileSession =
        parseSession(requestJson(path, body))

    private suspend fun requestTokens(path: String, body: JSONObject): MobileSession =
        parseSession(requestJson(path, body), userRequired = false)

    private suspend fun requestJson(
        path: String,
        body: JSONObject?,
        accessToken: String? = null,
        method: String = "POST",
    ): JSONObject = requestJsonAt(instanceUrlStore.requireUrl(), "/api/mobile$path", body, accessToken, method)

    private suspend fun requestJsonAt(
        baseUrl: String,
        path: String,
        body: JSONObject?,
        accessToken: String? = null,
        method: String = "POST",
    ): JSONObject = withContext(Dispatchers.IO) {
        val connection = (URL("$baseUrl$path").openConnection() as HttpsURLConnection).apply {
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
                    .ifBlank {
                        when (status) {
                            404, 405 -> "This URL does not expose a Pogmail Worker."
                            else -> "The server returned HTTP $status."
                        }
                    }
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
                CachedMessage(item.getString("id"), item.getString("mailboxId"), item.stringOrNull("folderId"), item.getString("status"), item.stringOrNull("snoozedUntil")?.let(::parseDate), item.stringOrNull("subject"), item.getString("fromAddress"), item.stringOrNull("fromName"), item.stringOrNull("snippet"), parseDate(item.getString("receivedAt")), item.getBoolean("read"), item.getBoolean("starred"), item.getBoolean("hasAttachments"))
            },
            deletedMailboxIds = tombstones.filterItems { it.getString("resourceType") == "mailbox" }.map { it.getString("resourceId") },
            deletedFolderIds = tombstones.filterItems { it.getString("resourceType") == "folder" }.map { it.getString("resourceId") },
            deletedMessageIds = tombstones.filterItems { it.getString("resourceType") == "message" }.map { it.getString("resourceId") },
        )
    }

    private fun parseMessage(json: JSONObject): MobileMessageDetail = MobileMessageDetail(
        id = json.getString("id"),
        bodyText = json.stringOrNull("bodyText"),
        bodyHtml = json.stringOrNull("bodyHtml"),
        attachments = json.getJSONArray("attachments").mapItems { attachment ->
            MobileMessageAttachment(
                id = attachment.getString("id"),
                filename = attachment.getString("filename"),
                contentType = attachment.getString("contentType"),
                sizeBytes = attachment.getLong("sizeBytes"),
            )
        },
    )
}

data class PasskeyAuthenticationOptions(
    val challengeId: String,
    val requestJson: String,
)

data class MobileMessageDetail(
    val id: String,
    val bodyText: String?,
    /** Sanitised by the Worker. The native reader uses it only as a text fallback. */
    val bodyHtml: String?,
    val attachments: List<MobileMessageAttachment>,
)

data class MobileMessageAttachment(
    val id: String,
    val filename: String,
    val contentType: String,
    val sizeBytes: Long,
)

data class MobileMessageState(
    val id: String,
    val read: Boolean,
    val starred: Boolean,
    val status: String,
    val folderId: String?,
    val snoozedUntil: Long?,
)

data class MobileSender(
    val id: String,
    val address: String,
    val displayName: String?,
)

data class MobileComposeRequest(
    val mailboxId: String,
    val recipients: List<String>,
    val subject: String,
    val bodyText: String,
    val replyToMessageId: String? = null,
)

data class MobileSendResult(
    val messageId: String,
    val jobId: String,
)

private inline fun <T> org.json.JSONArray.mapItems(transform: (JSONObject) -> T): List<T> =
    List(length()) { index -> transform(getJSONObject(index)) }

private inline fun org.json.JSONArray.filterItems(predicate: (JSONObject) -> Boolean): List<JSONObject> =
    List(length()) { index -> getJSONObject(index) }.filter(predicate)

private fun JSONObject.stringOrNull(name: String): String? = if (isNull(name)) null else getString(name)
