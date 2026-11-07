# Aarohan Staging & Production Deployment Checklist (Railway)
**Lilongwe, Malawi • Cloud Transit Infrastructure Runbook**

This runbook documents the deployment workflow on Railway (or similar containerized cloud PaaS).

---

## 1. Environment Variable Names (Variable Names Only)
Configure the following variable names in the Railway dashboard (**Settings -> Variables**). Never commit secret values to source control.

### Core Runtime & Server
- `NODE_ENV` (`production`)
- `PORT` (`3000` or `$PORT`)
- `TRUST_PROXY` (`1`)
- `PUBLIC_BASE_URL` (e.g. `https://api.aarohan.mw`)
- `APP_ORIGINS` (Comma-separated CORS origins, e.g. `https://aarohan.mw,https://driver.aarohan.mw,https://admin.aarohan.mw`)

### Database (PostgreSQL / Supabase)
- `DATABASE_URL` (Pooler connection string on port 6543)
- `DIRECT_URL` (Direct connection string on port 5432 for migrations)

### Cryptographic Secrets & Authentication
- `JWT_SECRET` (Minimum 32 random characters)
- `OTP_HMAC_SECRET` (Minimum 16 random characters)
- `SMS_HASH_SECRET` (Server secret for computing HMAC-SHA256 phone hashes)

### SMS Providers & Cost Controls
- `SMS_GATEWAY_PROVIDER` (`twilio` | `africastalking` | `simulator`)
- `SMS_SENDER_NAME` (Default `Aarohan`, max 11 alphanumeric characters)
- `OTP_DAILY_CAP_PER_PHONE` (Default `5`)
- `OTP_DAILY_CAP_PER_IP` (Default `40`)
- `SMS_DAILY_CAP_TOTAL` (Default `50`)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`
- `AFRICASTALKING_USERNAME`
- `AFRICASTALKING_API_KEY`
- `AFRICASTALKING_SENDER_ID`

### External Integrations & Storage
- `MAPBOX_ACCESS_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY`
- `SENTRY_DSN` (Optional; leave empty to disable)

---

## 2. Build & Start Commands

Configure in Railway **Settings -> Service**:
- **Build Command**:
  ```bash
  npm install && npm run build:css && npx prisma generate
  ```
- **Start Command**:
  ```bash
  node server.js
  ```

---

## 3. Release Step (Prisma Migrations)

Run database migrations automatically before traffic cutover:
- **Pre-deploy / Release Command**:
  ```bash
  npx prisma migrate deploy
  ```
  *(Never run `prisma migrate dev` against staging or production databases).*

---

## 4. Health Check Path & Probes

Configure in Railway **Settings -> Healthchecks**:
- **Path**: `/api/health`
- **Success Criteria**: HTTP `200 OK` (returns JSON `{"status":"HEALTHY","db":"CONNECTED"}`)
- **Timeout**: `10 seconds`

---

## 5. Custom Domain & Reverse Proxy Routing

1. In Railway **Settings -> Networking**, add custom domain (e.g. `api.aarohan.mw`).
2. Add CNAME record at DNS registrar pointing to Railway target.
3. Update `PUBLIC_BASE_URL=https://api.aarohan.mw`.
4. Ensure `TRUST_PROXY=1` is set so Express resolves real client IPs from `X-Forwarded-For`.

---

## 6. WebSocket Support (Socket.IO)

1. Railway automatically supports WebSocket connections over TLS (`wss://`).
2. Socket.IO mounts on default path `/socket.io/`.
3. Client connection timeout is set to 20s with 25s ping intervals.

---

## 7. Twilio Status Callback URL

1. In the Twilio Console under **Messaging -> Services -> Integration**:
   - Set **Inbound Request URL** / **Delivery Status Callback**:
     ```
     https://api.aarohan.mw/api/notifications/twilio-callback
     ```
   - HTTP Method: `POST`
2. Signature verification enforces `X-Twilio-Signature` HMAC-SHA1 against `PUBLIC_BASE_URL`.

