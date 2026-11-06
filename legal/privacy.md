# Aarohan Privacy Policy
**Version: DRAFT v0.1 (not yet reviewed by a lawyer)**

> ⚠️ **DRAFT NOTICE: This document is a draft version and does not constitute formal legal advice. It contains placeholder parameters that must be reviewed and finalized by qualified legal counsel in Malawi prior to production launch.**

---

### 1. Information We Collect
[COMPANY_NAME] ("we", "us", or "our") collects the following categories of information to provide and safeguard transportation and courier services:
- **Identity & Contact Details:** Full legal name, mobile phone number, profile photo, and designated emergency contact names/numbers.
- **Location Information:** Exact real-time GPS coordinates of pickup, intermediate stops, and drop-off destinations; background location trails recorded at 10-second intervals for driver partners during active trip transit.
- **Trip & Transaction History:** Fares, payment methods, transaction timestamps, distance, duration, cancellations, and ratings.
- **Communications:** Timestamped in-app chat transcripts and customer support ticket dialogues.
- **Driver Verification Documents (KYC):** National Identity Card, Driver's Licence, Vehicle Registration Certificate, Certificate of Fitness, statutory insurance documents, and criminal background clearance where applicable.
- **Device & Diagnostic Data:** Device make/model, operating system version, push notification tokens, IP addresses, and application telemetry logs.

### 2. Purposes for Processing Personal Data
We process collected data exclusively for the following operational, safety, and legal objectives:
- Dispatching rides and deliveries based on real-time spatial proximity.
- Real-time location tracking for passenger and courier safety during transit.
- Investigating accident claims, fare disputes, lost parcel inquiries, and passenger safety reports.
- Enforcing commission reconciliation and driver settlement rules.
- Complying with regulatory obligations under Malawi transport, commercial, and tax statutes.

### 3. Disclosure of Data to Third Parties
We do not sell personal data to advertisers. Data is shared strictly on a need-to-know basis with:
- **Trip Counterparties:** Riders receive driver name, vehicle details, plate number, and live vehicle location during active dispatch. Drivers receive pickup/dropoff coordinates and rider first name.
- **Safety Desk & Authorized Support Staff:** Super-admin and support personnel have access to complete trip records; each administrative access event is logged to an immutable audit trail (`AuditLog`).
- **Emergency Responders & Law Enforcement:** Police (Malawi Police Service) and emergency medical personnel upon trigger of the in-app SOS feature or receipt of a lawful court order/subpoena.
- **Infrastructure Providers:** Secure cloud hosting ([CLOUD_HOSTING_PROVIDER_REGION]), SMS delivery gateway ([SMS_GATEWAY_PROVIDER]), and mobile money settlement partners ([MOBILE_MONEY_GATEWAY]).

### 4. Data Retention Schedule
In accordance with our data retention policy (`DATA_RETENTION_MONTHS` = [DATA_RETENTION_MONTHS, default: 12 months]):
- Trip records, GPS coordinates (`TripLocationPoint`), ticket messages, and financial ledgers are retained for [DATA_RETENTION_MONTHS] months following trip completion to resolve disputes, handle insurance claims, and fulfill tax reporting requirements.
- KYC verification documents are retained for the duration of the driver's active partnership plus [KYC_RETENTION_YEARS_AFTER_DEACTIVATION] years.
- Users may request account deletion; however, financial and audit records required by law will be preserved until the expiration of the statutory retention window.

### 5. Your Privacy Rights
Subject to applicable Malawi data protection laws and international standards, you have the right to:
- Access and inspect the personal information we hold about you.
- Request rectification of inaccurate, out-of-date, or incomplete records.
- Request erasure of your account data (subject to legal retention exceptions).
- Lodge a privacy complaint with our Data Protection Officer or the competent regulatory body.

### 6. Information Security Measures
- **Encryption:** All communication channels are protected using Transport Layer Security (TLS 1.3) and secure WebSockets (WSS).
- **Access Control:** Multi-tier role-based access control (RBAC) with deny-by-default policies and multi-factor authentication for administrative dashboards.
- **Storage Protection:** Passwords, OTP verification codes, and parcel delivery verification codes are cryptographically hashed using industry-standard hashing algorithms (bcrypt/HMAC-SHA256).

### 7. Children's Privacy
The Aarohan platform is strictly prohibited to individuals under 18 years of age. We do not knowingly solicit or collect data from minors.

### 8. Cross-Border Data Transfers
Application servers and database storage may be maintained in secure data centers located in [DATA_CENTER_REGIONS, e.g., European Union / South Africa]. [COMPANY_NAME] ensures appropriate safeguards and standard contractual clauses are implemented for all cross-border data processing.

### 9. Privacy Officer Contact
For inquiries regarding your personal data or to exercise your privacy rights, contact:
- Data Protection Officer: [DPO_EMAIL_ADDRESS]
- General Support: [SUPPORT_EMAIL]
- Telephone: [CUSTOMER_CARE_PHONE]
- Physical Office: [PHYSICAL_OFFICE_ADDRESS], Lilongwe, Malawi
