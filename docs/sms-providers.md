# Aarohan SMS Gateway Providers & Cost Control Guide
**Lilongwe, Malawi • Smart Urban Transit Cloud Infrastructure**

This guide documents SMS provider configuration, environment variables, carrier sender ID registration for Malawi telecom networks, and cost control thresholds.

---

## 1. Provider Architecture & Switching

The Aarohan platform supports three SMS gateway adapters configured via the `SMS_GATEWAY_PROVIDER` environment variable:

| Provider Key | Primary Use Case | Network Coverage |
| :--- | :--- | :--- |
| `simulator` | **Default / Development / Sandbox**: Zero cost. In `development` mode, outputs masked dev OTP to server logs. In `production`, silences output. | Local / Mock |
| `twilio` | **International Fallback / Instant Onboarding**: Supports global SMS delivery and Twilio Messaging Service pooling. | Airtel Malawi, TNM |
| `africastalking` | **Production Recommended**: Dedicated African telecom aggregator with lowest per-SMS wholesale pricing in Malawi. | Airtel Malawi, TNM |

### Switching Providers
To switch the active provider, update the environment variable in your production hosting platform (e.g. Railway):
```bash
SMS_GATEWAY_PROVIDER=twilio
# or
SMS_GATEWAY_PROVIDER=africastalking
# or
SMS_GATEWAY_PROVIDER=simulator
```

---

## 2. Required Environment Variable Names (Variable Names Only)

Configure the following variable names in your cloud dashboard. **Never commit actual values or credentials to source control.**

### Global SMS & Sender Identification
- `SMS_GATEWAY_PROVIDER` (`simulator`, `twilio`, or `africastalking`)
- `SMS_SENDER_NAME` (Alphanumeric sender ID; default `"Aarohan"`. Max 11 characters. Generic names such as *Verify*, *OTP*, *Info*, *Notify* are strictly rejected by the server)
- `SMS_HASH_SECRET` (Server secret for computing HMAC-SHA256 privacy hashes of recipient phone numbers in `SmsLog`)
- `PUBLIC_BASE_URL` (Public canonical HTTPS base URL, e.g. `https://api.aarohan.mw`, used for webhook signature verification behind reverse proxies)
- `OTP_DAILY_CAP_PER_PHONE` (Maximum daily OTP requests per phone number; default `5`)
- `OTP_DAILY_CAP_PER_IP` (Maximum daily OTP requests per IP address; default `15`)
- `SMS_DAILY_CAP_TOTAL` (Maximum platform-wide daily SMS dispatches; default `50`)

### Twilio Configuration
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`

### Africa's Talking Configuration
- `AFRICASTALKING_USERNAME`
- `AFRICASTALKING_API_KEY`
- `AFRICASTALKING_SENDER_ID` (Approved alphanumeric sender name)

---

## 3. How to Register an Africa's Talking Local Sender ID in Malawi

> [!WARNING] UNVERIFIED NOTICE
> All statements in this section regarding MACRA regulatory requirements, Airtel Malawi and TNM carrier approval processes, document requirements, and approval turnaround times were written from memory and are **UNVERIFIED**. They must be independently confirmed with Africa's Talking support and MACRA before relying on them for launch.

To send SMS with an alphanumeric sender name (e.g., `Aarohan`) instead of a generic short code or foreign number, telecommunication procedures under the **Malawi Communications Regulatory Authority (MACRA) [UNVERIFIED]** require carrier pre-registration with **Airtel Malawi [UNVERIFIED]** and **TNM (Telekom Networks Malawi) [UNVERIFIED]**.

### Step-by-Step Procedure:
1. **Create an Africa's Talking Account**:
   - Register at [africastalking.com](https://africastalking.com) and verify your corporate organization profile.
2. **Submit Sender ID Request**:
   - In the Africa's Talking dashboard, navigate to **SMS** -> **Alphanumeric Sender IDs** -> **Request New Sender ID**.
   - Enter `Aarohan` (11 characters max).
   - Select Country: **Malawi (+265)**.
3. **Submit Required Documentation [UNVERIFIED]**:
   - **Company Registration Certificate**: Proof of legal incorporation in Malawi [UNVERIFIED].
   - **Letter of Authorization**: Formal letter on official Aarohan company letterhead signed by a company director, authorizing Africa's Talking to route traffic under the `Aarohan` sender ID [UNVERIFIED].
   - **Sample Message Templates [UNVERIFIED]**:
     - *OTP*: `"Your Aarohan verification code is 123456. It expires in 5 minutes. Do not share it."`
     - *Ride Dispatch*: `"AArohan Ride Confirmed! Captain: John Vehicle: TOYOTA MZ 1234 Pickup: Gateway Mall PIN: 4821"`
4. **Telecom Approval & Activation [UNVERIFIED]**:
   - Turnaround time for Airtel Malawi and TNM approval is typically **2 to 4 weeks [UNVERIFIED - verify current carrier SLAs]**.
   - Once approved, Africa's Talking marks the Sender ID as `ACTIVE`.
5. **Switch On in Production**:
   - Set `AFRICASTALKING_SENDER_ID=Aarohan` and `SMS_GATEWAY_PROVIDER=africastalking` in Railway environment settings.

---

## 4. Cost Comparison & Budget Control

> [!WARNING] UNVERIFIED PRICING NOTICE
> All SMS unit rates, currency conversions (USD/MWK), and monthly budget estimates in this section were written from memory and are **UNVERIFIED**. Actual per-segment charges to Malawi mobile numbers (+265) fluctuate based on carrier interconnect rates and volume tiers. Verify current pricing directly with Twilio and Africa's Talking.

| Provider | Average Cost per SMS (Malawi +265) [UNVERIFIED] | 50 SMS / Day Monthly Budget [UNVERIFIED] | Delivery Feedback (Webhooks) |
| :--- | :--- | :--- | :--- |
| **Simulator** | **$0.00 (Free)** | $0.00 | Immediate simulated status |
| **Africa's Talking** | **~$0.035 – $0.050 USD [UNVERIFIED]** (approx. MK 60 – MK 90) | **~$52 – $75 USD / month [UNVERIFIED]** | Real-time delivery reports |
| **Twilio** | **~$0.080 – $0.120 USD [UNVERIFIED]** (approx. MK 140 – MK 210) | **~$120 – $180 USD / month [UNVERIFIED]** | Full status callbacks (`X-Twilio-Signature`) |

### Platform Cost Guards
1. **Per-Phone Daily Cap (`OTP_DAILY_CAP_PER_PHONE=5`)**: Restricts individual phone numbers to 5 daily verification attempts.
2. **Per-IP Daily Cap (`OTP_DAILY_CAP_PER_IP=15`)**: Prevents a single IP source from exhausting the platform SMS quota.
3. **60-Second Cooldown**: Prevents rapid re-triggering of verification SMS.
4. **Total Platform Cap (`SMS_DAILY_CAP_TOTAL=50`)**: Hard stop ensuring daily provider costs remain tightly controlled. If exceeded:
   - SMS dispatches safely reject with: `"Platform daily SMS dispatch limit reached. Please contact Aarohan operations."`
   - An immutable `AuditLog` row with action `SMS_CAP_EXCEEDED` is recorded.
   - The Admin Dashboard renders a prominent warning banner.
