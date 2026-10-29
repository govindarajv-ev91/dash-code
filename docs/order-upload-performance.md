# Order Upload performance

Deploy the updated frontend and run `sql/fix_order_upload_production_timeout.sql`
in the app project's Supabase SQL Editor. This preserves order data and access
policies. It refreshes planner statistics and replaces the month-list aggregation
with indexed lookups, one per distinct visible month. Run this repair rather than
rerunning the table setup against existing production data.

Previously the page waited for sequential preview, existence probes, count,
month-list, and timestamp requests. The count helper could retry using an exact
COUNT, and month-list SQL grouped every order. After each upload, summary
requests and a second complete order/metrics sync added more work.

The page now shows its 25-row preview and timestamp first, then loads a planned
count and month list concurrently. Counts are labelled approximate (`~`), or as
a lower bound (`≥`) when statistics are unavailable. Empty tables need just the
preview request. Upload success uses saved rows immediately; summary refreshes
run separately. Daily uploads use two concurrent batches of at most 500 rows,
with smaller retries on database statement timeouts and visible save progress.
Complete order caches are patched and reused; a single-file patch cannot become
a complete cache. History caches are invalidated after saving.

Verification:

```text
node --test tests/order-upload-performance.test.mjs tests/order-upload-permissions.test.mjs tests/overview-order-loading.test.mjs
```

Tests use mocked requests and isolated PostgreSQL (PGlite). They establish request
counts, overlap, failure handling, cache completeness, month-list results, and
row security. Live project latency must be measured after deployment; local tests
do not establish production timings.
