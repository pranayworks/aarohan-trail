# Aarohan Urban Mobility Platform • Production Deployment Guide
**Lilongwe, Malawi • Smart Urban Transit Cloud Infrastructure**

This guide provides official production deployment instructions for **Railway** (and Render), using either native Node.js buildpacks or containerized Docker workflows.

---

## 1. Railway Production Deployment

### Step 1: Connect GitHub Repository
1. In the Railway Dashboard, create a **New Project** -> **Deploy from GitHub repo**.
2. Select your repository (`aarohan-trial`).
3. Railway automatically detects the project.

### Step 2: Configure Build, Release & Start Commands
Under service **Settings**:
* **Build Command**:
  ```bash
  npm ci && npx prisma generate && npm run build:css
  ```
* **Pre-Deploy / Release Command** (runs before new container receives traffic):
  ```bash
  npx prisma migrate deploy
  ```
  > ⚠️ **CRITICAL WARNING**: NEVER run `npx prisma migrate dev` in production. Only use `npx prisma migrate deploy`, which executes applied migrations without dropping tables, resetting data, or attempting interactive shadow database prompts.
* **Start Command**:
  ```bash
  node server.js
  ```
* **Healthcheck Path**: `/api/health` (or `/api/ready`) with a 30-second timeout.

---

## 2. HTTPS & WebSocket (WSS) Configuration

* **Edge SSL Termination**: Railway automatically terminates TLS at its edge router. All public HTTP requests are redirected to HTTPS, and WebSocket connections use `wss://`.
* **Reverse Proxy Headers**: The backend Express and Socket.IO servers run behind reverse proxies. Ensure `trust proxy` is honored so `req.ip` correctly captures the client's real IP for rate limiting rather than Railway's internal proxy IP.
* **WebSocket Upgrades**: Socket.IO automatically handles `Upgrade: websocket` requests. The default in-memory adapter supports single-instance deployments. For multi-replica horizontal scaling, configure `@socket.io/redis-adapter` with a Redis instance.
* **Content Security Policy (CSP) & CORS**:
  * Set `APP_ORIGINS` to your production domain(s) (e.g. `https://aarohan.app,https://driver.aarohan.app`).
  * Helmet enforces strict CSP allowing only self, Mapbox vector tiles, OpenStreetMap raster tiles, self-hosted fonts in `/assets/fonts`, and Socket.IO `wss:`.

---

## 3. Required Environment Variables (Variable Names Only)

Configure the following variable names in your Railway Dashboard (**Variables** tab). **Never commit actual secrets to version control or print `.env`.**

### Core Runtime & System Security
- `NODE_ENV` (Set to `production`)
- `PORT` (Assigned dynamically by Railway)
- `JWT_SECRET` (Minimum 32 characters; server refuses startup if missing or insecure)
- `OTP_HMAC_SECRET` (Minimum 16 characters; server refuses startup if missing or insecure)
- `APP_ORIGINS` (Comma-separated CORS allowlist, e.g. `https://aarohan.app,https://admin.aarohan.app`)
- `SENTRY_DSN` (Optional Sentry error monitoring DSN; leaves monitoring disabled if omitted)

### Database & Storage (Supabase PostgreSQL & Storage)
- `DATABASE_URL` (PostgreSQL pooled connection string for runtime queries)
- `DIRECT_URL` (Direct PostgreSQL connection string for Prisma migrations & `migrate deploy`)
- `SUPABASE_URL` (Supabase project API endpoint)
- `SUPABASE_SECRET_KEY` (Supabase server-side API key)
- `SUPABASE_SERVICE_ROLE_KEY` (Supabase service role secret for private document storage)

### Rate Limiting & SMS Quotas
- `OTP_DAILY_CAP_PER_PHONE` (Max OTP SMS verification requests per phone per 24h; default: `5`)
- `SMS_DAILY_CAP_TOTAL` (Global platform SMS dispatch ceiling across all numbers; default: `1000`)
- `PARCEL_CODE_DELIVERY` (`sender` or `sms`; default: `sender`)
- `DATA_RETENTION_MONTHS` (Legal and safety data retention window; default: `12`)

### Driver Policy & Mapping Services
- `MAX_COMMISSION_DEBT_MWK` (Commission debt threshold before driver online status is locked; default: `15000`)
- `MAP_PROVIDER` (`mapbox`, `carto`, or `osm`)
- `MAPBOX_ACCESS_TOKEN` (Mapbox token for Lilongwe road navigation & authoritative polyline directions)
- `MAP_API_KEY` (Alternative tile API key if using non-Mapbox provider)

### Mobile Money Payment Integrations
- `AIRTEL_MONEY_CLIENT_ID`
- `AIRTEL_MONEY_CLIENT_SECRET`
- `AIRTEL_MONEY_MERCHANT_ID`
- `AIRTEL_MONEY_WEBHOOK_SECRET`
- `AIRTEL_MONEY_BASE_URL`
- `TNM_MPAMBA_API_KEY`
- `TNM_MPAMBA_MERCHANT_CODE`
- `TNM_MPAMBA_BASE_URL`

### SMS Telephony Gateways & Emergency Contacts
- `SMS_GATEWAY_PROVIDER` (`twilio`, `africastalking`, `tnm`, or `simulator`)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `TWILIO_WHATSAPP_NUMBER`
- `AFRICASTALKING_USERNAME`
- `AFRICASTALKING_API_KEY`
- `AFRICASTALKING_SENDER_ID`
- `TNM_SMS_API_KEY`
- `TNM_SMS_SENDER_ID`
- `TNM_SMS_BASE_URL`
- `EMERGENCY_POLICE_HOTLINE`
- `AAROHAN_SECURITY_DESK_PHONE`

---

## 4. Pre-Launch Verification Checklist

1. [ ] **Database Migrations Applied**: Verify `npx prisma migrate deploy` executed cleanly against Supabase.
2. [ ] **First Admin Initialized**: Run `node scripts/create-admin.js` via Railway CLI or one-off task to provision the operational administrator.
3. [ ] **Health & Readiness Endpoints**:
   - `GET /api/health` returns `HTTP 200` with `status: "HEALTHY"`.
   - `GET /api/ready` returns `HTTP 200` with `database: "CONNECTED"`.
4. [ ] **Zero Secrets Exposure**: Confirm `/api/health`, `/api/ready`, and `/api/app-config` contain 0 database credentials, API secrets, or passwords.
5. [ ] **Production Security Guards Active**:
   - `POST /api/reset` returns `HTTP 403 Forbidden`.
   - Socket `wallet:topup` is rejected.
   - Development location simulation button is hidden on Rider home.
6. [ ] **PII Scrubbing**: Sentry reports redact phones, OTPs, auth tokens, GPS coordinates, and document paths.
7. [ ] **End-to-End Smoke Test**: Verify passenger booking, captain dispatch notification, safety PIN verification, and completed cash/wallet journal balancing in Lilongwe corridor.
