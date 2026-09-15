package com.pogmail.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = PogmailCoral,
    onPrimary = PogmailOnCoral,
    surface = PogmailPanel,
    onSurface = PogmailInk,
    surfaceVariant = PogmailUnread,
    onSurfaceVariant = PogmailMuted,
    outlineVariant = PogmailLine,
    background = PogmailCanvas,
    onBackground = PogmailInk,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFFFB4A3),
    onPrimary = Color(0xFF5E1608),
    surface = Color(0xFF171311),
    onSurface = Color(0xFFF2E8E3),
    surfaceVariant = Color(0xFF332925),
    onSurfaceVariant = Color(0xFFD7C5BE),
    outlineVariant = Color(0xFF4F413C),
    background = Color(0xFF171311),
    onBackground = Color(0xFFF2E8E3),
)

@Composable
fun PogmailTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = PogmailTypography,
        content = content,
    )
}
