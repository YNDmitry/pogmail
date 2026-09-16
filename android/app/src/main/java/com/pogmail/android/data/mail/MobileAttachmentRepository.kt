package com.pogmail.android.data.mail

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.pogmail.android.BuildConfig
import com.pogmail.android.data.auth.MobileApiClient
import com.pogmail.android.data.auth.MobileApiException
import com.pogmail.android.data.auth.MobileMessageAttachment
import com.pogmail.android.data.auth.MobileSession
import com.pogmail.android.data.auth.MobileSessionRepository
import java.io.File
import java.io.IOException
import java.util.UUID

class MobileAttachmentRepository(
    private val apiClient: MobileApiClient,
    private val sessionRepository: MobileSessionRepository,
) {
    suspend fun download(
        context: Context,
        session: MobileSession,
        messageId: String,
        attachment: MobileMessageAttachment,
    ): AuthenticatedResult<DownloadedAttachment> {
        val directory = File(context.cacheDir, "attachments")
        if (!directory.exists() && !directory.mkdirs()) throw IOException("Could not prepare attachment storage.")
        val downloadDirectory = File(directory, UUID.randomUUID().toString())
        if (!downloadDirectory.mkdirs()) throw IOException("Could not prepare attachment storage.")
        val file = File(downloadDirectory, attachment.filename.safeFilename())
        val activeSession = sessionRepository.refreshIfExpiring(session)
        return try {
            AuthenticatedResult(activeSession, download(activeSession, messageId, attachment, file))
        } catch (error: MobileApiException) {
            if (error.statusCode != 401) throw error
            val refreshedSession = sessionRepository.refresh(activeSession)
            AuthenticatedResult(refreshedSession, download(refreshedSession, messageId, attachment, file))
        }
    }

    fun open(context: Context, attachment: DownloadedAttachment) {
        val uri = FileProvider.getUriForFile(context, "${BuildConfig.APPLICATION_ID}.attachments", attachment.file)
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, attachment.contentType)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(
            Intent.createChooser(view, "Open ${attachment.file.name}")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private suspend fun download(
        session: MobileSession,
        messageId: String,
        attachment: MobileMessageAttachment,
        file: File,
    ): DownloadedAttachment = DownloadedAttachment(
        file = file,
        contentType = apiClient.downloadAttachment(session.accessToken, messageId, attachment.id, file),
    )
}

data class DownloadedAttachment(
    val file: File,
    val contentType: String,
)

private fun String.safeFilename(): String = replace(Regex("[^A-Za-z0-9._-]"), "_")
    .trim('.', '_')
    .take(120)
    .ifBlank { "attachment" }
