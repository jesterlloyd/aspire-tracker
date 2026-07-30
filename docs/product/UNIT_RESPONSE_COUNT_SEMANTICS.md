# Unit Response Count Semantics (At a Glance, Placement Capacity)

Source of truth for how the Main App "At a Glance" Placement Capacity summary counts unit responses,
pending units, and confirmed slots, and for the model correction behind it.

## The defect

The summary reported, for example, `13 of 13 units responded · 17 slots confirmed · 0 pending` for a
cohort (including Fall 2026) in which roughly ten expected units had not responded.

## Two facts that make the count hard

1. **Response rows are not the denominator.** `unit_cohort_responses` rows are created only when a unit
   submits (the upsert writes `submitted_hosting` or `submitted_not_hosting`; it never writes a
   `pending` row). A unit that has not responded has no response row, so counting responded units
   against `unitResponses.length` always yields "N of N, 0 pending".

2. **Cohort `units` rows are not the denominator either, unless they are proven to be the full request
   roster.** `public.units` rows are created LAZILY: on a submission (`api/lib/unitResponseUpsert.js`),
   or when staff manually seed via `UnitSetupPanel` / `ImportUnitsCSV`. Cohort creation seeds zero
   units, and nothing copies a roster forward between cohorts. `units.is_participating` is a
   response/host OUTCOME (a decline sets it false), not an outreach-target flag. The Owner's Fall 2026
   diagnostic confirmed this: cohort `eedd91ec-...` has exactly 13 `units` rows and all 13 responded, so
   any `units`-derived denominator (including `is_participating OR has-response`) still shows 13 of 13.

**Missing outreach targets cannot be reconstructed from missing response rows alone.** A unit that was
asked but never responded, and was never manually seeded, has no row in `units` and no row in
`unit_cohort_responses`. There is no silence to count.

## Canonical concepts

### Expected units (outreach targets)

`Pending` must mean **expected outreach targets with no valid submitted response**. Pending is never
inferred from silence unless the unit is a known outreach target. Because no explicit target source
exists today, the expected set is an **explicit per-cohort target list**, `cohort_unit_response_targets`
(see below). Distinctness is by canonical unit identity (unit_id when available, else a normalized unit
key), never by display label.

### Responded units

A distinct target counts as responded when its canonical response status is `submitted_hosting` or
`submitted_not_hosting`. A zero-slot decline (`submitted_not_hosting`) counts as responded. `pending`,
drafts, missing rows, and any non-submitted state do not. The response table is unique on
`(cohort_id, unit_id)`; if any duplicate existed, the latest by `last_updated_at` then `submitted_at`
wins.

### Pending units

`pending = max(0, targets - responded_targets)`, never negative, never defined as only literal
`pending`-status rows.

### Slots confirmed

Sum of `slots_offered` from `submitted_hosting` responses for the cohort (target-independent; a decline
contributes zero, negatives clamp to zero).

### Orphan responses

A submitted response whose unit is not a target contributes to slots confirmed but not to the
responded/expected target counts (left-join is FROM targets TO responses).

## Shared aggregation

`src/lib/unitResponseMetrics.js` -> `computeUnitResponseMetrics({ targets, responses })` returns:

```js
{ configured, expectedUnitCount, respondedUnitCount, pendingUnitCount, confirmedSlotCount,
  submittedResponseCount, expectedUnitIds, respondedUnitIds, pendingUnitIds, pendingUnitNames }
```

- `configured` is true only when the cohort has at least one target. When false, the caller must NOT
  show a "0 pending" completeness claim.
- left-join from targets to responses; `respondedUnitCount <= expectedUnitCount`;
  `pendingUnitCount = max(0, expected - responded)`; `confirmedSlotCount >= 0`.
- pure and cohort-scoped (both inputs are already scoped to one cohort); no authorization or portal
  scope is derived from it.

## Display behavior

- **Configured cohort:** `{responded} of {expected} units responded · {slots} slots confirmed ·
  {pending} pending`. When pending > 0, the pending unit names (from the target list, never invented
  from the global catalog) are surfaced as an accessible title on the summary.
- **Unconfigured cohort (no targets yet, e.g. Fall 2026 today):** an honest message that does NOT claim
  completeness, e.g. `{n} unit responses received · {slots} slots confirmed · response targets not set`.
  It never shows `0 pending`.
- During load or error, the summary shows a neutral state, never a false `0 pending`.

## Data model correction (Owner-gated; applied in production by the Owner on 2026-07-29)

`supabase/migrations/20260731030000_add_cohort_unit_response_targets.sql` adds
`public.cohort_unit_response_targets`:

- `id`, `cohort_id` (FK), `unit_key` (canonical stable unit name), optional `unit_id` (FK to a `units`
  row when one exists), `requested_at`, `requested_by_profile_id`, `is_active` (soft-remove; removing a
  target is auditable via `removed_at`/`removed_by_profile_id`), `created_at`, `updated_at`.
- UNIQUE `(cohort_id, unit_key)`; target rows exist before responses; responses stay in
  `unit_cohort_responses`; pending = targets minus submitted responses.
- No portal authorization is derived from target rows (they are descriptive data only).
- **Backfill is Owner-gated and needs an approved unit list.** The migration does NOT guess Fall 2026
  targets; it ships a commented backfill template the Owner completes with the approved outreach set.

### Hardened integrity (final model)

- **One durable row** per cohort + canonical unit: `UNIQUE (cohort_id, unit_key_canon)` (a generated
  canonical column). Add creates it, remove marks it inactive, add/restore reactivates the same row;
  raw/service writes cannot create a second row.
- **Cohort-compatible `unit_id`** is enforced in the database by trigger `curt_enforce_cohort_unit`
  (rejects a non-null `unit_id` whose `units.cohort_id` differs); `ON DELETE SET NULL` clears only
  `unit_id`.
- **Append-only history** in `public.cohort_unit_response_target_events` (created/deactivated/
  reactivated), written atomically by trigger, service-role only. Reactivation refreshes `requested_at`
  /`requested_by` on the durable row while every prior transition stays in the events table. History is
  **stored but not surfaced in the management UI in this release** (available for a future viewer).
- Single-row **deactivate/reactivate are idempotent**: an already-inactive deactivate or already-active
  reactivate returns a safe state result (`changed:false`), not an error. The API returns only coded
  errors, never raw database text.
- **Atomic bulk configuration** via the service-role-only RPC `configure_cohort_unit_response_targets`
  (validate-all-then-write; no partial apply); the API calls it after the owner/admin gate.

### Operational gate and disable path

Readiness requires **both**: the server flag `COHORT_UNIT_RESPONSE_TARGETS_ENABLED` equal to the exact
lowercase string `true` (server-only, no `VITE_` prefix) **and** the service-role sentinel
`cohort_unit_response_targets_ready()`. Missing/other flag or a failed probe fails closed (list returns
`ready:false`, writes return 503). **Operational disable:** unset `COHORT_UNIT_RESPONSE_TARGETS_ENABLED`
and redeploy: the feature disables while **target and audit data are preserved**; no need to drop the
sentinel function. One-time unit response submission is unaffected either way.

### Cohort initialization (future cohorts)

To stop this recurring, cohort setup should seed the intended target list into
`cohort_unit_response_targets` before outreach (from the prior cohort's targets or a chosen roster).
That workflow change is proposed here and is intentionally not implemented in this data-model pass.

## Read-only Owner diagnostics for Fall 2026 (do NOT run as part of this change)

Cohort id `eedd91ec-ad6f-4df8-aa20-5c06b2889011`.

```sql
-- A. Current roster (known: 13 rows, all responded)
SELECT u.id AS unit_id, u.unit_name, u.is_participating,
       r.response_status, r.slots_offered, r.submitted_at
FROM public.units u
LEFT JOIN public.unit_cohort_responses r
  ON r.cohort_id = u.cohort_id AND r.unit_id = u.id
WHERE u.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
ORDER BY u.unit_name;

-- B. Prior-cohort comparison: which units the PRIOR cohort had that Fall 2026 lacks (candidate
--    outreach targets). Replace :prior_cohort_id with the immediately preceding cohort id.
SELECT COALESCE(pu.unit_name, fu.unit_name) AS unit_name,
       (pu.id IS NOT NULL) AS in_prior_cohort,
       (fu.id IS NOT NULL) AS in_fall_2026,
       pr.response_status  AS prior_response,
       fr.response_status  AS fall_response
FROM public.units pu
FULL OUTER JOIN public.units fu
  ON regexp_replace(upper(coalesce(fu.unit_name,'')), '[^A-Z0-9]', '', 'g')
   = regexp_replace(upper(coalesce(pu.unit_name,'')), '[^A-Z0-9]', '', 'g')
  AND fu.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
LEFT JOIN public.unit_cohort_responses pr ON pr.unit_id = pu.id
LEFT JOIN public.unit_cohort_responses fr ON fr.unit_id = fu.id
WHERE pu.cohort_id = :prior_cohort_id OR fu.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
ORDER BY unit_name;

-- C. Canonical catalog gap: the approved catalog names are in src/lib/unitCatalog.js (28 units, 2
--    default-ineligible). For each, check for a Fall 2026 units row, an active unit leader, and any
--    Fall 2026 response. (Run per name, or load the catalog names into a VALUES list.)
SELECT n.unit_name,
       (u.id IS NOT NULL)  AS has_fall_units_row,
       (ul.unit_name IS NOT NULL) AS has_active_unit_leader,
       (r.id IS NOT NULL)  AS has_fall_response
FROM (VALUES ('6 NE'), ('6 NW') /* ...approved catalog names... */) AS n(unit_name)
LEFT JOIN public.units u
  ON u.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011' AND u.unit_name = n.unit_name
LEFT JOIN public.unit_leaders ul ON ul.unit_name = n.unit_name AND ul.is_active = true
LEFT JOIN public.unit_cohort_responses r
  ON r.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011' AND r.unit_id = u.id
ORDER BY n.unit_name;

-- D. Outreach evidence: there is no per-unit-per-cohort request-dispatch record in the schema, so
--    outreach cannot be reconstructed from data. The approved target list must come from the Owner.
```
