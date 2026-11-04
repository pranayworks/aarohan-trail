# AArohan Mobility Platform • Production Deployment Guide
**Lilongwe, Malawi • Smart Urban Transit Cloud Infrastructure**

This guide provides deployment instructions for **Render** and **Railway**, using either Native Node.js or Containerized Docker workflows.

---

## 1. Quick Deploy Option A: Render

### Method 1: Web Service (Native Node)
1. In the Render Dashboard, click **New +** -> **Web Service**.
2. Connect your GitHub repository (`aarohan-trial`).
3. Configure the runtime settings:
   - **Environment**: `Node`
   - **Region**: Frankfurt / London (lowest latency to Southern Africa)
   - **Branch**: `main`
   - **Build Command**: `npm ci && npx prisma generate && npm run build:css`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
4. Add all environment variables listed in the Environment Variables section below under the **Environment** tab.
5. Click **Create Web Service**.

### Method 2: Render Docker Deploy
1. Choose **Docker** as runtime environment.
2. Render will automatically detect the root [Dockerfile](file:///c:/Users/Lenovo/aarohan%20trial/Dockerfile).
3. Set **Health Check Path** to `/api/health`.
4. Configure required environment variables and trigger deployment.

---

## 2. Quick Deploy Option B: Railway

1. In Railway Dashboard, click **New Project** -> **Deploy from GitHub repo**.
2. Select your repository. Railway automatically detects the Dockerfile or Node environment.
3. If using Native buildpacks, set:
   - **Build Command**: `npm ci && npx prisma generate && npm run build:css`
   - **Start Command**: `node server.js`
4. In **Settings** -> **Healthcheck**, set Path to `/api/health` with a 30-second timeout.
5. In **Variables**, enter all variable names listed below.
6. Trigger deployment.

---

## 3. Required Environment Variables (Variable Names Only)

Configure the following environment variable names in your cloud dashboard. **Never commit actual values to source control.**

### Core Runtime & Security
- `NODE_ENV` (Set to `production`)
- `PORT` (e.g. `3000` or assigned by platform)
- `JWT_SECRET` (Minimum 32 characters; startup will refuse if short or placeholder)
- `OTP_HMAC_SECRET` (Minimum 16 characters; startup will refuse if short or placeholder)
- `ADMIN_INITIAL_PASSWORD` (Initial password for dev admin account)

### Database & Storage (Supabase PostgreSQL & Storage)
- `DATABASE_URL` (PostgreSQL pooled connection string)
- `DIRECT_URL` (Direct database connection for Prisma migrations and schema engine)
- `SUPABASE_URL` (Supabase project API URL)
- `SUPABASE_SECRET_KEY` (Supabase server-side key)
- `SUPABASE_SERVICE_ROLE_KEY` (Supabase service role secret for private bucket management)

### Driver & Fleet Policy
- `MAX_COMMISSION_DEBT_MWK` (Maximum allowable commission debt before blocking online status; defaults to `15000`)
- `MAP_PROVIDER` (`carto`, `osm`, or `mapbox`)
- `MAP_API_KEY` (Mapping tile API key if required)
- `MAPBOX_ACCESS_TOKEN` (Mapbox token if mapbox provider is active)

### Payment Gateways (Airtel Money & TNM Mpamba)
- `AIRTEL_MONEY_CLIENT_ID`
- `AIRTEL_MONEY_CLIENT_SECRET`
- `AIRTEL_MONEY_MERCHANT_ID`
- `AIRTEL_MONEY_WEBHOOK_SECRET`
- `AIRTEL_MONEY_BASE_URL`
- `TNM_MPAMBA_API_KEY`
- `TNM_MPAMBA_MERCHANT_CODE`
- `TNM_MPAMBA_BASE_URL`

### SMS & Emergency Dispatch Notifications
- `SMS_GATEWAY_PROVIDER` (`simulator`, `twilio`, `africastalking`, or `tnm`)
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

## 4. Post-Deployment Verification Checklist

1. **Verify Health Endpoint**:
   ```bash
   curl -i https://your-deployment-url.com/api/health
   ```
   Must return `HTTP 200` with `{"status":"HEALTHY","database":"CONNECTED"}`.
2. **Verify Public Routes**:
   - `/rider` (Passenger ride-hailing interface)
   - `/driver` (Captain partner app & commission payment)
   - `/admin` (Operations dispatch & commission settlement queue)
3. **Verify Security Guards**:
   - `POST /api/reset` returns `HTTP 403` (Forbidden in production).
   - Socket `wallet:topup` rejected in production.
   - Plaintext OTP is never emitted in production logs or API payloads.
