# Email login (zero-cost demo mode)

Set `AUTH_MODE=email` and people sign in with a code sent to their **email address** instead of an SMS.
Use it to demonstrate Aarohan without paying for SMS. Use `AUTH_MODE=phone` for the real pilot.

## How it works
- The **email is the verified identity.** The first time, the person also enters a name and a Malawian mobile number.
  That number is **not verified** (any valid Malawian number is accepted), so email mode is for demos, not for the real pilot.
- Same security as phone codes: 6-digit random code, stored only as a keyed hash, 5-minute expiry, one use, 5 wrong tries lock it,
  60-second cooldown, daily limits per email, per network and in total (`EMAIL_DAILY_CAP_TOTAL`, default 250, to stay under Brevo's 300/day).
- Only one method is open at a time: in email mode the phone-code routes answer 404, and the other way round.
- Admins sign in with an emailed code **and** their password. Create one with `scripts/create-admin.js` (it asks for an email).
- Riders always start as riders. Drivers register through the driver app as before and are approved by an admin.

## Set up Brevo (free: 300 emails a day)
1. Create a free account at brevo.com.
2. Add and **verify a sender address** (Senders, Domains and dedicated IPs). Without a verified sender, Brevo will not send.
   Your own domain gives the best delivery; a free mailbox address may be rejected or land in spam, so test with two or three real addresses first.
3. Create an **API key** (SMTP and API). Keep it secret.
4. Set these variables (Railway, or `.env` on your laptop):
   `AUTH_MODE=email`, `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY=...`, `EMAIL_FROM_ADDRESS=<your verified sender>`, `EMAIL_FROM_NAME=Aarohan`.
5. In production the server refuses to start in email mode without a provider, an API key and a sender address.

Resend works too (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`), but its free plan needs a verified domain.

## On your laptop (development)
With `EMAIL_PROVIDER=simulator` and `NODE_ENV=development`, the code is printed in the server window as `[DEV EMAIL OTP] you@example.com : 123456`. Nothing is sent.

## Database
Apply the migration `20261108_email_otp` (`npx prisma migrate deploy`). It only adds a table and one index. If old data already contains duplicate emails,
the unique-email index is skipped with a warning; fix the duplicates and create the index by hand.

## Demo-day script (10 minutes)
1. Rider phone: open the app, enter your email, tick the consent box, enter the code, add name and number, book a cash ride.
2. Driver phone: open the driver app, sign in with another email, register (documents), then approve the driver in the admin page.
3. Admin laptop: sign in with email + password + emailed code; approve the driver and watch trips live.
4. Ride: accept, PIN, complete; show the 70/30 split and the commission record.
5. Safety: press SOS and show the admin alert. Say clearly that this is a pilot prototype and that mobile-money payments come later.

## Before the real pilot
Switch back to `AUTH_MODE=phone` with real SMS, so phone numbers are verified (SOS and driver-rider calls depend on real numbers).
