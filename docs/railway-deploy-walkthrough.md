# Railway staging deploy: step by step

This walkthrough deploys Aarohan in **production mode** (the safe, cash-only pilot configuration).
Railway's settings change from time to time; where a screen differs, search Railway's docs for the setting name.
Never paste secret values into chat, tickets or Git. Type them into Railway's Variables tab yourself.

## 0. Before you start (on your PC)
1. `npm install` (this installs the self-hosted map library, `leaflet`, and updates `package-lock.json`).
2. `npm run build:css` (rebuilds the compiled CSS so new screen elements such as the consent checkbox are styled).
3. `npm run test:offline` then `npm test` then `npm run test:playwright` all pass.
4. `git status` shows no `.env`. Then commit **including `package.json` and `package-lock.json`**, and push to your **private** GitHub repository.
   If `package-lock.json` is not committed, the Docker build (`npm ci`) will fail.

## 1. Production database (Supabase)
1. Create a **new** Supabase project named `aarohan-prod` (never reuse the dev project). Use a new database password with letters and numbers only.
2. Storage: create a **private** bucket named `driver-documents`.
3. Copy two connection strings (Connect button): the **transaction pooler** (port 6543, add `?pgbouncer=true`) for `DATABASE_URL`, and the **session pooler** (port 5432) for `DIRECT_URL`.
4. Keep `SUPABASE_URL` and the secret key (`SUPABASE_SECRET_KEY`) for later. Do not share the secret key.

## 2. Create the Railway project
1. Sign in to Railway and turn on two-factor authentication.
2. Workspace settings: set the **preferred deployment region** to **EU West (Amsterdam)**. This is the closest Railway region to a Supabase project in Europe, which keeps database calls fast (the biggest speed factor you saw during testing).
3. New Project, Deploy from GitHub repo. Install the Railway GitHub app and give it access to **only** the Aarohan repository.
4. Railway builds with the `Dockerfile` it finds and reads `railway.json` for the pre-deploy command (database migrations) and the health check path (`/api/health`).
5. In the service settings confirm the region is EU West (Amsterdam).

## 3. Variables (names only; you type the values)
Generate each random secret on your PC with:
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (a different value for each).

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL`, `DIRECT_URL` | from step 1 |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | from step 1 |
| `JWT_SECRET`, `OTP_HMAC_SECRET`, `SMS_HASH_SECRET` | new random values, never the laptop ones |
| `AAROHAN_SECURITY_DESK_PHONE` | a real +265 number staff answer 24/7. The server refuses to start without it |
| `CONTACT_EMAIL` | shown on the landing page |
| `TRUST_PROXY` | `1` |
| `PAYMENTS_ENABLED`, `PAYOUTS_ENABLED` | `false` (cash-only pilot) |
| `MAP_PROVIDER`, `MAPBOX_ACCESS_TOKEN`, `MAP_API_KEY` | a **new** Mapbox token restricted to your Railway domain |
| `SMS_GATEWAY_PROVIDER` | `twilio` (see the SMS note below) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `SMS_SENDER_NAME` | from your upgraded Twilio account |
| `OTP_DAILY_CAP_PER_PHONE`, `SMS_DAILY_CAP_TOTAL`, `OTP_DAILY_CAP_PER_IP` | optional; defaults are 5 / 50 / 40 |
| `SENTRY_DSN` | optional |

Set after the domain exists (step 5): `PUBLIC_BASE_URL` (for example `https://your-app.up.railway.app`) and `APP_ORIGINS`.

**Never set:** `DATABASE_URL_TEST`, `TEST_DB_PROJECT_REF`, `AUTO_DISPATCH`, `REQUIRE_FARE_QUOTE`, `REQUIRE_OFFER_TO_ACCEPT`. (The first two make the server refuse to start; the last three are production-safe by default.)

> **SMS note.** In production the login code is never printed, so a real SMS provider is required for anyone to log in,
> including you as admin. Use your upgraded Twilio account for staging.

## 4. First deploy
1. Deploy. Watch the logs: the **pre-deploy** step applies the database migrations (including `20261108_commission_remittance`), then the app starts.
2. The health check calls `/api/health`. If the deploy fails, read the first error line in the logs. Common causes: a missing or placeholder secret, or a database connection string with a wrong password.
3. Railway only checks health at deploy time. Add an external uptime monitor on `/api/health` for continuous checking.

## 5. Domain and URLs
1. Service, Networking, generate a Railway domain (or add your own later).
2. Set `PUBLIC_BASE_URL` and `APP_ORIGINS` to that `https://` address and redeploy.
3. In Twilio, set the Messaging Service **status callback** to `https://<your-domain>/api/notifications/twilio-callback`.
4. Mapbox: restrict the new token to this domain.
5. Share the root address (`https://<your-domain>/`) as the website link with Africa's Talking.

## 6. Create the first admin
Using the Railway CLI on your PC (check Railway's CLI docs if a command differs):
1. `railway login`, then `railway link` and choose the project and service.
2. `railway run node scripts/create-admin.js` runs the script on your PC with the project's variables and prompts for the admin phone and a strong password.
See `docs/first-admin.md`. The seed script must never be run against production.

## 7. Smoke test (about 30 minutes, two phones)
1. Open `/api/health` and `/api/ready`: both return OK. Open `/`, `/legal/terms` and `/legal/privacy`.
2. Rider phone: log in with a real SMS code (tick the consent box), see the map and the quote.
3. Driver phone: register, upload documents, then approve the driver from `/admin/`.
4. Book a **cash** ride, accept it on the driver phone, enter the PIN, complete it. Check the trip appears in the admin Trips page with the 70/30 split.
5. Submit a commission payment from the driver, approve it in the admin queue, and confirm the debt goes down.
6. Press SOS from the rider phone: the admin page shows the alert, and the security desk phone gets the SMS.
7. Turn off the phone's data and press SOS: it should report honestly that it could not reach Aarohan and offer 997.

## 8. Rollback and safety
- Railway keeps previous deployments; roll back from the Deployments tab if a release misbehaves.
- Take a database backup before any migration on real data (Supabase dashboard, or `scripts/export-trip-records.js` for trip records).
- Keep `PAYMENTS_ENABLED=false` until payment approval and testing are complete.

## 9. After this works
Android APK pointed at your Railway URL (`CAP_SERVER_URL`), a field test in Lilongwe with 3 to 5 cheap phones, then the cash-only pilot.
