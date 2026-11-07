# Aarohan cash-only pilot: what is ON and what is OFF

## Money
| Area | Pilot behaviour |
|---|---|
| Rider payment | **Cash only.** The rider app shows Cash as the only method; the server refuses any other method while `PAYMENTS_ENABLED` is not `true` in production. |
| Mobile money / wallet top-up / escrow | **OFF** in production (`/api/payments/*` returns 403, wallet top-up is blocked). |
| Driver payouts | **OFF** (`PAYOUTS_ENABLED=false`). Earnings are recorded only. |
| Commission (30%) | Cash trips add the 30% commission to the driver's **commission debt**. The driver pays it by mobile money to the Aarohan number, submits the payment reference in the app, and an ADMIN/FINANCE user approves it. |
| Debt limit | `MAX_COMMISSION_DEBT_MWK` (default 15,000). Above it a driver cannot go online. |
| Settlement records | PostgreSQL table `CommissionRemittance`. Approval and the balanced ledger journal commit in **one transaction**. One payment reference can back only one active settlement. |

## Safety and privacy rules enforced by the server
- Realtime events are never broadcast. Each event goes only to the people involved (rider, assigned driver, ops staff).
- The **safety PIN and parcel delivery code reach the rider only**. Drivers and ops staff never receive them.
- Only the rider or assigned driver can cancel, chat on, or signal a call for a trip.
- **SOS**: identity and emergency contact come from the database. The alert goes to ops staff and by SMS to the security desk and the user's emergency contact. The police are **not** contacted automatically: staff or the user must call 997.
- Driver ID documents are stored only in the private Supabase bucket. In production there is **no** local-disk fallback.
- Production requires a server-signed fare quote for every booking.

## Required production settings (names only)
`NODE_ENV=production`, `JWT_SECRET`, `OTP_HMAC_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`AAROHAN_SECURITY_DESK_PHONE` (real +265 number answered 24/7), `PUBLIC_BASE_URL`, `TRUST_PROXY=1`, `APP_ORIGINS`,
SMS provider variables, `PAYMENTS_ENABLED=false`, `PAYOUTS_ENABLED=false`.
Never set `DATABASE_URL_TEST` or `TEST_DB_PROJECT_REF` in production (the server refuses to start).

## Before turning payments on later
1. Merchant/disbursement approval and a registered business.
2. Test collection, webhook signature checks and payouts in the provider sandbox.
3. Reserve Bank of Malawi guidance on holding wallet balances.
4. Then set `PAYMENTS_ENABLED=true` (and `PAYOUTS_ENABLED=true`) and re-run the full test suite.
