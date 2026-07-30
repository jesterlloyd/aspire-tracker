# Capacity Response Outreach (Send to Many → response targets)

How a unit becomes an expected responder for a cohort, and how that connects to ASPIRE Connect
outreach. Companion to `docs/product/UNIT_RESPONSE_COUNT_SEMANTICS.md`.

## Approved workflow

A unit becomes **expected to respond** when the Owner/Admin sends that unit the cohort
capacity-response form through **ASPIRE Connect → Outreach → Send to Many**, or when it is added
manually through the **Configure response targets** fallback. The successfully targeted units become
active rows in `public.cohort_unit_response_targets`, and At a Glance then computes:

- expected = active targets
- responded = targeted units with `submitted_hosting` or `submitted_not_hosting`
- pending = expected minus responded
- confirmed slots = hosting slots from targeted responses only
- orphan responses = submitted responses not matched to a target

## Existing send architecture (reused, not replaced)

- UI: `src/components/connect/BulkManualComposer.jsx` (Send to Many). Recipient sources are
  `students`, `contacts` (unit leaders live in `contacts`), and paste. Contact-keyed; writes no DB rows.
- Send endpoint: `/api/connect-send-bulk-message`. Owner/Admin auth, required UUID `batch_id`,
  sequential per-recipient isolation (each recipient lands in exactly one of sent/skipped/failed),
  within-batch idempotency, one `notification_log` row per success. Email is dispatched externally, so
  a send and the target write cannot be one database transaction.
- Recipient resolution: a unit's primary lead comes from `unit_leaders` (`is_primary_lead`,
  `is_active`, `email`), via `src/lib/unitLeaders.js`.

## Truthful send/target semantics (non-atomic)

Because dispatch is external, targets are recorded only for units actually accepted by the send path:

1. validate all selections first (cohort, template, units, resolved recipients)
2. send through the existing endpoint
3. configure/reactivate targets ONLY for units confirmed successfully queued/accepted
4. return per-unit results; a sent unit whose target write failed is flagged for reconciliation
5. a failed or unsent unit is never marked sent or expected
6. re-send to an already-active target does not duplicate (durable-row model)
7. send to a previously removed target reactivates the same durable row
8. sending creates no hosting capacity and no response row

## This release (safe pieces; live dispatch deferred)

Landed now, without touching the proven email send path:

- **Unit-keyed selection** from the full canonical catalog (`src/lib/unitCatalog.js`, all 28 units,
  including the two default-ineligible units) with division and recipient-readiness shown. The catalog,
  not `public.units`, is the available-unit list; a unit is never excluded for lacking a cohort row.
  Pure logic in `src/lib/capacityOutreach.js` (`buildCapacityOutreachRows`, `capacityOutreachCounts`).
- **Recipient readiness**: each unit resolves its active primary lead from `unit_leaders`; units with no
  resolvable active recipient are visibly flagged (not send-ready). Aliases resolve through the
  canonical key; duplicate recipients/targets are prevented.
- **Target linkage** through the existing Owner/Admin server API / atomic RPC. In this release the
  selection confirms targets through the **manual Configure response targets** path (no email is sent);
  when live dispatch is wired, targets will be configured only for successfully-sent units.
- **At a Glance deep-link**: when targets are not configured, the honest summary
  `{n} unit responses received · {slots} slots confirmed · response targets not set` gains an
  Owner/Admin **Send capacity request** action that opens the capacity outreach selection with the
  current cohort preselected. When targets exist, the summary stays
  `{responded} of {expected} units responded · {slots} slots confirmed · {pending} pending` with the
  accessible pending and orphan lists.

## Template

`templateRegistry.js` exports `CAPACITY_RESPONSE_TEMPLATE` (a `unit_leader`-audience, Send-to-many
template metadata for the capacity-response request). It is registered as the single source of truth
but is **not yet wired into the live composer send lists**; the body/builder and live dispatch are
finalized in the separately-reviewed send change.

## Security

Owner/Admin only for the target-linked capacity selector and all target writes (server-verified).
Students, Unit Leaders, and Academic Partners cannot access the selector or read the target/event
tables (RLS denies anon/authenticated; access is service-role after authorization). No portal
authorization is derived from response targets. Existing message/outreach privacy and audit are
unchanged.

## Additional SQL

None beyond the existing unapplied `20260731030000_add_cohort_unit_response_targets.sql`. No new table.
