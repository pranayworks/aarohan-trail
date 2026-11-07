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
- `OTP_DAILY_CAP_PER_PHONE` (Maximum daily OTP requests per phone number; default `5`)
- `SMS_DAILY_CAP_TOTAL` (Maximum platform-wide daily SMS dispatches; default `200`)

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

To send SMS with an alphanumeric sender name (e.g., `Aarohan`) instead of a generic short code or foreign number, telecommunication regulations under the **Malawi Communications Regulatory Authority (MACRA)** require carrier pre-registration with **Airtel Malawi** and **TNM (Telekom Networks Malawi)**.

### Step-by-Step Procedure:
1. **Create an Africa's Talking Account**:
   - Register at [africastalking.com](https://africastalking.com) and verify your corporate organization profile.
2. **Submit Sender ID Request**:
   - In the Africa's Talking dashboard, navigate to **SMS** -> **Alphanumeric Sender IDs** -> **Request New Sender ID**.
   - Enter `Aarohan` (11 characters max).
   - Select Country: **Malawi (+265)**.
3. **Submit Required Documentation**:
   - **Company Registration Certificate**: Proof of legal incorporation in Malawi.
   - **Letter of Authorization**: Formal letter on official Aarohan company letterhead signed by a company director, authorizing Africa's Talking to route traffic under the `Aarohan` sender ID.
   - **Sample Message Templates**:
     - *OTP*: `"Your Aarohan verification code is 123456. It expires in 5 minutes. Do not share it."`
     - *Ride Dispatch*: `"AArohan Ride Confirmed! Captain: John Vehicle: TOYOTA MZ 1234 Pickup: Gateway Mall PIN: 4821"`
4. **Telecom Approval & Activation**:
   - Turnaround time for Airtel Malawi and TNM approval is typically **2 to 4 weeks**.
   - Once approved, Africa's Talking marks the Sender ID as `ACTIVE`.
5. **Switch On in Production**:
   - Set `AFRICASTALKING_SENDER_ID=Aarohan` and `SMS_GATEWAY_PROVIDER=africastalking` in Railway environment settings.

---

## 4. Cost Comparison & Budget Control

| Provider | Average Cost per SMS (Malawi +265) | 200 SMS / Day Monthly Budget | Delivery Feedback (Webhooks) |
| :--- | :--- | :--- | :--- |
| **Simulator** | **$0.00 (Free)** | $0.00 | Immediate simulated status |
| **Africa's Talking** | **~$0.035 – $0.050 USD** (approx. MK 60 – MK 90) | **~$210 – $300 USD / month** | Real-time delivery reports |
| **Twilio** | **~$0.080 – $0.120 USD** (approx. MK 140 – MK 210) | **~$480 – $720 USD / month** | Full status callbacks (`X-Twilio-Signature`) |

### Platform Cost Guards
1. **Per-Phone Daily Cap (`OTP_DAILY_CAP_PER_PHONE=5`)**: Prevents abuse or SMS toll-fraud by restricting individual phone numbers to 5 daily verification attempts.
2. **60-Second Cooldown**: Prevents rapid re-triggering of verification SMS.
3. **Total Platform Cap (`SMS_DAILY_CAP_TOTAL=200`)**: Hard stop ensuring monthly provider expenses cannot exceed ~$300 USD. If exceeded:
   - SMS dispatches safely reject with: `"Platform daily SMS dispatch limit reached. Please contact Aarohan operations."`
   - An immutable `AuditLog` row with action `SMS_CAP_EXCEEDED` is recorded.
   - The Admin Dashboard renders a prominent warning banner.

