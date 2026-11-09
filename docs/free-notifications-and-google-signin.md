# Free push notifications and Google sign-in

## 1. Push notifications cost nothing
**Firebase Cloud Messaging (FCM) is free.** Google does not charge for sending push notifications, and there is no message limit.
The Firebase "Spark" plan (no credit card) is enough. Things around Firebase that *do* cost money (SMS login, Cloud Functions) are NOT used here.
SMS is the expensive one, which is why Aarohan logs in by email code and uses push for alerts.

What pushes do in Aarohan:
- Driver: a new ride offer (even with the app closed), "you are approved", "your application needs changes", and a reminder to finish the application.
- Rider: "your captain is on the way", "your captain has arrived".
Without Firebase the apps still work: alerts appear in the app when it is open, and emails still go out. Push is what wakes a closed app.

### Set it up (about 15 minutes, free)
1. Go to https://console.firebase.google.com and click **Create a project** (name it Aarohan). Skip Google Analytics.
2. In the project: **Add app → Android**. Do it twice:
   - package name `com.aarohan.driver` (nickname Aarohan Captain)
   - package name `com.aarohan.rider` (nickname Aarohan)
   Download the `google-services.json` for each.
3. In GitHub (your private repo) → Settings → Secrets and variables → Actions → **Secrets**: add
   `FIREBASE_GOOGLE_SERVICES_DRIVER` (paste the driver file's text) and `FIREBASE_GOOGLE_SERVICES_RIDER` (paste the rider file's text).
4. Firebase → ⚙ Project settings → **Service accounts** → **Generate new private key**. A JSON file downloads.
   In Railway add the variable `FIREBASE_SERVICE_ACCOUNT_JSON` and paste that whole JSON as **one line**. Never commit this file.
5. Rebuild the apps (GitHub → Actions → Build Android apps → Run workflow) and redeploy Railway.
6. Test: sign in on a phone with the new Captain app, go online, request a ride from another phone with the screen locked. The offer should wake the phone.
Admin panel → **Messages & Alerts** shows every push as sent, simulated (no Firebase yet) or failed.

## 2. Google sign-in (free)
Email code works for everyone. Google sign-in is an extra button on the same sign-in screen for both riders and drivers.
1. https://console.cloud.google.com → create/select a project → **APIs & Services → OAuth consent screen** (External, app name Aarohan, your support email, publish).
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorized JavaScript origins: `https://YOUR-RAILWAY-ADDRESS` and `http://localhost:3000`. Click Create and copy the **Client ID**.
3. Railway variable `GOOGLE_CLIENT_ID` = that Client ID. Redeploy. The Google button appears on the sign-in screen (after the person ticks the Terms box).

**Important about the Android app:** Google blocks its normal web sign-in button inside an app's built-in browser. So:
- In the **website / installed web app (Chrome, "Add to Home screen")**: the Google button works.
- Inside the **Android APK**: the button is hidden and people use the email code, unless the native Google plugin is added. To add it later:
  `npm i @codetrix-studio/capacitor-google-auth`, create an **Android** OAuth client in Google Cloud for each app (package name + the SHA-1 of your signing key; for the Play Store use the SHA-1 shown in Play Console → App integrity), then rebuild. The sign-in code already uses the plugin automatically when it is present.
