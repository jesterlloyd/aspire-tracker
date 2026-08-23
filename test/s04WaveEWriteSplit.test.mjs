// test/s04WaveEWriteSplit.test.mjs
//
// S-04: Wave E (20260712000004) created FOR ALL TO authenticated USING (is_staff()) policies on a
// set of staff tables. is_staff() admits owner, admin, co_lead, co-lead, interviewer AND viewer,
// and several of these tables are written directly from the browser with only a client-side canEdit
// check in front, so RLS was the only real gate and it was open to every staff role.
//
// The migration splits read from write: SELECT stays on is_staff(), and INSERT, UPDATE and DELETE
// move to a new active Owner/Admin/Co-Lead helper.
//
// The migration is pure SQL with no live database here, so these assert its committed shape, plus
// the application changes that keep restricted roles from hitting an opaque database refusal.
// Nothing here performs network I/O and no email is sent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

const MIGRATION = 'supabase/migrations/20260822020000_wave_e_write_policy_split.sql'
const migration = read(MIGRATION)
const preflight = read('db/audit/wave_e_write_split_preflight_and_verification.sql')

// The executable body: everything outside the inert rollback comment block.
const live = migration.replace(/\/\*[\s\S]*?\*\//g, '')

// The eleven tables that still carried a Wave E FOR ALL policy.
const FOR_ALL_TABLES = [
  'cohorts', 'communications', 'units', 'matches', 'interview_sessions',
  'interviewers', 'interviews', 'interview_availability_blocks',
  'interview_slots', 'ngrp_outcomes', 'cohort_snapshots',
]

// ── The helper ───────────────────────────────────────────────────────────────────────────────────

test('S-04: the write helper follows the is_active_owner_or_admin conventions', () => {
  const fn = live.slice(live.indexOf('CREATE OR REPLACE FUNCTION public.is_active_staff_writer'),
                        live.indexOf('COMMENT ON FUNCTION public.is_active_staff_writer'))
  assert.match(fn, /SECURITY DEFINER/)
  assert.match(fn, /\bSTABLE\b/)
  assert.match(fn, /SET search_path = public, pg_catalog/)
})

test('S-04: the helper requires an ACTIVE account', () => {
  const fn = live.slice(live.indexOf('CREATE OR REPLACE FUNCTION public.is_active_staff_writer'),
                        live.indexOf('COMMENT ON FUNCTION public.is_active_staff_writer'))
  assert.match(fn, /COALESCE\(up\.is_active, true\) = true/)
})

test('S-04: the helper admits Owner, Admin and BOTH Co-Lead spellings, and nobody else', () => {
  const fn = live.slice(live.indexOf('CREATE OR REPLACE FUNCTION public.is_active_staff_writer'),
                        live.indexOf('COMMENT ON FUNCTION public.is_active_staff_writer'))
  assert.match(fn, /'owner', 'admin', 'co-lead', 'co_lead'/)
  assert.match(fn, /COALESCE\(up\.is_owner, false\) = true/)
  // The two roles being restricted must not appear in the predicate at all.
  assert.doesNotMatch(fn, /interviewer/)
  assert.doesNotMatch(fn, /viewer/)
})

test('S-04: the helper has the right grants', () => {
  assert.match(live, /REVOKE ALL ON FUNCTION public\.is_active_staff_writer\(\) FROM PUBLIC/)
  assert.match(live, /REVOKE ALL ON FUNCTION public\.is_active_staff_writer\(\) FROM anon/)
  assert.match(live, /GRANT EXECUTE ON FUNCTION public\.is_active_staff_writer\(\) TO authenticated/)
  assert.match(live, /GRANT EXECUTE ON FUNCTION public\.is_active_staff_writer\(\) TO service_role/)
})

test('S-04: the helper matches the capability model already declared in access.js', () => {
  // student_manage and placement_manage are ['admin','co-lead'] with Owner implicit through the
  // can() Owner bypass. The database helper must express the same rule, not a second one.
  const access = read('lib/server/access.js')
  assert.match(access, /student_manage:\s*\['admin', 'co-lead'\]/)
  assert.match(access, /placement_manage:\s*\['admin', 'co-lead'\]/)
  assert.match(access, /return r === 'co_lead' \? 'co-lead' : r/, 'access.js folds the legacy spelling')
})

// ── The split ────────────────────────────────────────────────────────────────────────────────────

test('S-04: every Wave E FOR ALL policy is dropped by its exact name', () => {
  for (const t of FOR_ALL_TABLES) {
    assert.ok(live.includes(`'${t}',`), `${t} must appear in the split list`)
  }
  // Named explicitly rather than discovered, so a policy some later migration added cannot be
  // dropped by accident.
  assert.match(live, /'staff_all_availability_blocks'/, 'the odd policy name must be exact')
  assert.match(live, /DROP POLICY IF EXISTS %I ON public\.%I', t\.old_policy, t\.tbl/)
})

test('S-04: read stays on is_staff and write moves to the helper', () => {
  assert.match(live, /FOR SELECT TO authenticated USING \(public\.is_staff\(\)\)/)
  assert.match(live, /FOR INSERT TO authenticated WITH CHECK \(public\.is_active_staff_writer\(\)\)/)
  assert.match(live, /FOR UPDATE TO authenticated USING \(public\.is_active_staff_writer\(\)\) WITH CHECK \(public\.is_active_staff_writer\(\)\)/)
  assert.match(live, /FOR DELETE TO authenticated USING \(public\.is_active_staff_writer\(\)\)/)
})

test('S-04: no write policy in the migration is gated on is_staff', () => {
  // The whole point of the finding. Any INSERT/UPDATE/DELETE policy created here must use the
  // helper. is_staff may appear ONLY on SELECT.
  for (const m of live.matchAll(/FOR (INSERT|UPDATE|DELETE)[^\n;]*/g)) {
    assert.doesNotMatch(m[0], /is_staff/, `write policy must not use is_staff: ${m[0].slice(0, 90)}`)
  }
})

test('S-04: no policy in the migration uses the inactive-tolerant helper', () => {
  // is_owner_or_admin() does not check is_active. Any new policy must use an active variant.
  const created = live.split('\n').filter(l => l.includes('CREATE POLICY') || l.includes('FOR INSERT') || l.includes('FOR UPDATE') || l.includes('FOR DELETE'))
  for (const line of created) {
    assert.doesNotMatch(line, /is_owner_or_admin\(\)/, `must use an active-checking helper: ${line.trim().slice(0, 90)}`)
  }
})

test('S-04: contacts keeps its read policy and replaces only the three write policies', () => {
  assert.match(live, /DROP POLICY IF EXISTS "contacts_staff_insert"/)
  assert.match(live, /DROP POLICY IF EXISTS "contacts_staff_update"/)
  assert.match(live, /DROP POLICY IF EXISTS "contacts_staff_delete"/)
  assert.doesNotMatch(live, /DROP POLICY IF EXISTS "contacts_staff_select"/, 'the read policy must be left alone')
})

// ── Narrower prior policies are preserved, not widened ───────────────────────────────────────────

test('S-04: students and student_shift_logs DELETE stay Owner/Admin, narrower than the helper', () => {
  // 20260818000000 set both to is_active_owner_or_admin(), which EXCLUDES Co-Lead. Widening them
  // to the new helper would be a regression.
  assert.doesNotMatch(live, /DROP POLICY IF EXISTS "students_owner_admin_delete"/)
  assert.doesNotMatch(live, /DROP POLICY IF EXISTS "student_shift_logs_owner_admin_delete"/)
  // Only the two is_staff write policies are replaced on each.
  assert.match(live, /DROP POLICY IF EXISTS "staff_insert_students"/)
  assert.match(live, /DROP POLICY IF EXISTS "staff_update_students"/)
  assert.doesNotMatch(live, /DROP POLICY IF EXISTS "staff_select_students"/, 'the read policy must be left alone')
})

test('S-04: the already-narrowed tables are not touched at all', () => {
  // Re-splitting interview_rubrics would regress the per-author restriction from 20260822010000.
  // program_events, preceptors and preceptor_cohort_participation are already narrower.
  for (const t of ['interview_rubrics', 'program_events', 'preceptors', 'preceptor_cohort_participation']) {
    assert.doesNotMatch(live, new RegExp(`CREATE POLICY[^;]*ON public\\.${t}\\b`), `${t} must not get a new policy`)
    assert.doesNotMatch(live, new RegExp(`DROP POLICY[^;]*ON public\\.${t}\\b`), `${t} must not lose a policy`)
  }
})

test('S-04: activity_logs is deliberately out of scope', () => {
  // Its INSERT is is_staff() by design: logActivity() fires when an Interviewer saves a rubric, so
  // narrowing it would break that. The migration must say so and must not touch it.
  assert.doesNotMatch(live, /ON public\.activity_logs/)
  assert.match(migration, /activity_logs\s+Its INSERT is is_staff\(\) by design/)
})

test('S-04: the rubric helper is referenced as the model, not modified', () => {
  assert.match(migration, /can_manage_all_interview_rubrics\(\) \(20260822010000\) is the same/)
  assert.doesNotMatch(live, /CREATE OR REPLACE FUNCTION public\.can_manage_all_interview_rubrics/)
})

// ── Transaction and rollback ─────────────────────────────────────────────────────────────────────

test('S-04: the migration is one transaction with an inert rollback', () => {
  assert.match(live, /^BEGIN;/m)
  assert.match(live, /^COMMIT;/m)
  // Exactly one live transaction; the rollback's BEGIN/COMMIT live inside the comment block.
  assert.equal((live.match(/^BEGIN;/gm) || []).length, 1)
  assert.equal((live.match(/^COMMIT;/gm) || []).length, 1)
  // The ROLLBACK heading is a -- comment ABOVE the inert block, and the block itself holds the
  // statements, so assert each in its own place rather than expecting the word inside the block.
  assert.match(migration, /^-- ROLLBACK \(INERT\)/m)
  assert.match(migration, /\/\*\nBEGIN;[\s\S]*COMMIT;\n\*\//)
})

test('S-04: the rollback restores every FOR ALL policy it dropped', () => {
  const rollback = migration.slice(migration.indexOf('/*\nBEGIN;'))
  for (const t of FOR_ALL_TABLES) {
    assert.ok(rollback.includes(`'${t}',`), `rollback must restore ${t}`)
  }
  assert.match(rollback, /FOR ALL TO authenticated USING \(public\.is_staff\(\)\) WITH CHECK \(public\.is_staff\(\)\)/)
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.is_active_staff_writer\(\)/)
  assert.match(rollback, /DROP TRIGGER IF EXISTS trg_students_assert_file_ref_owner/)
  assert.match(rollback, /DROP INDEX IF EXISTS public\.uq_interview_slots_one_booking_per_student/)
})

test('S-04: the migration writes no application data', () => {
  assert.doesNotMatch(live, /\bDELETE FROM\b/i)
  assert.doesNotMatch(live, /\bTRUNCATE\b/i)
  assert.doesNotMatch(live, /\bINSERT INTO public\.(students|cohorts|contacts|matches)\b/i)
  assert.doesNotMatch(live, /\bUPDATE public\.(students|cohorts|contacts|matches)\b/i)
})

// ── The three add-on items ───────────────────────────────────────────────────────────────────────

test('S-04: the trigger-only function loses its default PUBLIC grant', () => {
  assert.match(live, /REVOKE ALL ON FUNCTION public\.message_assert_participant_limit\(\) FROM PUBLIC/)
  assert.match(live, /REVOKE ALL ON FUNCTION public\.message_assert_participant_limit\(\) FROM anon/)
})

test('S-04: the one-booking index is guarded so a duplicate aborts with a readable error', () => {
  // Slice the DO block by its own dollar-quote delimiters. "CREATE UNIQUE INDEX" also appears in
  // the explanatory comment above the block, so it is not a usable end landmark.
  const start = live.indexOf('DO $one_booking$')
  const guard = live.slice(start, live.indexOf('$one_booking$;', start))
  assert.match(guard, /HAVING count\(\*\) > 1/)
  assert.match(guard, /RAISE EXCEPTION/)
  assert.match(guard, /S-04 ABORTED/)
  // The guard must run BEFORE the index creation, so the failure is descriptive.
  assert.ok(start < live.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS'), 'the guard must precede the index')
  assert.match(live, /ON public\.interview_slots \(booked_by_student_id\)\s*\n\s*WHERE is_booked = true AND booked_by_student_id IS NOT NULL/)
})

test('S-04: the S-03 trigger mirrors refBelongsToStudent and tolerates every legitimate shape', () => {
  const fn = live.slice(live.indexOf('CREATE OR REPLACE FUNCTION public.students_assert_file_ref_owner'),
                        live.indexOf('DROP TRIGGER IF EXISTS trg_students_assert_file_ref_owner'))
  // Same rule as the read guard: the SECOND segment is the ownership boundary.
  assert.match(fn, /split_part\(v_path, '\/', 2\)\) IS DISTINCT FROM lower\(NEW\.id::text\)/)
  // NULL and empty clear the reference and must be allowed.
  assert.match(fn, /CONTINUE WHEN v_raw IS NULL OR btrim\(v_raw\) = ''/)
  // A legacy public URL is reduced to its object path first, exactly as parseStoredFileRef does.
  assert.match(fn, /\/object\/public\/student-files\//)
  assert.match(fn, /SET search_path = public, pg_catalog/)
  // It fires only on the two columns it validates.
  assert.match(live, /BEFORE INSERT OR UPDATE OF resume_url, headshot_url ON public\.students/)
})

// ── Application changes ──────────────────────────────────────────────────────────────────────────

test('S-04: the interviewer directory delete goes through the server endpoint', () => {
  const endpoint = read('api/manage-interviewers.js')
  assert.match(endpoint, /const ALLOWED_ACTIONS = \['add', 'update_email', 'update_color', 'delete'\]/)
  assert.match(endpoint, /if \(action === 'delete'\) \{/)
  assert.match(endpoint, /\.from\('interviewers'\)\.delete\(\)\.eq\('id', id\)/)
  // The endpoint's Owner/Admin gate is unchanged and still covers the new action.
  assert.match(endpoint, /Directory administration: Owner\/Admin only \(default deny\)/)

  const modal = read('src/components/InterviewersModal.jsx')
  assert.match(modal, /await callProxy\(\{ action: 'delete', id: interviewer\.id \}\)/)
  // The direct browser delete is gone.
  assert.doesNotMatch(modal, /\.from\('interviewers'\)\s*\n?\s*\.delete\(\)/)
  assert.doesNotMatch(modal, /deferred to ACCOUNTS-ACCESS-DELETE-HARDEN-2/, 'the deferral note must be retired')
})

test('S-04: controls the database would now refuse are hidden for restricted roles', () => {
  // Each of these was reachable by a Viewer or an Interviewer and would have failed opaquely.
  const drawer = read('src/components/InterviewDayDrawer.jsx')
  assert.match(drawer, /\{isAdmin && session\?\.id && \(/, 'mark Teams invite sent')
  assert.match(drawer, /\{isAdmin && <MBtn variant="outline" onClick=\{\(\) => setBlockingSlot\(slot\)\}/, 'block time')
  assert.match(drawer, /\{isAdmin && <MBtn variant="outline" onClick=\{\(\) => handleUnblockSlot\(slot\.id\)\}/, 'unblock')

  const availability = read('src/components/AvailabilityManagerModal.jsx')
  assert.match(availability, /checked=\{b\.is_active\} disabled=\{!isAdmin\}/, 'pause/resume toggle')

  const app = read('src/App.jsx')
  assert.match(app, /\{canEdit && <button className="btn btn-primary" onClick=\{\(\) => setShowNewCohort\(true\)\}/, 'create first cohort')

  const panel = read('src/components/StudentSidePanel.jsx')
  assert.match(panel, /\{canEdit && \(\s*\n\s*<div className="sp-danger-zone">/, 'delete student')
})

test('S-04: Owner, Admin and Co-Lead behavior is not narrowed by the UI changes', () => {
  // Every new gate is an isAdmin or canEdit check, both of which admit Owner and Admin. None of
  // them wraps a control that Co-Lead reaches through canPerformMatching.
  const matching = read('src/components/MatchingTab.jsx')
  assert.match(matching, /canPerformMatching\(userProfile\)/, 'the Co-Lead matching gate is untouched')
  const permissions = read('src/lib/permissions.js')
  assert.match(permissions, /co-lead/, 'canPerformMatching still admits Co-Lead')
})

// ── Verification queries ─────────────────────────────────────────────────────────────────────────

test('S-04: the preflight file exists with both sections and a run-separately instruction', () => {
  assert.ok(existsSync(join(root, 'db/audit/wave_e_write_split_preflight_and_verification.sql')))
  assert.match(preflight, /PRE-APPLY \(run BEFORE the migration\)/)
  assert.match(preflight, /POST-APPLY \(run AFTER the migration\)/)
  assert.match(preflight, /RUN EACH NUMBERED SECTION SEPARATELY/)
  // The migration is the opposite: one block.
  assert.match(migration, /as ONE COMPLETE\n-- BLOCK/)
  assert.match(preflight, /transaction-wrapped and must be run as ONE\n-- complete block/)
})

test('S-04: the preflight covers the two blocking pre-conditions', () => {
  assert.match(preflight, /PRE 6: BLOCKING\. one-booking-per-student violations/)
  assert.match(preflight, /PRE 7: BLOCKING\. rows the new S-03 trigger would reject/)
})

test('S-04: no em dash in either SQL file', () => {
  // \u2014 is the em dash. Written as an escape so this file contains none either.
  assert.doesNotMatch(migration, /\u2014/)
  assert.doesNotMatch(preflight, /\u2014/)
})
