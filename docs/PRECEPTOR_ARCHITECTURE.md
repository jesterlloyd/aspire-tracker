# Preceptor Architecture

This document describes how preceptor data is stored, related, and maintained in the ASPIRE Intelligence database. It is the source of truth for Phase B preceptor management work.

---

## Background

Before Phase B.1, preceptor data existed only as free-text scattered across seven tables. A `preceptors` table was created in `migration_phase1_analytics.sql` but never populated or used by any frontend code.

Phase B.1 (`migration_preceptor_schema_v2.sql`) establishes the normalized structure. **No automated backfill** — preceptor records will be entered manually through the Phase B.3 admin UI. Two prior migration files (`migration_preceptor_normalization.sql`, `migration_preceptor_backfill.sql`) failed to execute against the database (wrong table name `shift_logs` instead of `student_shift_logs`, no transaction wrapping) and have been renamed `.deprecated`. The v2 migration is a single atomic `BEGIN/COMMIT` transaction.

The free-text fallback fields are **preserved** during Phase B.1; Phase B.2 will wire the frontend to write normalized FKs and Phase B.3 will build the Preceptors sub-tab UI.

---

## Tables

### `public.preceptors`

The canonical preceptor registry. One row per unique preceptor, identified by email (case-insensitive).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `full_name` | TEXT NOT NULL | Display name |
| `unit_id` | UUID FK → `units.id` | Primary unit assignment; nullable |
| `unit_name` | TEXT | Denormalized copy of the unit name for fast display |
| `email` | TEXT | Identity key; enforced unique via partial index (see below) |
| `phone` | TEXT | Optional contact |
| `shift_type` | TEXT | `'Day'`, `'Night'`, `'Mid'`, or `'Variable'` (default) |
| `is_active` | BOOLEAN | Whether the preceptor is available this cycle |
| `cohorts_participated` | INTEGER | Denormalized count — kept in sync by trigger (see Triggers) |
| `total_students_precepted` | INTEGER | Denormalized count — kept in sync by trigger (Phase B.2) |
| `last_active_cohort` | TEXT | Cohort name of most recent participation — trigger-synced |
| `last_active_date` | DATE | Date of most recent participation — trigger-synced |
| `notes` | TEXT | Free-form notes |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | Auto-updated on every write via trigger |

#### Email as Identity Key

Email is the stable identity key for deduplication. A partial unique index enforces uniqueness case-insensitively:

```sql
CREATE UNIQUE INDEX preceptors_email_unique_idx
  ON public.preceptors (lower(trim(email)))
  WHERE email IS NOT NULL AND trim(email) != '';
```

The partial condition (`WHERE email IS NOT NULL AND trim(email) != ''`) allows multiple rows with null or empty email during backfill of name-only preceptors. When an email becomes known for a name-only record, update that row rather than inserting a duplicate.

---

### `public.preceptor_cohort_participation`

Junction table: which preceptors were active in which cohorts.

This is the **source of truth** for cohort history. The `cohorts_participated`, `last_active_cohort`, and `last_active_date` columns on `preceptors` are denormalized caches synced by trigger from this table.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `preceptor_id` | UUID FK → `preceptors.id` CASCADE DELETE | |
| `cohort_id` | UUID FK → `cohorts.id` CASCADE DELETE | |
| `status` | TEXT | `'active'`, `'inactive'`, `'completed'` |
| `started_at` | DATE | When the preceptor joined this cohort |
| `ended_at` | DATE | When they finished (null = still active) |
| `notes` | TEXT | Per-cohort notes |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

`UNIQUE (preceptor_id, cohort_id)` — one participation record per preceptor per cohort.

---

## Preceptor-to-Unit Relationship

A preceptor is linked to a unit via `preceptors.unit_id` (FK to `units.id`). This is their **primary** unit. A preceptor may appear in multiple cohorts across different units (rotation), but the `unit_id` reflects their current or most recent assignment.

`preceptors.unit_name` is a denormalized text copy for display without a join. Keep it in sync whenever `unit_id` is updated.

---

## Preceptor-to-Student Relationship

Three layers, from most authoritative to least:

1. **`students.preceptor_id`** (UUID FK → `preceptors.id`) — normalized reference; written by Phase B.2 frontend
2. **`students.matched_preceptor`** (TEXT) — free-text name; written by coordinators manually today
3. **`students.preceptor_email`** (TEXT) — free-text email; drives Action Center communications

`matches.preceptor_id` mirrors the student's assignment at the match level (one row per student-unit pair). `matches.preceptor_assigned` (TEXT) is the free-text fallback.

During Phase B.1, `students.preceptor_id` is backfilled by joining on `lower(trim(preceptor_email)) = lower(trim(preceptors.email))`. Phase B.2 will ensure all new writes go to the normalized FK in addition to (not instead of) the free-text fields until the transition is complete.

---

## Free-Text Fallback Fields (preserved through Phase B.2)

These fields **must not be cleared** until Phase B.2 confirms the normalized FKs are being reliably written by the frontend:

| Table | Column | Role |
|---|---|---|
| `students` | `matched_preceptor` | Coordinator-entered name; drives UI display today |
| `students` | `preceptor_email` | Drives all Action Center email actions |
| `matches` | `preceptor_assigned` | Inline name edited in UnitCard |
| `units` | `preceptors` | Free-text names from unit leader form |
| `unit_cohort_responses` | `preferred_preceptors` | Unit leader's submitted preference text |
| `shift_logs` | `preceptor_name` | Student-entered name on shift log |

---

## Triggers

### `sync_preceptor_denormalized_fields()`

Fires `AFTER INSERT OR UPDATE OR DELETE` on `preceptor_cohort_participation`. Recomputes and writes:
- `preceptors.cohorts_participated`
- `preceptors.last_active_cohort`
- `preceptors.last_active_date`

Since denormalized values are computed fresh from the junction table on every change, they are always correct without any manual synchronization.

### `sync_preceptor_student_count()`

Function defined in Phase B.1. Trigger **not yet attached** — will be created in Phase B.2 when `students.preceptor_id` starts being written by the frontend.

When attached, fires `AFTER INSERT OR UPDATE OF preceptor_id OR DELETE` on `students` and recomputes `preceptors.total_students_precepted`.

To activate in Phase B.2:
```sql
CREATE TRIGGER sync_preceptor_student_count_after_change
  AFTER INSERT OR UPDATE OF preceptor_id OR DELETE
  ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_preceptor_student_count();
```

---

## RLS Policies

### `preceptors`

| Policy | Role | Operation |
|---|---|---|
| `authenticated_read_preceptors` | authenticated | SELECT — anyone logged in can read |
| `owners_insert_preceptors` | authenticated | INSERT — only `is_owner = true` |
| `owners_update_preceptors` | authenticated | UPDATE — only `is_owner = true` |
| `owners_delete_preceptors` | authenticated | DELETE — only `is_owner = true` |
| `service_role_full_preceptors` | service_role | ALL — for API/edge functions |

Ownership is checked via:
```sql
EXISTS (
  SELECT 1 FROM public.user_profiles
  WHERE auth_user_id = auth.uid() AND is_owner = true
)
```

Note: `user_profiles` uses `auth_user_id` (not `user_id`) to link to Supabase Auth, and ownership is the `is_owner` boolean column (not a role string).

### `preceptor_cohort_participation`

Same policy structure as `preceptors`: read-for-all-authenticated, write-for-owners-only, service_role full access.

---

## `preceptor_review_queue` View

A non-materialized view defined in `migration_preceptor_backfill.sql`. Returns every student row with a non-empty `matched_preceptor` and classifies it:

| Status | Meaning |
|---|---|
| `resolved` | `students.preceptor_id` was set — preceptor is in the normalized table |
| `needs_email` | Preceptor name exists but no email — can't auto-match; coordinator must add email |
| `unresolved` | Email present but no matching preceptors row — investigate why |

Query:
```sql
SELECT * FROM public.preceptor_review_queue ORDER BY status, cohort_name, name_text;
```

Use this view in Phase B.3 admin UI to surface and resolve outstanding preceptor records.

---

## Migration Script

`migration_preceptor_schema_v2.sql` is the single atomic migration for Phase B.1. It must be run manually in the Supabase SQL Editor.

**What it does:**
1. Preamble DO block verifies all required tables exist before opening the transaction
2. Drops duplicate RLS policies on `preceptors` and replaces with the clean role-based set
3. Adds `shift_type` column to `preceptors`
4. Creates partial unique index on `lower(trim(email))`
5. Creates `preceptor_cohort_participation` junction table with RLS and updated_at trigger
6. Adds `preceptor_id` FK to `matches`
7. Adds `preceptor_id` FK to `student_shift_logs`
8. Creates `sync_preceptor_denormalized_fields()` function and trigger
9. Creates `preceptor_review_queue` view
10. COMMITs — or rolls back the entire transaction if any step fails

**Rollback:** The transaction is atomic. If any statement fails, nothing is applied. If the migration commits successfully and you need to undo it, run:
```sql
DROP TABLE IF EXISTS public.preceptor_cohort_participation CASCADE;
DROP VIEW  IF EXISTS public.preceptor_review_queue;
ALTER TABLE public.matches           DROP COLUMN IF EXISTS preceptor_id;
ALTER TABLE public.student_shift_logs DROP COLUMN IF EXISTS preceptor_id;
ALTER TABLE public.preceptors        DROP COLUMN IF EXISTS shift_type;
DROP INDEX IF EXISTS preceptors_email_lower_unique_idx;
DROP FUNCTION IF EXISTS public.sync_preceptor_denormalized_fields() CASCADE;
```

---

## Phase Roadmap

| Phase | Work | Status |
|---|---|---|
| B.1 | Schema normalization + backfill (this document) | Complete |
| B.2 | Frontend wiring: write `preceptor_id` alongside free-text fields on new assignments | Not started |
| B.3 | Preceptors sub-tab UI: roster view, cohort history, assignment panel | Not started |

Phase B.2 begins by updating `UnitCard.jsx` and `StudentSidePanel.jsx` to resolve and write `preceptor_id` when a coordinator edits `matched_preceptor` or `preceptor_email`. The free-text fields continue to be written in parallel until B.3 confirms the normalized path is stable.
