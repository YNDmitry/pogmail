package com.pogmail.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
    primary = PogmailCoral,
    onPrimary = PogmailOnCoral,
)

private val DarkColors = darkColorScheme(
    primary = PogmailCoral,
    onPrimary = PogmailOnCoral,
)

@Composable
fun PogmailTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        typography = PogmailTypography,
        content = content,
    )
}
