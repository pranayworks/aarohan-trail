# AArohan Smart Urban Mobility Platform
**Lilongwe, Malawi • Transport & Delivery Architecture**

## Database Configuration & Testing Isolation

### Testing Database (`DATABASE_URL_TEST`)
To run automated test suites against an isolated test database rather than the local development database, set the `DATABASE_URL_TEST` environment variable in your terminal before running tests:

```bash
# Example test database connection
export DATABASE_URL_TEST="postgresql://postgres:password@localhost:5432/aarohan_test"
npm test
```

When `DATABASE_URL_TEST` is present:
- Prisma automatically points its data source to the specified test database.
- The shared test helper (`tests/test_helper.js`) validates the target connection URL and ensures tests never execute against any database containing keywords like `prod`, `production`, `live`, or `real`.
- Before and after test runs, `setupTestIsolation` and `teardownTestIsolation` automatically clean up test fixtures, cancel orphaned in-flight trips, and reset driver commission debts for all test fixtures.

### Test Database Allowlist Guard
Tests enforce strict allowlist protection to guarantee test execution never touches production:
Tests will **only run** if:
1. `DATABASE_URL_TEST` is explicitly provided, pointing to a dedicated test database, OR
2. The active database host or Supabase project reference matches `TEST_DB_PROJECT_REF` (e.g. `phdklphyjnulgfylkcgp`).

If neither condition is met, tests immediately abort with a clear message:
`TEST DB GUARD ABORT: Tests may only run if DATABASE_URL_TEST is set, or if the active database host or project ref matches TEST_DB_PROJECT_REF.`

### Running Tests
```bash
# Run the complete test suite (all 14 verification suites)
npm test

# Run single test suite
node tests/test_sms_gateway.js
node tests/test_production_readiness.js
```
