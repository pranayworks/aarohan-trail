# AArohan Driver Android Build & Packaging Guide

> **Update:** the Android app now opens the NEW driver app (`/driver/next/`). `npm run cap:prod` needs `DEPLOYED_SERVER_URL` set to your live https address. The camera permission (face check and document photos) is included. See `docs/launch-day.md` for the ordered steps.

**Application ID:** `com.aarohan.driver`  
**Application Name:** `AArohan Driver`  
**Target Platform:** Android 8.0+ (API level 26 - 34+)  
**Lilongwe, Malawi Multi-Tier Fleet Operations**

---

## 1. Overview & Architecture
The `/driver` web application is wrapped into a native Android application using **Capacitor 8**. The app provides background execution capabilities specifically optimized for Android smartphones used by taxi and motorcycle captains in Malawi:

- **Background Geolocation:** Continuous GPS breadcrumb streaming via `@capacitor-community/background-geolocation` running as a foreground service with a persistent notification. Operates with high accuracy while online and battery-throttled at 5–10s intervals.
- **Offline GPS Queue:** Local disk queuing via `@capacitor/preferences` ensuring continuous spatial audit trails during network dropouts, flushed automatically on reconnection.
- **Push Notifications:** Firebase Cloud Messaging (FCM) via `@capacitor/push-notifications` to wake up device screens and chime incoming ride/parcel offers.
- **Bilingual Permission Explanations:** In-app explanations in both English and Chichewa before requesting "Allow all the time" location and notification permissions.

---

## 2. Prerequisites
1. **Node.js:** v18+ or v20+
2. **JDK:** Java Development Kit 17 (recommended for Gradle 8+)
3. **Android Studio:** Hedgehog (2023.1.1) or newer
4. **Android SDK:** Platforms 33 & 34, Build-Tools 34.0.0
5. **Google Services:** `google-services.json` from Firebase Console placed in `android/app/`

---

## 3. Environment Configuration & Server Switching

The application server target can be toggled using npm scripts:

### A. Local Development (Android Emulator / Local Wi-Fi)
Points the webview to `http://10.0.2.2:3000` (the host machine from Android Emulator):
```bash
npm run cap:dev
```

### B. Production Deployed Server
Points the webview to the production backend (`https://aarohan.app` or custom `DEPLOYED_SERVER_URL`):
```bash
npm run cap:prod
```

---

## 4. Syncing Web Assets & Plugins
Whenever changes are made to `/driver`, `shared/`, or native plugins, synchronize the Android native project:

```bash
npm run cap:sync
```

This command copies `driver/` assets to `android/app/src/main/assets/public/` and updates native Gradle plugin bindings.

---

## 5. Opening in Android Studio
To inspect native code, run in Android Studio:

```bash
npm run cap:open
```

Or open the `android/` directory directly in Android Studio.

---

## 6. Generating a Release Signing Key
Before publishing the APK or AAB, create a cryptographic keystore:

```bash
keytool -genkey -v -keystore aarohan-driver-release.keystore \
  -alias aarohan-driver \
  -keyalg RSA -keysize 2048 -validity 10000
```

Store `aarohan-driver-release.keystore` securely and never commit the keystore file or passwords to version control.

---

## 7. Building Release Artifacts

### Option A: Release APK (Direct Sideloading / Distribution)
Navigate to the `android/` directory and build the signed or unsigned release APK:

```bash
cd android
./gradlew assembleRelease
```
The output APK is generated at:
`android/app/build/outputs/apk/release/app-release-unsigned.apk`

Sign the APK using `apksigner`:
```bash
apksigner sign --ks aarohan-driver-release.keystore --out app-release.apk app-release-unsigned.apk
```

### Option B: Android App Bundle (AAB for Google Play Store)
```bash
cd android
./gradlew bundleRelease
```
The output AAB is located at:
`android/app/build/outputs/bundle/release/app-release.aab`

---

## 8. Verifying on Device
Install the compiled release APK to a connected Android phone via ADB:

```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

Verify that:
1. The app launches with the splash and connects to the server.
2. The bilingual permission modal displays on initial launch with the Chichewa toggle.
3. Toggling **ONLINE** starts the foreground notification *"Gaman Captain Online • AArohan Driver is Active"*.
4. Locking the phone continues transmitting GPS telemetry without disconnection.

