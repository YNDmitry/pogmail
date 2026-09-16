package com.pogmail.android.ui.mail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.pogmail.android.data.auth.MobileMessageDetail
import com.pogmail.android.data.auth.MobileSession
import com.pogmail.android.data.mail.MobileMessageRepository
import com.pogmail.android.ui.model.MailPreview

@Composable
fun MessageDetailScreen(
    modifier: Modifier = Modifier,
    message: MailPreview,
    session: MobileSession,
    messageRepository: MobileMessageRepository,
    onSessionUpdated: (MobileSession) -> Unit,
    onReply: () -> Unit,
    onBack: () -> Unit,
) {
    var detail by remember(message.id) { mutableStateOf<MobileMessageDetail?>(null) }
    var error by remember(message.id) { mutableStateOf<String?>(null) }
    var loading by remember(message.id) { mutableStateOf(true) }
    var reloadKey by remember(message.id) { mutableIntStateOf(0) }

    LaunchedEffect(message.id, reloadKey) {
        loading = true
        error = null
        try {
            val loaded = messageRepository.load(session, message.id)
            detail = loaded.message
            if (loaded.session != session) onSessionUpdated(loaded.session)
        } catch (exception: Exception) {
            error = exception.message ?: "Could not load this message."
        } finally {
            loading = false
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        ReaderToolbar(onBack = onBack)
        Text(message.subject, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        SenderHeader(message)

        when {
            loading -> Box(
                modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }
            error != null -> ReaderError(
                message = error.orEmpty(),
                onRetry = { reloadKey += 1 },
            )
            detail != null -> MessageBody(detail!!, onReply)
        }
    }
}

@Composable
private fun ReaderToolbar(onBack: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back to inbox")
        }
        Spacer(Modifier.weight(1f))
        IconButton(onClick = {}, enabled = false) {
            Icon(Icons.Outlined.MoreHoriz, contentDescription = "Message options")
        }
    }
}

@Composable
private fun SenderHeader(message: MailPreview) {
    Row(
        modifier = Modifier.padding(top = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(42.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
            contentColor = MaterialTheme.colorScheme.primary,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(message.sender.take(1).uppercase(), fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(message.sender, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text(
                "${message.senderAddress} · ${message.time}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun MessageBody(detail: MobileMessageDetail, onReply: () -> Unit) {
    val text = detail.bodyText?.takeIf { it.isNotBlank() }
        ?: detail.bodyHtml?.toPlainText()?.takeIf { it.isNotBlank() }
        ?: "This message has no readable text."
    Text(
        text = text,
        modifier = Modifier.padding(top = 28.dp),
        style = MaterialTheme.typography.bodyLarge,
    )
    if (detail.attachments.isNotEmpty()) {
        Text(
            text = "Attachments",
            modifier = Modifier.padding(top = 28.dp, bottom = 8.dp),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            detail.attachments.forEach { attachment ->
                AssistChip(
                    onClick = {},
                    enabled = false,
                    label = { Text("${attachment.filename} · ${attachment.sizeBytes.asFileSize()}") },
                    leadingIcon = { Icon(Icons.Outlined.AttachFile, contentDescription = null) },
                )
            }
        }
    }
    OutlinedButton(
        onClick = onReply,
        modifier = Modifier.padding(top = 28.dp, bottom = 36.dp),
    ) {
        Icon(Icons.AutoMirrored.Outlined.Reply, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
        Text("Reply")
    }
}

@Composable
private fun ReaderError(message: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = onRetry, modifier = Modifier.padding(top = 16.dp)) {
            Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
            Text("Try again")
        }
    }
}

private fun String.toPlainText(): String = replace(Regex("(?i)<br\\s*/?>"), "\n")
    .replace(Regex("(?i)</(p|div|li|h[1-6])>"), "\n")
    .replace(Regex("<[^>]*>"), "")
    .replace(Regex("\n{3,}"), "\n\n")
    .trim()

private fun Long.asFileSize(): String = when {
    this < 1_024 -> "$this B"
    this < 1_024 * 1_024 -> "${this / 1_024} KB"
    else -> "${"%.1f".format(this / (1_024.0 * 1_024.0))} MB"
}
