package com.pogmail.android.ui.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.pogmail.android.data.auth.MobileSession
import com.pogmail.android.data.auth.MobileSessionRepository
import com.pogmail.android.ui.compose.ComposeScreen
import com.pogmail.android.ui.auth.LoginScreen
import com.pogmail.android.ui.inbox.InboxScreen
import com.pogmail.android.ui.mail.MessageDetailScreen
import com.pogmail.android.ui.model.MailPreview
import com.pogmail.android.ui.search.SearchScreen
import com.pogmail.android.ui.settings.MailAccountsScreen
import com.pogmail.android.ui.settings.ConnectMailAccountScreen
import com.pogmail.android.ui.settings.SettingsScreen
import kotlinx.coroutines.launch

private enum class AppDestination(val label: String) {
    Inbox("Inbox"),
    Search("Search"),
    Settings("Settings"),
    Compose("Compose"),
}

@Composable
fun PogmailApp(sessionRepository: MobileSessionRepository) {
    var sessionState by remember { mutableStateOf<SessionState>(SessionState.Restoring) }
    var loginError by remember { mutableStateOf<String?>(null) }
    var submittingLogin by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(sessionRepository) {
        sessionState = sessionRepository.restore()?.let(SessionState::Authenticated) ?: SessionState.SignedOut
    }

    when (val state = sessionState) {
        SessionState.Restoring -> AppLoadingScreen()
        SessionState.SignedOut -> LoginScreen(
            submitting = submittingLogin,
            error = loginError,
            onLogin = { email, password ->
                scope.launch {
                    submittingLogin = true
                    loginError = null
                    try {
                        sessionState = SessionState.Authenticated(sessionRepository.login(email, password))
                    } catch (error: Exception) {
                        loginError = error.message ?: "Could not sign in. Please try again."
                    } finally {
                        submittingLogin = false
                    }
                }
            },
        )

        is SessionState.Authenticated -> AuthenticatedApp(
            session = state.session,
            onLogout = {
                scope.launch {
                    try {
                        sessionRepository.logout(state.session)
                    } catch (_: Exception) {
                        // The repository already removed encrypted local state.
                    } finally {
                        sessionState = SessionState.SignedOut
                    }
                }
            },
        )
    }
}

private sealed interface SessionState {
    data object Restoring : SessionState
    data object SignedOut : SessionState
    data class Authenticated(val session: MobileSession) : SessionState
}

@Composable
private fun AppLoadingScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("Pogmail", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun AuthenticatedApp(
    session: MobileSession,
    onLogout: () -> Unit,
) {
    var destination by remember { mutableStateOf(AppDestination.Inbox) }
    var selectedMessage by remember { mutableStateOf<MailPreview?>(null) }
    var showMailAccounts by remember { mutableStateOf(false) }
    var showConnectAccount by remember { mutableStateOf(false) }
    var connectionNotice by remember { mutableStateOf<String?>(null) }
    val openedMessage = selectedMessage
    val showDock = destination != AppDestination.Compose && openedMessage == null && !showMailAccounts && !showConnectAccount

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            if (showDock) {
                FloatingDock(
                    selectedDestination = destination,
                    onSelect = { destination = it },
                    onCompose = { destination = AppDestination.Compose },
                )
            }
        },
    ) { innerPadding ->
        val contentModifier = Modifier
            .fillMaxSize()
            .padding(innerPadding)

        when {
            openedMessage != null -> MessageDetailScreen(
                modifier = contentModifier,
                message = openedMessage,
                onBack = { selectedMessage = null },
            )

            showConnectAccount -> ConnectMailAccountScreen(
                modifier = contentModifier,
                onClose = { showConnectAccount = false },
                onConnect = { address ->
                    connectionNotice = "Connection request prepared for $address"
                    showConnectAccount = false
                },
            )

            showMailAccounts -> MailAccountsScreen(
                modifier = contentModifier,
                onBack = { showMailAccounts = false },
                onConnectAccount = { showConnectAccount = true },
                connectionNotice = connectionNotice,
            )

            else -> when (destination) {
                AppDestination.Inbox -> InboxScreen(
                    modifier = contentModifier,
                    accountAddress = session.user.email,
                    onOpenMessage = { selectedMessage = it },
                )

                AppDestination.Search -> SearchScreen(modifier = contentModifier)
                AppDestination.Settings -> SettingsScreen(
                    modifier = contentModifier,
                    userName = session.user.name,
                    userEmail = session.user.email,
                    onOpenMailAccounts = { showMailAccounts = true },
                    onLogout = onLogout,
                )
                AppDestination.Compose -> ComposeScreen(
                    modifier = contentModifier,
                    onClose = { destination = AppDestination.Inbox },
                )
            }
        }
    }
}

@Composable
private fun FloatingDock(
    selectedDestination: AppDestination,
    onSelect: (AppDestination) -> Unit,
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
                DockItem(AppDestination.Inbox, Icons.Outlined.Inbox, selectedDestination, onSelect)
                DockItem(AppDestination.Search, Icons.Outlined.Search, selectedDestination, onSelect)
                ComposeDockAction(onClick = onCompose)
                DockItem(AppDestination.Settings, Icons.Outlined.Settings, selectedDestination, onSelect)
            }
        }
    }
}

@Composable
private fun RowScope.DockItem(
    destination: AppDestination,
    icon: ImageVector,
    selectedDestination: AppDestination,
    onSelect: (AppDestination) -> Unit,
) {
    val selected = selectedDestination == destination
    val itemShape = RoundedCornerShape(18.dp)
    val contentColor = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant

    Column(
        modifier = Modifier
            .weight(1f)
            .clip(itemShape)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = if (selected) 0.14f else 0f), itemShape)
            .clickable { onSelect(destination) }
            .padding(vertical = 7.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = destination.label, tint = contentColor)
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
