# Pogmail for Android

Native Android client for Pogmail. It is intentionally a separate Gradle project:
the existing React SPA and Cloudflare Worker remain unchanged.

## Requirements

- Android Studio with Android SDK Platform 37 installed
- JDK 17 (bundled with current Android Studio)

## Run

```sh
cd android
./gradlew :app:assembleDebug
```

Open the `android/` directory in Android Studio to run on an emulator or device.
The app signs in through the Worker mobile-session API. It never receives IMAP
or SMTP passwords.

The default public API origin is `https://pogmail.dev`. For a development or
self-hosted instance, pass an HTTPS origin at build time; keep it in your local
Gradle user configuration rather than version control:

```sh
./gradlew :app:assembleDebug -PPOGMAIL_API_BASE_URL=https://mail.example.com
```

## Next implementation boundaries

- All IMAP/SMTP credentials stay encrypted in the Pogmail Worker; never store
  or connect to them directly from the Android application.
- The mobile session API is implemented; incremental sync and FCM are next.
- Keep server URLs, FCM configuration and signing material outside Git.

See [PLAN.md](PLAN.md) for the production delivery plan.
