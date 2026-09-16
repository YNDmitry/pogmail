package com.pogmail.android.ui.model

data class MailPreview(
    val id: String,
    val sender: String,
    val senderAddress: String,
    val subject: String,
    val preview: String,
    val time: String,
    val unread: Boolean,
    val label: String? = null,
    val mailboxId: String? = null,
)

val previewMessages = listOf(
    MailPreview(
        id = "1",
        sender = "Cloudflare",
        senderAddress = "notifications@cloudflare.com",
        subject = "Your weekly traffic summary",
        preview = "Your domains handled 24,831 requests this week.",
        time = "09:42",
        unread = true,
        label = "Work",
    ),
    MailPreview(
        id = "2",
        sender = "Alex Morgan",
        senderAddress = "alex@northstar.studio",
        subject = "Design review — Thursday",
        preview = "I left a few comments on the latest inbox flow.",
        time = "08:17",
        unread = true,
    ),
    MailPreview(
        id = "3",
        sender = "Figma",
        senderAddress = "notification@figma.com",
        subject = "You were mentioned in Pogmail mobile",
        preview = "Mira mentioned you in a comment: looks ready for a pass.",
        time = "Yesterday",
        unread = false,
        label = "Updates",
    ),
    MailPreview(
        id = "4",
        sender = "Linear",
        senderAddress = "updates@linear.app",
        subject = "ENG-142 is ready for review",
        preview = "External account synchronization has moved to In review.",
        time = "Mon",
        unread = false,
    ),
)
