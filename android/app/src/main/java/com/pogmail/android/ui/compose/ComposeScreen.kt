package com.pogmail.android.ui.compose

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.pogmail.android.data.auth.MobileComposeRequest
import com.pogmail.android.data.auth.MobileSender
import com.pogmail.android.data.auth.MobileSession
import com.pogmail.android.data.mail.MobileComposeRepository
import kotlinx.coroutines.launch

data class ComposeDraft(
    val recipient: String = "",
    val subject: String = "",
    val body: String = "",
    val mailboxId: String? = null,
    val replyToMessageId: String? = null,
)

@Composable
fun ComposeScreen(
    modifier: Modifier = Modifier,
    session: MobileSession,
    composeRepository: MobileComposeRepository,
    initialDraft: ComposeDraft? = null,
    onSessionUpdated: (MobileSession) -> Unit,
    onClose: () -> Unit,
    onSent: (MobileSession) -> Unit,
) {
    var recipient by remember(initialDraft) { mutableStateOf(initialDraft?.recipient.orEmpty()) }
    var subject by remember(initialDraft) { mutableStateOf(initialDraft?.subject.orEmpty()) }
    var body by remember(initialDraft) { mutableStateOf(initialDraft?.body.orEmpty()) }
    var senders by remember { mutableStateOf<List<MobileSender>>(emptyList()) }
    var selectedSenderId by remember(initialDraft) { mutableStateOf(initialDraft?.mailboxId) }
    var loadingSenders by remember { mutableStateOf(true) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(session.deviceSessionId) {
        loadingSenders = true
        try {
            val loaded = composeRepository.senders(session)
            senders = loaded.value
            selectedSenderId = selectedSenderId?.takeIf { requested -> senders.any { it.id == requested } }
                ?: senders.firstOrNull()?.id
            if (loaded.session != session) onSessionUpdated(loaded.session)
        } catch (exception: Exception) {
            error = exception.message ?: "Could not load sender addresses."
        } finally {
            loadingSenders = false
        }
    }

    val selectedSender = senders.firstOrNull { it.id == selectedSenderId }
    Column(
        modifier = modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        ComposeToolbar(
            isSending = sending,
            canSend = selectedSender != null && recipient.isNotBlank() && !loadingSenders,
            onClose = onClose,
            onSend = {
                val recipients = recipient.split(',', ';', '\n').map { it.trim() }.filter { it.isNotEmpty() }
                if (recipients.isEmpty()) {
                    error = "Add at least one recipient."
                    return@ComposeToolbar
                }
                scope.launch {
                    sending = true
                    error = null
                    try {
                        val sent = composeRepository.sendDraft(
                            session,
                            MobileComposeRequest(
                                mailboxId = requireNotNull(selectedSender).id,
                                recipients = recipients,
                                subject = subject,
                                bodyText = body,
                                replyToMessageId = initialDraft?.replyToMessageId,
                            ),
                        )
                        if (sent.session != session) onSessionUpdated(sent.session)
                        onSent(sent.session)
                    } catch (exception: Exception) {
                        error = exception.message ?: "Could not queue this message."
                    } finally {
                        sending = false
                    }
                }
            },
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        when {
            loadingSenders -> Box(
                modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }
            else -> SenderPicker(
                senders = senders,
                selectedSenderId = selectedSenderId,
                onSelect = { selectedSenderId = it },
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        ComposeField(value = recipient, onValueChange = { recipient = it }, placeholder = "To")
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        ComposeField(value = subject, onValueChange = { subject = it }, placeholder = "Subject")
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        TextField(
            value = body,
            onValueChange = { body = it },
            modifier = Modifier.fillMaxWidth().weight(1f),
            placeholder = { Text("Write a message…") },
            colors = composeFieldColors(),
        )
        error?.let {
            Text(
                text = it,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Text(
            text = "Messages are queued securely and sent by your Pogmail workspace.",
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun ComposeToolbar(
    isSending: Boolean,
    canSend: Boolean,
    onClose: () -> Unit,
    onSend: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onClose, enabled = !isSending) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Close composer")
        }
        Text(
            "New message",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        TextButton(onClick = onSend, enabled = canSend && !isSending) {
            if (isSending) {
                CircularProgressIndicator(modifier = Modifier.padding(end = 6.dp), strokeWidth = 2.dp)
            } else {
                Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = null, modifier = Modifier.padding(end = 6.dp))
            }
            Text(if (isSending) "Sending" else "Send")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SenderPicker(
    senders: List<MobileSender>,
    selectedSenderId: String?,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selected = senders.firstOrNull { it.id == selectedSenderId }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        TextField(
            value = selected?.address ?: "No sender address is available",
            onValueChange = {},
            readOnly = true,
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
            label = { Text("From") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            colors = composeFieldColors(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            senders.forEach { sender ->
                DropdownMenuItem(
                    text = { Text(sender.displayName?.let { "$it <${sender.address}>" } ?: sender.address) },
                    onClick = {
                        onSelect(sender.id)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun ComposeField(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    TextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        placeholder = { Text(placeholder) },
        colors = composeFieldColors(),
    )
}

@Composable
private fun composeFieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = MaterialTheme.colorScheme.background,
    unfocusedContainerColor = MaterialTheme.colorScheme.background,
    focusedIndicatorColor = MaterialTheme.colorScheme.background,
    unfocusedIndicatorColor = MaterialTheme.colorScheme.background,
)
