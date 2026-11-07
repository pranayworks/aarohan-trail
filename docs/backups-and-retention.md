# Database Backups & Data Retention Guide
**Aarohan Urban Mobility Platform**  
**Lilongwe, Malawi • Legal Compliance & Disaster Recovery**

---

## 1. Supabase Automated Backups

Aarohan's production database runs on managed Supabase PostgreSQL.

* **Automated Daily Snapshots**: Supabase performs daily physical backups retained according to plan tier (7 days on Pro, 30 days on Enterprise).
* **Point-in-Time Recovery (PITR)**: Write-Ahead Logs (WAL) are streamed continuously, permitting database restoration to any exact second within the retention window.
* **Accessing Backups via Supabase Dashboard**:
  1. Open the Supabase Project Dashboard.
  2. Navigate to **Database** -> **Backups**.
  3. Select **Scheduled Backups** to download or restore a daily snapshot.

---

## 2. Manual CLI Backup Procedures

For pre-release snapshots or air-gapped archiving:

### Exporting Full Custom Format Backup (`pg_dump`):
```bash
# Uses the direct connection string (never print credentials)
pg_dump "$DIRECT_URL" -Fc -f "backups/aarohan_backup_$(date +%Y%m%d_%H%M%S).dump"
```

### Exporting Schema-Only Backup:
```bash
pg_dump "$DIRECT_URL" --schema-only -f "backups/aarohan_schema_$(date +%Y%m%d).sql"
```

### Restoring from Backup (`pg_restore`):
```bash
pg_restore --clean --no-acl --no-owner -d "$DIRECT_URL" "backups/aarohan_backup_TIMESTAMP.dump"
```

---

## 3. Data Retention Policy & Legal Preservation

* **Configurable Window**: Configured via `DATA_RETENTION_MONTHS` (default: `12` months).
* **Zero Deletion Code Policy**: Under current Malawian regulatory guidelines and Aarohan platform safety standards, **no automated hard deletion code is executed**. Completed rides, GPS points, tickets, ledger entries, and audit logs are preserved immutably.
* **Legal Retention Expiration Field**: Each completed record calculates a `retentionExpiresAt` timestamp (e.g. `createdAt + 12 months`), allowing future GDPR/DPA-compliant archiving once certified by legal counsel.

---

## 4. Trip Record CSV Export for Audits

Administrators can extract complete trip records (including GPS stops, commission split, and rider/driver identity) using `scripts/export-trip-records.js`:

```bash
# Export trips for a given date range
node scripts/export-trip-records.js --from 2026-11-01 --to 2026-11-30 --output exports/november_trips.csv
```

* Every export automatically writes an immutable row to `AuditLog` with action `TRIP_RECORDS_EXPORTED`, capturing the actor ID, date range, row count, and output destination.

