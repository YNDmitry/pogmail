package com.pogmail.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.isSystemInDarkTheme

private val LightColors = lightColorScheme(
    primary = PogmailCoral,
    onPrimary = PogmailOnCoral,
    surface = PogmailLightPanel,
    onSurface = PogmailLightInk,
    surfaceVariant = PogmailLightAccent,
    onSurfaceVariant = PogmailLightMuted,
    outlineVariant = PogmailLightLine,
    background = PogmailLightCanvas,
    onBackground = PogmailLightInk,
)

private val DarkColors = darkColorScheme(
    primary = PogmailCoral,
    onPrimary = PogmailOnCoral,
    surface = PogmailDarkPanel,
    onSurface = PogmailDarkInk,
    surfaceVariant = PogmailDarkAccent,
    onSurfaceVariant = PogmailDarkMuted,
    outlineVariant = PogmailDarkLine,
    background = PogmailDarkCanvas,
    onBackground = PogmailDarkInk,
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
