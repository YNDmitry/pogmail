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
import androidx.compose.material.icons.automirrored.outlined.ReplyAll
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Forward
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Report
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.pogmail.android.data.auth.MobileMessageAttachment
import com.pogmail.android.data.auth.MobileMessageDetail
import com.pogmail.android.data.auth.MobileMessageState
import com.pogmail.android.data.auth.MobileSession
import com.pogmail.android.data.cache.CachedFolder
import com.pogmail.android.data.mail.MobileAttachmentRepository
import com.pogmail.android.data.mail.MobileMessageRepository
import com.pogmail.android.ui.model.MailPreview
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow

@Composable
fun MessageDetailScreen(
    modifier: Modifier = Modifier,
    message: MailPreview,
    session: MobileSession,
    attachmentRepository: MobileAttachmentRepository,
    messageRepository: MobileMessageRepository,
    folders: Flow<List<CachedFolder>>,
    onSessionUpdated: (MobileSession) -> Unit,
    onMessageStateChanged: (MobileMessageState) -> Unit,
    onReply: () -> Unit,
    onReplyAll: (List<String>) -> Unit,
    onForward: (String) -> Unit,
    onBack: () -> Unit,
) {
    var detail by remember(message.id) { mutableStateOf<MobileMessageDetail?>(null) }
    var error by remember(message.id) { mutableStateOf<String?>(null) }
    var loading by remember(message.id) { mutableStateOf(true) }
    var reloadKey by remember(message.id) { mutableIntStateOf(0) }
    var openingAttachmentId by remember(message.id) { mutableStateOf<String?>(null) }
    var attachmentError by remember(message.id) { mutableStateOf<String?>(null) }
    var actionError by remember(message.id) { mutableStateOf<String?>(null) }
    var starred by remember(message.id) { mutableStateOf(message.starred) }
    var updatingStar by remember(message.id) { mutableStateOf(false) }
    var actionMenuOpen by remember(message.id) { mutableStateOf(false) }
    var updatingAction by remember(message.id) { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val cachedFolders by folders.collectAsState(emptyList())

    LaunchedEffect(message.id, reloadKey) {
        loading = true
        error = null
        try {
            val loaded = messageRepository.load(session, message.id)
            detail = loaded.message
            if (loaded.session != session) onSessionUpdated(loaded.session)
            if (message.unread) {
                runCatching { messageRepository.update(loaded.session, message.id, read = true) }
                    .onSuccess { updated ->
                        if (updated.session != loaded.session) onSessionUpdated(updated.session)
                        onMessageStateChanged(updated.message)
                    }
            }
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
        ReaderToolbar(
            starred = starred,
            updatingStar = updatingStar,
            onToggleStar = {
                scope.launch {
                    updatingStar = true
                    actionError = null
                    try {
                        val updated = messageRepository.update(session, message.id, starred = !starred)
                        starred = updated.message.starred
                        if (updated.session != session) onSessionUpdated(updated.session)
                        onMessageStateChanged(updated.message)
                    } catch (exception: Exception) {
                        actionError = exception.message ?: "Could not update this message."
                    } finally {
                        updatingStar = false
                    }
                }
            },
            actionMenuOpen = actionMenuOpen,
            updatingAction = updatingAction,
            onActionMenuChange = { actionMenuOpen = it },
            onAction = { status, snoozedUntil, clearSnooze ->
                scope.launch {
                    updatingAction = true
                    actionError = null
                    try {
                        val updated = messageRepository.update(
                            session = session,
                            messageId = message.id,
                            status = status,
                            clearFolder = status != null,
                            snoozedUntil = snoozedUntil,
                            clearSnooze = status != null || clearSnooze,
                        )
                        if (updated.session != session) onSessionUpdated(updated.session)
                        onMessageStateChanged(updated.message)
                        if (status != null || snoozedUntil != null || clearSnooze) onBack()
                    } catch (exception: Exception) {
                        actionError = exception.message ?: "Could not update this message."
                    } finally {
                        updatingAction = false
                    }
                }
            },
            onReplyAll = {
                val recipients = linkedSetOf<String>()
                detail?.replyTo?.let(recipients::add) ?: recipients.add(message.senderAddress)
                detail?.toAddresses.orEmpty().mapTo(recipients) { it.address }
                detail?.ccAddresses.orEmpty().mapTo(recipients) { it.address }
                recipients.removeAll { it.equals(session.user.email, ignoreCase = true) }
                detail?.mailboxAddress?.let { mailboxAddress ->
                    recipients.removeAll { it.equals(mailboxAddress, ignoreCase = true) }
                }
                onReplyAll(recipients.toList())
            },
            onForward = {
                val body = detail?.bodyText?.takeIf { it.isNotBlank() }
                    ?: detail?.bodyHtml?.toPlainText().orEmpty()
                onForward("\n\n--- Forwarded message ---\nFrom: ${message.senderAddress}\nSubject: ${message.subject}\n\n$body")
            },
            folders = cachedFolders.filter { it.mailboxId == message.mailboxId },
            onMoveToFolder = { folderId ->
                scope.launch {
                    updatingAction = true
                    actionError = null
                    try {
                        val updated = messageRepository.update(session, message.id, folderId = folderId)
                        if (updated.session != session) onSessionUpdated(updated.session)
                        onMessageStateChanged(updated.message)
                        onBack()
                    } catch (exception: Exception) {
                        actionError = exception.message ?: "Could not move this message."
                    } finally {
                        updatingAction = false
                    }
                }
            },
            onBack = onBack,
        )
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
            detail != null -> MessageBody(
                detail = detail!!,
                openingAttachmentId = openingAttachmentId,
                onOpenAttachment = { attachment ->
                    scope.launch {
                        openingAttachmentId = attachment.id
                        attachmentError = null
                        try {
                            val downloaded = attachmentRepository.download(context, session, message.id, attachment)
                            if (downloaded.session != session) onSessionUpdated(downloaded.session)
                            attachmentRepository.open(context, downloaded.value)
                        } catch (exception: Exception) {
                            attachmentError = exception.message ?: "Could not open this attachment."
                        } finally {
                            openingAttachmentId = null
                        }
                    }
                },
                onReply = onReply,
            )
        }
        attachmentError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        actionError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
}

@Suppress("DEPRECATION")
@Composable
private fun ReaderToolbar(
    starred: Boolean,
    updatingStar: Boolean,
    onToggleStar: () -> Unit,
    actionMenuOpen: Boolean,
    updatingAction: Boolean,
    onActionMenuChange: (Boolean) -> Unit,
    onAction: (status: String?, snoozedUntil: Long?, clearSnooze: Boolean) -> Unit,
    onReplyAll: () -> Unit,
    onForward: () -> Unit,
    folders: List<CachedFolder>,
    onMoveToFolder: (String) -> Unit,
    onBack: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back to inbox")
        }
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onToggleStar, enabled = !updatingStar) {
            Icon(
                imageVector = if (starred) Icons.Filled.Star else Icons.Outlined.Star,
                contentDescription = if (starred) "Remove star" else "Add star",
                tint = if (starred) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Box {
            IconButton(onClick = { onActionMenuChange(true) }, enabled = !updatingAction) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "Message actions")
            }
            DropdownMenu(expanded = actionMenuOpen, onDismissRequest = { onActionMenuChange(false) }) {
                if (updatingAction) {
                    DropdownMenuItem(text = { Text("Updating…") }, onClick = {}, enabled = false)
                } else {
                    DropdownMenuItem(
                        text = { Text("Reply all") },
                        onClick = { onActionMenuChange(false); onReplyAll() },
                        leadingIcon = { Icon(Icons.AutoMirrored.Outlined.ReplyAll, contentDescription = null) },
                    )
                    DropdownMenuItem(
                        text = { Text("Forward") },
                        onClick = { onActionMenuChange(false); onForward() },
                        leadingIcon = { Icon(Icons.Outlined.Forward, contentDescription = null) },
                    )
                    folders.forEach { folder ->
                        DropdownMenuItem(
                            text = { Text("Move to ${folder.name}") },
                            onClick = { onActionMenuChange(false); onMoveToFolder(folder.id) },
                            leadingIcon = { Icon(Icons.Outlined.Archive, contentDescription = null) },
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("Archive") },
                        onClick = { onActionMenuChange(false); onAction("archived", null, false) },
                        leadingIcon = { Icon(Icons.Outlined.Archive, contentDescription = null) },
                    )
                    DropdownMenuItem(
                        text = { Text("Move to inbox") },
                        onClick = { onActionMenuChange(false); onAction("received", null, false) },
                        leadingIcon = { Icon(Icons.Outlined.Archive, contentDescription = null) },
                    )
                    DropdownMenuItem(
                        text = { Text("Snooze until tomorrow") },
                        onClick = {
                            onActionMenuChange(false)
                            onAction(null, tomorrowAtNine(), false)
                        },
                        leadingIcon = { Icon(Icons.Outlined.Schedule, contentDescription = null) },
                    )
                    DropdownMenuItem(
                        text = { Text("Move to spam") },
                        onClick = { onActionMenuChange(false); onAction("spam", null, false) },
                        leadingIcon = { Icon(Icons.Outlined.Report, contentDescription = null) },
                    )
                    DropdownMenuItem(
                        text = { Text("Move to trash") },
                        onClick = { onActionMenuChange(false); onAction("trash", null, false) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                    )
                }
            }
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
private fun MessageBody(
    detail: MobileMessageDetail,
    openingAttachmentId: String?,
    onOpenAttachment: (MobileMessageAttachment) -> Unit,
    onReply: () -> Unit,
) {
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
                    onClick = { onOpenAttachment(attachment) },
                    enabled = openingAttachmentId == null,
                    label = {
                        Text(
                            if (openingAttachmentId == attachment.id) "Downloading ${attachment.filename}…"
                            else "${attachment.filename} · ${attachment.sizeBytes.asFileSize()}",
                        )
                    },
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

private fun tomorrowAtNine(): Long = java.time.ZonedDateTime.now()
    .plusDays(1)
    .withHour(9)
    .withMinute(0)
    .withSecond(0)
    .withNano(0)
    .toInstant()
    .toEpochMilli()
