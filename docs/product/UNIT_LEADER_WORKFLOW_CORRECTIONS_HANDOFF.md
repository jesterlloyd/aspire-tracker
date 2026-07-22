# Unit Leader Portal workflow corrections: handoff

Date: 2026-07-21. Live baseline after this pass: `VITE_BUILD_SHA` `05af661`.

This pass shipped the two independent, no-SQL corrections (onboarding alert removal,
kebab un-clip) and stopped before the two that need a decision or a schema change. This
document is the handoff for those two: item 3 (Capacity) needs a product decision before
any behavior changes; item 4 (preceptor nomination) needs the gated migration below
before its six-field form can ship.

---

## Item 3: Capacity vs `/unit-form`, a genuine model conflict, decision needed

### The discrepancy

The brief asks the Unit Leader Capacity experience to use "the same fields, labels,
choices, validation, helper text, and canonical data definitions as `/unit-form`." Those
two surfaces write to **different data models with different grain and semantics**:

| | Public `/unit-form` | Unit Leader Capacity (today) |
|---|---|---|
| Component | `src/components/UnitFormPage.jsx` | `CapacityScreen` in `src/portal/UnitLeaderPortal.jsx` |
| Endpoint | `api/unit-form-submit.js` → `api/lib/unitResponseUpsert.js` | `api/portal/unit-capacity.js` → RPC `unit_capacity_submit` |
| Table(s) | `units` + `unit_cohort_responses` | `unit_capacity_submissions` |
| Grain | One whole-unit response per cohort | One row per (unit, cohort, **period**, **shift**) |
| Write semantics | Overwrite in place (`UNIQUE(cohort_id, unit_id)`) | Append-only, supersede lineage, ASPIRE review state |
| Fields | Slots offered, shift preference, preferred preceptors, **NGRP hiring intent**, **ASPIRE alumni experience**, considerations, submitter identity | Period label, period dates, shift, student count, notes |
| Shift vocabulary | `Day Shift / Night Shift / Mid Shift / Either / No Preference` | `any / day / evening / night / weekend` |

They overlap only on unit, a count, and a free-text notes field, and even those differ in
name, type, and (for shift) vocabulary.

### Why this is a decision, not a mechanical change

`unit_capacity_submissions` was a **locked decision on 2026-07-19**: a new capacity model
with review state and history, deliberately kept separate from `unit_cohort_responses`
(which is `UNIQUE(cohort_id, unit_id)` and overwrites in place). The new brief's ask to
"behave as though the Unit Leader is submitting the same unit availability form" points
back at the `unit_cohort_responses` model and its rich intake (NGRP hiring, alumni
experience). Those two intentions cannot both be satisfied by the same table: one is a
period/shift capacity ledger, the other is an annual whole-unit participation response.
The brief itself says to "report the discrepancy before changing behavior and recommend
the smallest safe unification." That is this section. **No Capacity behavior was changed
in this pass.**

Relevant fact: a portal endpoint that writes the canonical model **already exists but is
unwired**. `api/portal/unit-participation-submit.js` is the portal counterpart of
`api/unit-form-submit.js` and calls the same shared `performUnitResponseUpsert`
(`units` + `unit_cohort_responses`). No client code calls it today.

### Recommendation (smallest safe unification)

Point the Unit Leader Capacity screen at the **canonical participation model**, and retire
the separate `unit_capacity_submissions` path for the portal, in three steps:

1. **Extract a shared field schema.** The unit list already lives in
   `src/lib/unitCatalog.js`. Lift `SUBMITTER_ROLES`, `SHIFT_OPTIONS`, the NGRP/alumni
   option arrays, labels, helper text, and validation thresholds out of
   `UnitFormPage.jsx` into a shared module (e.g. `src/lib/unitAvailabilityForm.js`) that
   both `/unit-form` and the portal import. This is the single change that makes drift
   structurally impossible, which is the brief's core requirement. **Shift vocabulary is
   the sharpest divergence and must be unified here** so both forms and both server
   validators read one list.
2. **Reuse the existing portal endpoint.** Wire `CapacityScreen` to
   `api/portal/unit-participation-submit.js` (already canonical), prefilling and locking
   the Unit Leader's assigned unit (single unit), or restricting the picker to authorized
   units (multi-unit). Authorization and ASPIRE review are preserved because that endpoint
   already runs through `verifyPortalUnitLeaderCaller` and the shared upsert.
3. **Decide the fate of `unit_capacity_submissions`.** If the period/shift capacity ledger
   is still wanted as a separate concept, keep it as its own portal screen under a
   distinct name and do not conflate it with "unit availability." If it is not, leave the
   table in place (no destructive drop) but stop writing to it from the portal.

This unification needs **no schema change** (both target tables already exist), only app
code, and it is a material enough product change that it should be confirmed before
building. **Open question for Jester:** should the portal "Capacity" screen become the
canonical unit-availability form (recommended), and if so, is `unit_capacity_submissions`
retired or kept as a separate period/shift ledger?

---

## Item 4: Preceptor nomination, six-field form needs a migration (gated, provided)

### Why SQL is required

The approved form is: Student (optional), Preceptor Full Name (required), Email
(required), Phone (optional), Unit (required), Shift (required). The current schema
(`unit_preceptor_nominations`, created in
`supabase/migrations/20260720000000_unit_leader_portal_foundation.sql`) blocks it on two
independent facts:

1. `student_id` is `NOT NULL` (and `cohort_id`, derived from the student, is `NOT NULL`),
   so an optional Student is impossible as data-only.
2. There are no structured columns for email, phone, or shift. The only person field is
   `proposed_name`. Putting email/phone/shift into the free-text `note` would overload a
   notes field with structured data, which the task forbids.

Because both are hard schema facts, the six-field form **cannot** be built without a
migration. Per the brief's release rule, the current three-field form is **left
unchanged** this pass (no misleading partial form was shipped), and the migration is
provided gated, not applied.

### The migration (apply manually, after preflight)

- Migration: `supabase/migrations/20260721000000_unit_preceptor_nomination_fields.sql`
- Preflight + verification: `db/audit/unit_preceptor_nomination_fields_preflight_and_verification.sql`

It makes `student_id` and `cohort_id` nullable (FKs and cascade preserved), adds
`proposed_email`, `proposed_phone`, `proposed_shift` (nullable, so existing rows are
grandfathered), and pins `proposed_shift` to the **canonical Preceptor Directory set**
`('Day','Night','Mid','Variable')` via `chk_upn_proposed_shift`. `unit_key` stays
required. Audit attribution and the decision constraints are untouched. Fully reversible;
the rollback is in the migration header.

### Endpoint + form changes to make AFTER the migration is applied

These are the follow-up (do not build until the migration is live):

1. **`api/portal/unit-preceptor-nominations.js`**
   - Widen the accepted-field whitelist (currently `student_id, preceptor_id,
     proposed_name, note`) to also accept `unit_key`, `proposed_email`, `proposed_phone`,
     `proposed_shift`.
   - `student_id` becomes optional. When present, keep deriving `cohort_id` and `unit_key`
     from the scoped student (existing behavior) and keep the in-scope check. When absent,
     require a client `unit_key`, **validate it against the caller's `user_unit_scopes`**
     (never trust the client's unit), and set `cohort_id` from the accepting cohort or NULL.
   - Require `proposed_email` and `proposed_shift`; keep `proposed_name` required; phone
     optional.
   - Normalize email with `normalizeEmailForLookup` from `src/lib/emailUtils.js`.
   - **Existing-preceptor dedup:** look the normalized email up against the Preceptor
     Directory using the case-insensitive index `preceptors_email_lower_unique_idx`. If a
     match exists, return it so the UI can offer "use the existing record" and set
     `preceptor_id` instead of minting a duplicate proposed identity.
   - There is no phone-normalization util in the repo; add a small shared one
     (`src/lib/phoneUtils.js`) if normalized storage is wanted, or store phone as entered.

2. **`PreceptorScreen` in `src/portal/UnitLeaderPortal.jsx`**
   - Replace the three inputs with the six fields. Unit: prefilled and locked for a
     single-unit leader; a picker restricted to assigned units for a multi-unit leader
     (reuse the roster `units[].unit_key`, as the Capacity screen does).
   - Shift: the canonical `('Day','Night','Mid','Variable')` set (share it with the
     directory; do not re-inline a divergent list).
   - Student: optional select of in-scope students only.
   - On an email match from the endpoint, show the "use existing preceptor" affordance.
   - Keep it an ASPIRE-review nomination; **no canonical assignment write**.

3. **Tests to add with that work:** six approved fields present; Student genuinely optional
   (a nomination with no student inserts); unit cannot be an unauthorized unit; shift
   constrained to the canonical set; duplicate-email offers the existing directory record;
   no canonical assignment write occurs.

### Data-storage summary (canonical reuse)

| Form field | Column | Notes |
|---|---|---|
| Preceptor Full Name | `proposed_name` (existing) | required (app) |
| Email | `proposed_email` (new) | required (app), normalized, dedup vs directory |
| Phone | `proposed_phone` (new) | optional |
| Unit | `unit_key` (existing, stays NOT NULL) | validated against caller scope |
| Shift | `proposed_shift` (new) | canonical `Day/Night/Mid/Variable` |
| Student | `student_id` (now nullable) | optional; derives cohort/unit when present |
