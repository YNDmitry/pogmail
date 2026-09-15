package com.pogmail.android

import android.app.Activity
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.tooling.preview.Preview
import androidx.core.view.WindowCompat
import com.pogmail.android.data.auth.MobileSessionRepository
import com.pogmail.android.ui.app.PogmailApp
import com.pogmail.android.ui.auth.LoginScreen
import com.pogmail.android.ui.theme.PogmailTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PogmailAndroidApp((application as PogmailApplication).mobileSessionRepository)
        }
    }
}

@Composable
private fun PogmailAndroidApp(sessionRepository: MobileSessionRepository) {
    val darkTheme = isSystemInDarkTheme()
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            (view.context as? Activity)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !darkTheme
                    isAppearanceLightNavigationBars = !darkTheme
                }
            }
        }
    }

    PogmailTheme(darkTheme = darkTheme) {
        Surface(modifier = Modifier.fillMaxSize()) {
            PogmailApp(sessionRepository)
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PogmailAppPreview() {
    PogmailTheme {
        LoginScreen(submitting = false, error = null, onLogin = { _, _ -> })
    }
}
