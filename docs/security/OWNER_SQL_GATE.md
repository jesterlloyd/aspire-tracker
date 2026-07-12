# Owner SQL Gate: Consolidated Application Order

Every phase of the public-platform build is code-complete, deployed, and
verified in production, and every database change is drafted but NOT applied.
This file is the single ordered checklist for applying them. Run each file
WHOLE, as one block, in the Supabase SQL editor. Full per-wave detail lives
in [PHASE_0B_RLS_HARDENING.md](PHASE_0B_RLS_HARDENING.md); audit context in
[PHASE_0A_ACCESS_AUDIT.md](PHASE_0A_ACCESS_AUDIT.md).

## Step 0 (before anything): read-only live-state audit

Run `db/audit/phase0a_live_state_audit.sql` (SELECTs only, safe anytime) and
return all seven result sets. This confirms the ten audit findings against
the live database and may reveal dashboard-created policies the repository
cannot see. If it does, the waves get adjusted BEFORE you apply them.

## Application order

| # | File | Gate notes | Unlocks |
|---|---|---|---|
| 1 | `supabase/migrations/20260712000000_phase0b_wave_a_is_staff_helper.sql` | additive, safe anytime | Wave E |
| 2 | `supabase/migrations/20260712000001_phase0b_wave_b_drop_orphan_anon_policies.sql` | pure risk removal, no dependency | closes finding F1 (orphan tables) |
| 3 | `supabase/migrations/20260712000002_phase0b_wave_c_narrow_cohorts_anon.sql` | keeps public forms working | closes cohorts public-write |
| 4 | `supabase/migrations/20260712000003_phase0b_wave_d_form_backed_anon_removal.sql` | code prerequisite ALREADY live (74526e5); an intake window is open, apply in a quiet moment; stale tabs must refresh | closes F1 students, F3, F4 |
| 5 | `supabase/migrations/20260712000004_phase0b_wave_e_staff_rescope.sql` | requires 1; behavior-identical for all current users | closes F2 (role self-escalation), F5, F6; converts authenticated into a real boundary |
| 6 | `supabase/migrations/20260712000005_phase2_authz_foundation.sql` | requires 1 through 5; additive | portal role grants, scopes, student links |
| 7 | `supabase/migrations/20260712000006_phase2_student_portal_views.sql` | requires 6 | student portal reads |
| 8 | `supabase/migrations/20260712000007_phase3_unit_portal.sql` | requires 6 | unit leader portal reads, released_reports |
| 9 | `supabase/migrations/20260712000008_phase4_school_portal.sql` | requires 6 and 8; contains the ONE backfill (students.school_id, fills NULLs only, students.school untouched) | academic partner portal, schools normalization |
| 10 | `supabase/migrations/20260712000009_phase5_public_metrics.sql` | requires 1; additive, seeds nothing | public metrics workflow |

Each file ends with its own verification queries and (for waves) smoke tests.
Reverts: `db/audit/phase0b_reverts.sql` (per-wave sections); portal
migrations are additive, so their revert is dropping the new objects.

## Hard rule

No portal account may be invited (api/invite-portal-user) before files 1
through 6 are applied. Before the first invite, also run the user_profiles
constraint check in file 6's header comment.

## After application

1. Return the verification query outputs.
2. Staff regression: log in as each staff role (especially viewer and
   interviewer), open every tab, dismiss the onboarding tour, upload an
   avatar, open a rubric session.
3. Public forms smoke test (logged out): /student-form end to end,
   /unit-form pre-fill and submit, /school-form load, /interview-schedule,
   /shift-log, one tokenized evaluation link if available.
4. Pilot: invite ONE controlled student account (guarded workflow), verify
   the portal shows exactly that student's own data and nothing else, verify
   a staff account sees zero rows through the portal_my_* views, then decide
   on broader rollout.

## Wave F reminder (deferred by design)

Storage buckets (student-files is public-by-URL and holds resumes), the
untracked RPCs (get_all_user_profiles and friends), and findings F7 to F10
are remediated in a follow-up drafted AFTER the step 0 output shows the live
bucket flags and function ACLs.
