# Unit Response Count Semantics (At a Glance, Placement Capacity)

Source of truth for how the Main App "At a Glance" Placement Capacity summary counts unit responses,
pending units, and confirmed slots. Written to correct a defect where the summary reported, for
example, `13 of 13 units responded · 17 slots confirmed · 0 pending` for a cohort (including Fall 2026)
in which roughly ten expected units had not responded.

## The defect (root cause, proven)

`src/components/OverviewTab.jsx` computed the summary from the response rows alone:

```
total     = unitResponses.length > 0 ? unitResponses.length : participating.length
responded = hosting.length + notHosting.length
pending   = unitResponses.filter(r => r.response_status === 'pending').length
"{responded} of {total} units responded · {slots} slots confirmed · {pending} pending"
```

Because `unit_cohort_responses` rows are created only when a unit submits (the upsert writes
`submitted_hosting` or `submitted_not_hosting`; it never writes a `pending` row), a unit that has not
responded has NO row at all. The denominator (`unitResponses.length`) therefore counts only units that
already responded, and `pending` counts only literal `pending`-status rows (effectively none). Units
with no row are invisible: they inflate neither the denominator nor pending, so the summary reads
"N of N responded, 0 pending" regardless of how many expected units are missing.

## Canonical concepts

### Total expected units

The cohort's unit roster: distinct `units` rows for the selected cohort that are part of the request
cycle. Because the schema has no explicit outreach-target table, the request cycle is derived as:

- a unit is **expected** when it is currently marked `is_participating = true` (in the roster) OR it has
  any `unit_cohort_responses` row for the cohort (it clearly was in the cycle).

This deliberately:

- includes units awaiting a response (rostered, no row yet) so they count as pending;
- includes units that DECLINED (a decline sets `units.is_participating = false` but writes a
  `submitted_not_hosting` response), so they still count as expected and responded;
- excludes staff-deactivated units that have no response (not in the cycle);
- never uses the global unit directory, another cohort's units, or duplicate aliases.

Distinctness is by canonical `unit.id`, never by display name, so spacing/alias variants of a unit name
resolve to one unit.

### Responded units

A distinct expected unit counts as responded when its canonical response has status
`submitted_hosting` or `submitted_not_hosting`. A zero-slot / decline (`submitted_not_hosting`) counts
as responded (the unit answered). A `pending` row, a missing row, or any non-submitted state does not.
The table is unique on `(cohort_id, unit_id)`, so there is one canonical response per unit; if any
duplicate ever existed, the latest by `last_updated_at` then `submitted_at` wins deterministically.

### Pending units

`pending = max(0, expected_distinct_units - responded_distinct_units)`. Pending is the expected units
that have not submitted a valid response, including units with no row at all. It is never negative and
is never defined as only the rows whose status literally equals `pending`.

### Slots confirmed

Sum of `slots_offered` from `submitted_hosting` responses of expected units only. Declines contribute
zero. Non-expected (orphan) responses, other cohorts, and non-hosting states contribute nothing.
Confirmed slots can never be negative.

## Shared aggregation

All of the above is computed by one pure, cohort-scoped helper,
`src/lib/unitResponseMetrics.js` -> `computeUnitResponseMetrics({ units, responses })`, returning:

```
{ expectedUnitCount, respondedUnitCount, pendingUnitCount, confirmedSlotCount,
  expectedUnitIds, respondedUnitIds, pendingUnitIds }
```

with left-join semantics from expected units to responses, `respondedUnitCount <= expectedUnitCount`,
`pendingUnitCount = max(0, expected - responded)`, and `confirmedSlotCount >= 0`. It changes no
authorization or portal scope (division/response counts never gate access).

## Display behavior

`{responded} of {expected} units responded · {slots} slots confirmed · {pending} pending`, and when
zero units are expected, the empty state `No unit response requests are configured for this cohort.`
instead of a misleading `0 of 0 units responded`. During load or error, the summary does not show a
false `0 pending`.

## Model gap and future source of truth

There is no explicit per-cohort outreach/request-target table today; the expected set is derived from
`units` (roster + responded). This is the smallest safe correction and needs no schema change. A future
enhancement could add an explicit cohort request-target table (which units were sent a capacity
request), which would make "expected" authoritative and independent of the `is_participating` flag.
This correction does NOT add a migration; it is an aggregation fix only.

## Read-only Owner diagnostic for Fall 2026 (do NOT run as part of this change)

Produces the per-unit diagnostic table (unit id, name, expected, response row, state, timestamp,
confirmed slots, counted-as-responded, counted-as-pending):

```sql
WITH fall AS (
  SELECT id FROM public.cohorts WHERE name = 'Fall 2026'
),
resp AS (
  SELECT DISTINCT ON (unit_id)
         unit_id, id AS response_id, response_status, slots_offered, submitted_at, last_updated_at
  FROM public.unit_cohort_responses
  WHERE cohort_id = (SELECT id FROM fall)
  ORDER BY unit_id, last_updated_at DESC NULLS LAST, submitted_at DESC NULLS LAST
)
SELECT
  u.id                                              AS unit_id,
  u.unit_name,
  (u.is_participating OR r.unit_id IS NOT NULL)     AS expected_for_cohort,
  r.response_id,
  r.response_status,
  r.submitted_at,
  CASE WHEN r.response_status = 'submitted_hosting'
       THEN COALESCE(r.slots_offered, 0) ELSE 0 END AS confirmed_slots,
  (r.response_status IN ('submitted_hosting', 'submitted_not_hosting')) AS counted_as_responded,
  ((u.is_participating OR r.unit_id IS NOT NULL)
     AND COALESCE(r.response_status, '') NOT IN ('submitted_hosting', 'submitted_not_hosting'))
                                                     AS counted_as_pending
FROM public.units u
LEFT JOIN resp r ON r.unit_id = u.id
WHERE u.cohort_id = (SELECT id FROM fall)
ORDER BY u.unit_name;
```
