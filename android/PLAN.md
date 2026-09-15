# Pogmail Android: production plan

## Goal

Build a native Kotlin and Jetpack Compose Android client for Pogmail. The app
uses the existing Pogmail Worker as its single backend: external IMAP/SMTP
accounts, mail delivery and credential encryption remain server-side.

## Architecture

```text
Android app
  ├─ authenticated HTTPS API ────────> Pogmail Worker, D1 and R2
  ├─ foreground WebSocket ───────────> Realtime Durable Object
  ├─ FCM data notification ──────────> background incremental sync
  └─ encrypted Room cache ───────────> offline inbox and drafts
```

The app is layered as `Compose UI → ViewModel → Repository → API / local
storage`. Network and storage implementations stay behind repository interfaces
so screens can be independently tested.

## 1. Mobile backend foundation

Before the mailbox UI is built, extend the Worker with a mobile auth surface.

- Issue short-lived access tokens and opaque, rotating refresh tokens for each
  registered device. Hash refresh tokens in D1 and support revocation.
- Do not treat existing long-lived API keys as app sessions.
- Add device-session and FCM-token endpoints. Delete a device token on logout.
- Add a cursor-based incremental sync endpoint for mailbox counts, folders,
  messages and tombstones.
- Expose attachment downloads through authenticated or short-lived signed URLs.
- Keep push payloads minimal: mailbox/message identifiers and an optional,
  user-controlled preview. The application fetches the content after receiving
  a notification.
- Enqueue push work from existing mail processing; do not make FCM delivery a
  synchronous dependency of inbound mail.

### Implemented contract

The first backend slice is available under `/api/mobile`:

- `POST /auth/login` issues a 15-minute `accessToken` and a 90-day rotating
  `refreshToken`, scoped to a named Android device.
- `POST /auth/refresh` rotates both credentials. Replaying the old refresh
  token fails.
- `POST /auth/logout` revokes the current device. `GET /auth/me`, `GET
  /devices` and `DELETE /devices/:id` provide identity and remote-device
  management.
- The normal authenticated Worker APIs accept the short-lived Android bearer
  token, so IMAP/SMTP credentials stay entirely on the server.

FCM registration and incremental mailbox sync are the next backend slices;
the Android app should not call them until their contracts are added.

## 2. Android foundation

- Kotlin, Jetpack Compose and Material 3.
- `minSdk 29`; target the current supported Android API level at release time.
- OkHttp/Retrofit or Ktor with an authorization interceptor and refresh flow.
- Room for local mail, folders and drafts. Encrypt the local database with a
  random key protected by Android Keystore.
- DataStore for preferences and WorkManager for reliable, deferrable sync.
- Strictly avoid logs containing addresses, tokens, MIME bodies or attachments.

### Implemented authentication slice

- The Compose sign-in flow uses the mobile Worker API and shows only
  server-provided, user-safe errors.
- The refresh token, access token and user identity are one AES-GCM encrypted
  DataStore value. Its AES-256 key is generated in Android Keystore; backups
  are disabled for the app.
- The API origin is a public Gradle build parameter (`POGMAIL_API_BASE_URL`),
  not a committed environment file. The client accepts HTTPS origins only.
- Settings includes sign-out, which revokes the current device remotely when
  online and always clears the encrypted local session.

## 3. First usable release

1. Login, logout and remote device-session revocation.
2. Mailbox/folder switcher and inbox with pagination, search and pull-to-refresh.
3. Read plain text and sanitised HTML messages; show message thread where
   applicable.
4. Compose, reply, reply-all, forward and server-backed drafts.
5. Upload, download and share attachments.
6. Show external-account health and trigger server-side sync; never reveal or
   persist IMAP/SMTP passwords on the device.
7. Provide offline access to a bounded recent cache, with a user option to avoid
   retaining message bodies locally.

## 4. Realtime and notifications

- Use the current realtime endpoint while the app is foregrounded.
- Use FCM data notifications for background delivery, then schedule the
  incremental API sync through WorkManager.
- Create notification channels for normal, important and silent mail.
- Request notification permission contextually when a user enables alerts. On
  Android 13 and later this is the `POST_NOTIFICATIONS` runtime permission.
- Let notification settings control previews, sound and per-mailbox behavior.

## 5. Security and privacy

- Store only refresh-token material and cryptographic keys in Keystore-backed
  storage; access tokens remain short lived and memory-first.
- On logout, revoke the server session, remove FCM registration and securely
  clear the local database.
- Provide an optional biometric app lock and no-offline-body mode.
- Use platform TLS defaults. Consider certificate pinning only alongside a
  tested certificate-rotation mechanism.
- Keep configuration, Firebase credentials, API base URLs per environment and
  release signing keys outside version control.

## 6. Quality and release gates

- Unit-test repositories, token refresh, sync merging and cache eviction.
- Add Compose UI tests for login, inbox, reader and composer flows.
- Contract-test mobile API responses in the Worker test suite.
- Test offline mode, slow networks, background restriction, process death,
  rotation, attachment retry and FCM token renewal on physical devices.
- Release first to Play internal testing, track crashes and delivery failures,
  then use staged rollout with rollback criteria.

## Delivery order

1. Agree mobile API contracts and device-session data model.
2. Implement Worker APIs, migrations and contract tests.
3. Implement Android auth, dependency setup and API client.
4. Add inbox/read/compose and local cache.
5. Add attachments, foreground realtime and background FCM sync.
6. Complete security hardening, observability, device QA and Play delivery.
