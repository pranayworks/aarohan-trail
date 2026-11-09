# First Admin Provisioning Guide
**Aarohan Platform • Production Readiness**  
**Lilongwe, Malawi**

This guide explains how to initialize the first administrative account on a fresh production database.

---

## 1. Security Invariants

* **No Seed Passwords**: Initial production databases must NEVER be seeded with default administrative credentials.
* **Zero Display / Zero Log**: Password input is muted at the terminal level using stream silencing. Passwords are never echoed to stdout, never stored in environment variables (unless provided by secure runtime secrets), and never written to logs.
* **Bcrypt Cost Factor 12**: Passwords are cryptographically salted and hashed before insertion.
* **Audit Trail**: Every admin creation writes an immutable `AuditLog` row with action `ADMIN_PROVISIONED`.

---

## 2. Interactive CLI Execution

On your deployment host (e.g. Railway shell or SSH container):

```bash
node scripts/create-admin.js
```

### Prompt Walkthrough:
1. **Enter Admin Mobile Number (+265XXXXXXXXX)**: Provide your Malawian phone (e.g. `+265999970000`). Must be E.164 compliant with valid TNM or Airtel prefixes.
2. **Enter Admin Full Name**: Enter your name or accept the default `[Aarohan Operations Admin]`.
3. **Enter Secure Admin Password**: Type your secure password (minimum 10 characters). Keystrokes are completely hidden.
4. **Confirm Admin Password**: Re-enter the password to guard against typos.

---

## 3. Automated / Non-Interactive Execution (CI / First Deploy Release Step)

If running in an automated pipeline where interactive TTY is unavailable:

```bash
ADMIN_PHONE="+265999970000" ADMIN_PASSWORD="<YourSuperSecret10CharPassword>" node scripts/create-admin.js
```

*Note: Ensure the environment variable is immediately cleared after provisioning.*

---

## 4. Verification

1. Navigate to the Admin Portal: `https://<your-domain>/admin`
2. Enter your registered administrative phone number.
3. Authenticate with dual-factor verification (Admin password + 6-digit SMS OTP).
4. Verify access to Operations Metrics, Driver Verification Queue, and Pricing Tariffs.


## Forgot the admin password?
On the admin sign-in screen tap **Forgot password?**, enter your admin email, type the 6-digit code that arrives (valid 10 minutes, check spam), then choose a new password (at least 10 characters, letters and a number, not containing your email name). You are signed out everywhere for safety and an email confirms the change.
- Only **admin** accounts have passwords. Riders and drivers sign in with an emailed code, so they have nothing to reset.
- If the email itself no longer works, run `node scripts/create-admin.js` again with the same phone and email on your own computer. It sets a new password for that account (it needs your database access, so only you can do it).
- 5 wrong passwords lock admin sign-in for 15 minutes. A successful password reset clears that lock.
