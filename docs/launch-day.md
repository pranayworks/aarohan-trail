# Launch day: put Aarohan online and get the apps

This is the short, ordered version. The long version is in `railway-deploy-walkthrough.md` and `android-build.md`.
Do the steps in order. Anything marked **(you)** needs your accounts, passwords or computer.

## 0. Before anything (your computer, in the project folder)
1. `git status` and make sure `.env` and `.dev-sessions.json` are NOT listed. Then:
   `git add -A` → `git commit -m "Launch build"` → `git push` (the repository must be PRIVATE).
2. `npx prisma migrate deploy` and `npx prisma generate` (adds the face check, number plate and photo fingerprint tables).
3. `npm test` (all offline tests must pass).

## 1. Supabase (you)
- Storage → create a bucket named exactly **driver-documents**, set to **Private**.
- Copy the project URL and the **service role key** (never put this key in the app or in Git).
- Use the **pooler** connection string for `DATABASE_URL` and the **direct** one for `DIRECT_URL`.
- Pick a Supabase region close to Railway and to Malawi, otherwise every screen is slow (we measured 1.4 seconds per call).

## 2. Railway (you)
Create the project from the GitHub repo. Set these variables (names only here, you type the values):

| Variable | Value |
|---|---|
| NODE_ENV | production |
| JWT_SECRET | a long random string (32+ characters) |
| KYC_ENCRYPTION_KEY | run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and keep a safe copy (if you lose it, saved ID numbers cannot be read again) |
| DATABASE_URL, DIRECT_URL | from Supabase |
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY | from Supabase |
| AUTH_MODE | email |
| EMAIL_PROVIDER, BREVO_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME | your Brevo settings |
| CONTACT_EMAIL | aarohan.help@gmail.com |
| MAX_COMMISSION_DEBT_MWK | 2500 |
| GOOGLE_CLIENT_ID | optional, only if you want Google sign-in |
| (do NOT set) STRICT_DRIVER_APPROVAL | leave it unset so approval stays strict |

Deploy. The health check is `/api/health`. Railway runs the migrations by itself before each deploy.

## 3. First admin (you)
`railway run node scripts/create-admin.js` (type the phone, email, name and a strong password yourself).
Sign in at `https://YOUR-ADDRESS/admin/`.

## 4. Test with two real phones before anyone else
1. Rider phone: open `https://YOUR-ADDRESS/rider/`, sign up, then "Add to home screen".
2. Driver phone: open the driver app, sign up, then run the WHOLE application (details, vehicle, face check, 7 photos).
3. Admin: Driver Partner KYC → Review identity → compare the five face photos with the ID, tick every item, Approve.
4. Driver goes online, rider books a Moto, the offer arrives, finish the trip, check the earnings and commission.
5. Cancel a ride, send a chat message, press SOS (tell your contact first), raise a support ticket.

## 5. The two apps (rider and driver)
One Android project builds both: **Aarohan** (riders, `com.aarohan.rider`) and **Aarohan Captain** (drivers, `com.aarohan.driver`).
Each has its own name, icon label, **home screen widget** and **long-press shortcuts**:
- Rider widget: [Book a ride] [Send a parcel]. Captain widget: [Go online] [Earnings]. Both appear in the phone's widget list as "Aarohan" / "Aarohan Captain".
- Permissions asked on first use: location (both), notifications (both), camera (Captain only, for the face check and photos). The rider app asks for no microphone or camera because nothing in it uses them.

**Get both APK files in the cloud (no Android Studio):**
1. Deploy to Railway first, so you have your live https address.
2. GitHub, your private repo, Settings, Secrets and variables, Actions, **Variables**: add `DEPLOYED_SERVER_URL` = your live address.
3. Optional (push notifications): **Secrets** `FIREBASE_GOOGLE_SERVICES_DRIVER` and `FIREBASE_GOOGLE_SERVICES_RIDER` = the text of each app's `google-services.json` from Firebase. Without them the apps still work, they just get no push when closed.
4. `git push`, then Actions, **Build Android apps**, **Run workflow**. In about 10 minutes the run has an artifact **aarohan-apks** with two files. Copy them to a phone and install (allow "install unknown apps").
5. For the Play Store: create a signing key once (`keytool -genkey -v -keystore aarohan.keystore -alias aarohan -keyalg RSA -keysize 2048 -validity 10000`), keep it safe in two places (losing it means you can never update the app), then add secrets `KEYSTORE_BASE64` (the file converted to base64), `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. The same workflow then also makes the two `.aab` files that the Play Store wants. You need a Google Play developer account, a privacy policy address and screenshots.

**Updating the apps later (easy):**
- Anything on the website side (screens, features, admin panel, ads, prices, rules): just deploy to Railway. The installed apps load the live website, so they update by themselves. A small "A new version is ready" prompt appears and one tap reloads it. Nobody downloads anything.
- Only these need a new app file: the app name, icon, permissions, widget or shortcuts. Run the workflow again (the version number goes up by itself) and upload the new files to the Play Store.
- To force very old app files to update, set `APP_RIDER_MIN_VERSION` / `APP_DRIVER_MIN_VERSION` and `PLAY_STORE_URL_RIDER` / `PLAY_STORE_URL_DRIVER` in Railway.

**On your own computer instead:** `$env:DEPLOYED_SERVER_URL="https://YOUR-ADDRESS"; npm run cap:prod`, `npm run cap:sync`, then in `android/` run `./gradlew assembleDriverDebug assembleRiderDebug` (or open the folder in Android Studio and pick the "riderDebug" or "driverDebug" build variant).

**Ads in the apps:** Supabase, Storage, create a **public** bucket named `ad-media`. Then admin panel, "Rider App Ads" and "Driver App Ads".
**Push notifications:** Railway variable `FIREBASE_SERVICE_ACCOUNT_JSON` = the Firebase service account JSON (one line).

## 6. After launch
- Keep `STRICT_DRIVER_APPROVAL` unset. Never approve a driver who has not done the face check.
- Watch the Overview page daily: applications waiting, commission payments to verify, open tickets.
- Back up the database and test restoring one (see `backups-and-retention.md`).
