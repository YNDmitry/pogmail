package com.pogmail.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.pogmail.android.ui.inbox.InboxScreen
import com.pogmail.android.ui.theme.PogmailTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PogmailTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    PogmailApp()
                }
            }
        }
    }
}

@Composable
private fun PogmailApp() = InboxScreen()

@Preview(showBackground = true)
@Composable
private fun PogmailAppPreview() {
    PogmailTheme {
        PogmailApp()
    }
}
