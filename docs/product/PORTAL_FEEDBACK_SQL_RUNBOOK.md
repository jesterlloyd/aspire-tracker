# Portal Feedback SQL Runbook

Codex authored but did not execute:

`supabase/migrations/20260724000000_portal_feedback_backend_foundation.sql`

Manual order:

1. Open the Supabase SQL editor.
2. Paste and run the entire migration as one block.
3. Confirm the transaction completes and the schema reload notification is sent.
4. Run read-only catalog checks for the three `portal_feedback_*` tables, both functions, RLS enabled, service-role grants, and Owner/Admin SELECT policies.
5. Only after SQL is applied, configure or enable any deployment-time schedule for `/api/cron/portal-feedback-delivery-worker`.

Do not apply any UI activation until the live endpoint, idempotency replay, rate limit, and worker retry behavior have been verified against the migrated database.
