package com.pogmail.android.ui.inbox

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

private data class InboxMessage(
    val id: String,
    val sender: String,
    val subject: String,
    val preview: String,
    val time: String,
    val unread: Boolean,
    val label: String? = null,
)

private val inboxMessages = listOf(
    InboxMessage(
        id = "1",
        sender = "Cloudflare",
        subject = "Your weekly traffic summary",
        preview = "Your domains handled 24,831 requests this week.",
        time = "09:42",
        unread = true,
        label = "Work",
    ),
    InboxMessage(
        id = "2",
        sender = "Alex Morgan",
        subject = "Design review — Thursday",
        preview = "I left a few comments on the latest inbox flow.",
        time = "08:17",
        unread = true,
    ),
    InboxMessage(
        id = "3",
        sender = "Figma",
        subject = "You were mentioned in Pogmail mobile",
        preview = "Mira mentioned you in a comment: looks ready for a pass.",
        time = "Yesterday",
        unread = false,
        label = "Updates",
    ),
    InboxMessage(
        id = "4",
        sender = "Linear",
        subject = "ENG-142 is ready for review",
        preview = "External account synchronization has moved to In review.",
        time = "Mon",
        unread = false,
    ),
)

private enum class DockDestination(val label: String) {
    Inbox("Inbox"),
    Search("Search"),
    Settings("Settings"),
}

@Composable
fun InboxScreen() {
    var selectedFilter by remember { mutableStateOf("Primary") }
    var selectedDestination by remember { mutableStateOf(DockDestination.Inbox) }
    val unreadCount = inboxMessages.count { it.unread }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { InboxTopBar() },
        bottomBar = {
            FloatingDock(
                selectedDestination = selectedDestination,
                onSelect = { selectedDestination = it },
                onCompose = {},
            )
        },
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                MailboxHeading(unreadCount)
            }
            item {
                FilterRow(
                    selected = selectedFilter,
                    onSelect = { selectedFilter = it },
                )
            }
            item {
                Text(
                    text = "TODAY",
                    modifier = Modifier.padding(top = 12.dp, start = 4.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            items(inboxMessages, key = { it.id }) { message ->
                MessageRow(message)
            }
            item {
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun InboxTopBar() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "Pogmail",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        IconButton(onClick = {}) {
            Icon(Icons.Outlined.Search, contentDescription = "Search mail")
        }
        Surface(
            modifier = Modifier.size(34.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text("DM", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun FloatingDock(
    selectedDestination: DockDestination,
    onSelect: (DockDestination) -> Unit,
    onCompose: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(30.dp),
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = 2.dp,
            shadowElevation = 14.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.72f)),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(64.dp)
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                DockItem(
                    destination = DockDestination.Inbox,
                    icon = Icons.Outlined.Inbox,
                    selected = selectedDestination == DockDestination.Inbox,
                    onSelect = onSelect,
                )
                DockItem(
                    destination = DockDestination.Search,
                    icon = Icons.Outlined.Search,
                    selected = selectedDestination == DockDestination.Search,
                    onSelect = onSelect,
                )
                ComposeDockAction(onClick = onCompose)
                DockItem(
                    destination = DockDestination.Settings,
                    icon = Icons.Outlined.Settings,
                    selected = selectedDestination == DockDestination.Settings,
                    onSelect = onSelect,
                )
            }
        }
    }
}

@Composable
private fun RowScope.DockItem(
    destination: DockDestination,
    icon: ImageVector,
    selected: Boolean,
    onSelect: (DockDestination) -> Unit,
) {
    val itemShape = RoundedCornerShape(18.dp)
    val contentColor = if (selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Column(
        modifier = Modifier
            .weight(1f)
            .clip(itemShape)
            .background(
                color = MaterialTheme.colorScheme.primary.copy(alpha = if (selected) 0.14f else 0f),
                shape = itemShape,
            )
            .clickable { onSelect(destination) }
            .padding(vertical = 7.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = destination.label,
            tint = contentColor,
        )
        Text(
            text = destination.label,
            modifier = Modifier.padding(top = 2.dp),
            color = contentColor,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

@Composable
private fun RowScope.ComposeDockAction(onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .size(48.dp)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        shadowElevation = 8.dp,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Edit, contentDescription = "Compose message")
        }
    }
}

@Composable
private fun MailboxHeading(unreadCount: Int) {
    Column(modifier = Modifier.padding(horizontal = 4.dp, vertical = 12.dp)) {
        Text(
            text = "Inbox",
            style = MaterialTheme.typography.displaySmall,
            fontWeight = FontWeight.Bold,
        )
        Row(
            modifier = Modifier.padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "dmitry@pogmail.dev",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.width(8.dp))
            AssistChip(
                onClick = {},
                label = { Text("$unreadCount unread") },
                leadingIcon = {
                    Icon(
                        Icons.Outlined.Archive,
                        modifier = Modifier.size(16.dp),
                        contentDescription = null,
                    )
                },
                colors = AssistChipDefaults.assistChipColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
            )
        }
    }
}

@Composable
private fun FilterRow(selected: String, onSelect: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("Primary", "Unread", "Starred").forEach { filter ->
            FilterChip(
                selected = selected == filter,
                onClick = { onSelect(filter) },
                label = { Text(filter) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primary,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
                ),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MessageRow(message: InboxMessage) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .clickable(onClick = {}),
        color = if (message.unread) {
            MaterialTheme.colorScheme.surfaceVariant
        } else {
            MaterialTheme.colorScheme.surface
        },
        shape = RoundedCornerShape(18.dp),
        tonalElevation = if (message.unread) 1.dp else 0.dp,
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.Top,
        ) {
            SenderAvatar(message.sender)
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = message.sender,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = if (message.unread) FontWeight.Bold else FontWeight.Medium,
                    )
                    Text(
                        text = message.time,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                Text(
                    text = message.subject,
                    modifier = Modifier.padding(top = 3.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (message.unread) FontWeight.SemiBold else FontWeight.Normal,
                )
                Text(
                    text = message.preview,
                    modifier = Modifier.padding(top = 3.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
                if (message.label != null) {
                    Text(
                        text = message.label,
                        modifier = Modifier.padding(top = 8.dp),
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

@Composable
private fun SenderAvatar(sender: String) {
    Surface(
        modifier = Modifier.size(40.dp),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
        contentColor = MaterialTheme.colorScheme.primary,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                text = sender.take(1).uppercase(),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
