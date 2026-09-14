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
The starter screen has no backend connection and contains no credentials.

## Next implementation boundaries

- All IMAP/SMTP credentials stay encrypted in the Pogmail Worker; never store
  or connect to them directly from the Android application.
- Add the mobile session and incremental-sync API before building mailbox UI.
- Keep server URLs, FCM configuration and signing material outside Git.

See [PLAN.md](PLAN.md) for the production delivery plan.
