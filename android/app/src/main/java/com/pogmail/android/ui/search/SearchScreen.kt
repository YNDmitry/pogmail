package com.pogmail.android.ui.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.pogmail.android.data.cache.CachedMessage
import com.pogmail.android.ui.model.MailPreview
import kotlinx.coroutines.flow.Flow

@Composable
fun SearchScreen(
    modifier: Modifier = Modifier,
    messages: Flow<List<CachedMessage>>,
    onOpenMessage: (MailPreview) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("All mail") }
    val cached by messages.collectAsState(emptyList())
    val results = cached
        .filter { message ->
            when (filter) {
                "Unread" -> !message.read
                "Attachments" -> message.hasAttachments
                else -> true
            }
        }
        .map { message ->
            MailPreview(
                message.id,
                message.fromName ?: message.fromAddress,
                message.fromAddress,
                message.subject ?: "(No subject)",
                message.snippet ?: "",
                "",
                !message.read,
                mailboxId = message.mailboxId,
                starred = message.starred,
            )
        }
        .filter { message ->
            query.isBlank() ||
                message.sender.contains(query, ignoreCase = true) ||
                message.subject.contains(query, ignoreCase = true) ||
                message.preview.contains(query, ignoreCase = true)
        }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .statusBarsPadding(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("Search", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
        }
        item {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                singleLine = true,
                placeholder = { Text("Search mail") },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("All mail", "Unread", "Attachments").forEach { item ->
                    FilterChip(
                        selected = filter == item,
                        onClick = { filter = item },
                        label = { Text(item) },
                    )
                }
            }
        }
        item {
            Text(
                text = if (query.isBlank()) "RECENT MESSAGES" else "RESULTS",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
            )
        }
        items(results, key = { it.id }) { message ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpenMessage(message) }
                    .padding(vertical = 4.dp),
            ) {
                Text(message.sender, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    message.subject,
                    modifier = Modifier.padding(top = 2.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    message.preview,
                    modifier = Modifier.padding(top = 3.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}
