# Phase 0B RLS Hardening: Owner Runbook

Companion to [PHASE_0A_ACCESS_AUDIT.md](PHASE_0A_ACCESS_AUDIT.md). Phase 0B
closes the audited exposures policy by policy, in five independently
applicable and independently revertible waves. Nothing in this phase is
applied automatically: every wave is a SQL file the Owner pastes into the
Supabase SQL editor as one block.

## Order of operations

| Step | What | Who | File |
|---|---|---|---|
| 0 | Run the read-only live-state audit, return all seven result sets | Owner | `db/audit/phase0a_live_state_audit.sql` |
| 1 | Wave A: create `is_staff()` helper (additive, no behavior change) | Owner | `supabase/migrations/20260712000000_phase0b_wave_a_is_staff_helper.sql` |
| 2 | Wave B: drop orphan anon policies (no workflow dependency) | Owner | `supabase/migrations/20260712000001_phase0b_wave_b_drop_orphan_anon_policies.sql` |
| 3 | Wave C: cohorts anon narrowed to SELECT | Owner | `supabase/migrations/20260712000002_phase0b_wave_c_narrow_cohorts_anon.sql` |
| 4 | Confirm the Wave D application release is live (build SHA check) | Owner or Claude | Settings, General, About |
| 5 | Wave D: students, units, unit_cohort_responses anon removal | Owner | `supabase/migrations/20260712000003_phase0b_wave_d_form_backed_anon_removal.sql` |
| 6 | Wave E: staff re-scope, user_profiles and activity_logs shapes | Owner | `supabase/migrations/20260712000004_phase0b_wave_e_staff_rescope.sql` |
| 7 | Return the Wave verification query outputs and smoke-test results | Owner | verification queries are embedded at the end of each wave file |

Run each wave file WHOLE, as a single block. Waves A, B, C are safe in any
order relative to each other; Wave D requires the code release; Wave E
requires Wave A. Step 0's output may reveal dashboard-created policies the
repository cannot see; if it does, Claude adjusts the waves before you apply
them, so returning step 0's output BEFORE applying waves is strongly
preferred.

## The Wave D code release (shipped with this runbook)

The same commit that adds these files rewires the two public forms off their
direct anon database access:

- `/student-form`: the pre-submit student lookup now calls
  `api/student-intake-lookup.js` (returns opaque IDs only, shared eligibility
  semantics with `student-intake-submit` via `api/lib/intakeStudentLookup.js`).
- `/unit-form`: pre-fill now calls `api/unit-form-lookup.js` (allow-listed
  fields, server-resolved cohort); submission now calls
  `api/unit-form-submit.js` (server-resolved cohort, server-managed
  submission_count and timestamps, units row upsert included).

Behavior preserved deliberately: identical field mapping, identical error
messages, identical accepting-cohort semantics, the notification email still
fires via `api/unit-form-notification.js`, and the UI timeout guards in
UnitFormPage are unchanged. One improvement beyond parity: the server now
resolves the accepting cohort itself, so a forged request can no longer write
into an arbitrary cohort.

## Rollback

- Application: revert the Wave D commit and redeploy (the previous client
  paths return, which requires the anon policies still or again in place).
- Database: `db/audit/phase0b_reverts.sql` restores any wave's prior policy
  state exactly; each section is independent. Reverting reintroduces the
  corresponding audited exposure.

## Known-risk notes

- Stale tabs: visitors holding a pre-release tab of /student-form or
  /unit-form when Wave D is applied will fail on direct table access until
  they refresh. Apply Wave D outside active form-collection windows.
- get_my_profile is dashboard-created and untracked. Wave E defensively
  grants self-update on last_login_at in case it is SECURITY INVOKER. If
  login profile loading misbehaves after Wave E, capture the function body
  from the step 0 output (section 4) and report it; do not revert the whole
  wave for this.
- Wave F (storage buckets, untracked RPC hardening, F7 to F10) is
  intentionally absent here: it cannot be drafted responsibly until the step
  0 output shows the live bucket flags, storage policies, and function ACLs.

## Phase completion criteria

Phase 0B is complete when all five waves are applied, every embedded
verification query returns its expected result, the smoke tests in Waves B,
C, D, E pass, and a Wave F follow-up (if the step 0 output demands one) is
either applied or explicitly deferred with a finding note.
