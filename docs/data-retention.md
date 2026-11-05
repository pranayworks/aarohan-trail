# AArohan Data Retention & Lifecycle Policy
**Scope:** Lilongwe, Malawi Multi-Tier Mobility & Settlement Platform  
**Effective Version:** 1.0 (Draft Policy)  
**Config Key:** `DATA_RETENTION_MONTHS` (Default: `12` months)

---

## 1. Overview and Purpose
This document establishes the authoritative data retention schedule and guidelines for personal, spatial, and financial records processed by the AArohan platform in Lilongwe, Malawi.

The retention window balances user privacy rights with statutory requirements under Malawi law, insurance dispute periods, accident investigation requirements, and financial audit standards.

---

## 2. Retention Configuration
The retention window is configured at the system level via environment variable:

```ini
DATA_RETENTION_MONTHS=12
```

- **Default Value:** 12 months (365 days).
- **Enforcement Scope:** Read and referenced across platform auditing and reporting modules.
- **Automated Deletion Status:** **NO AUTOMATED DELETION CODE YET**. Hard-deletion routines and automated pruning crons will be scheduled only following final legal and regulatory sign-off.

---

## 3. Retained Data Categories & Justifications

| Category | Primary Database Tables | Retention Duration | Regulatory & Legal Rationale |
| :--- | :--- | :--- | :--- |
| **Active Ride Records** | `Trip`, `TripStop`, `TripStatusHistory` | 12 Months | Dispute settlement, insurance investigations, Malawi Road Traffic Authority accident inquiries. |
| **High-Precision GPS Trails** | `TripLocationPoint` (10s append-only breadcrumbs) | 12 Months | Route reconstruction for safety incidents, fraud verification, passenger-driver dispute arbitration. |
| **Customer Support & Disputes** | `SupportTicket`, `TicketMessage` | 12 Months | Audit resolution tracking, passenger safety escalation records, service quality oversight. |
| **Courier & Parcel Delivery** | `ParcelDetail` | 12 Months | Delivery verification, damage claims, receipt proof records. |
| **Financial & Commission Ledgers** | `LedgerEntry`, `DriverSettlement` | 7 Years | Statutory Malawi Revenue Authority (MRA) tax compliance, independent accounting audit standards. |
| **Driver KYC Documents** | Driver profile, National ID, vehicle certificates | Duration of active tenure + 3 years | Malawi Road Traffic Act compliance and public passenger transport operator requirements. |
| **Security & Admin Audit Logs** | `AuditLog` (append-only) | 24 Months | Forensic auditing, data access tracking, insider threat monitoring. |

---

## 4. Account Deletion Requests
When a user requests account termination under their privacy rights:
1. Active authentication sessions and device push notification tokens (`DeviceToken`) are immediately revoked.
2. The user profile is marked as `DEACTIVATED`.
3. Historical trip logs, safety breadcrumbs, and financial ledger rows associated with the user are retained until the expiration of the statutory `DATA_RETENTION_MONTHS` window, after which they will be permanently purged or anonymized.

---

## 5. Implementation Roadmap
- **Phase 1 (Current):** Parameterized configuration via `DATA_RETENTION_MONTHS=12` and standardized legal draft disclosures.
- **Phase 2 (Post-Legal Review):** Automated partitioned tables with archived storage and scheduled vacuum/purge routines for records older than the active retention window.
