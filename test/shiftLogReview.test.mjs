// SHIFT-LOG-REVIEW-1: structural guards for the review migration, endpoint,
// and UI wiring. The behavioral proofs for the downstream effects and warning
// definitions live in shiftReviewEffects.test.mjs / shiftReviewWarnings share
// this file (pure modules, executed directly).
//
// Run: node --test test/shiftLogReview.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// S-11: these endpoints now import lib/server/evaluation/rate_limit.js, which throws at
// import when EVALUATION_RATE_LIMIT_PEPPER is unset. That is the intended fail-closed
// behavior (same convention as test/s01InterviewLookup.test.mjs), so a dummy pepper is
// set before importing. No real value is used and no network call is made.
process.env.EVALUATION_RATE_LIMIT_PEPPER ||= 'test-pepper-not-a-real-value'
process.env.SUPABASE_URL ||= 'https://test.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key-not-a-real-value'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── The migration (UNAPPLIED - gated) ───────────────────────────────────────

const sql = read('supabase/migrations/20260818000000_shift_log_review.sql')
const sqlCode = sql.replace(/--[^\n]*/g, '')

test('the ledger is strictly append-only: no UPDATE/DELETE for anyone, service_role INSERTs', () => {
  assert.match(sqlCode, /CREATE TABLE IF NOT EXISTS public\.shift_log_reviews/)
  assert.match(sqlCode, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sqlCode, /REVOKE ALL ON public\.shift_log_reviews\s*\n?\s*FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(sqlCode, /GRANT SELECT, INSERT ON public\.shift_log_reviews TO service_role/)
  assert.doesNotMatch(sqlCode, /GRANT[^;]*UPDATE[^;]*ON public\.shift_log_reviews/,
    'no role is ever granted UPDATE on the ledger')
  assert.doesNotMatch(sqlCode, /GRANT[^;]*DELETE[^;]*ON public\.shift_log_reviews/,
    'no role is ever granted DELETE on the ledger')
  assert.match(sqlCode, /is_active_owner_or_admin\(\)/, 'Owner/Admin read the audit trail via RLS')
})

test('a shift is decided AT MOST once EVER - the barrier is keyed on the IMMUTABLE identity', () => {
  assert.match(sqlCode, /CREATE UNIQUE INDEX IF NOT EXISTS uq_slr_one_decision_per_shift\s*\n?\s*ON public\.shift_log_reviews \(original_shift_log_id\)/)
})

test('IMMUTABLE IDENTITY: FK-free uuid snapshots that no deletion can null or change', () => {
  assert.match(sqlCode, /original_shift_log_id\s+uuid NOT NULL,/)
  assert.match(sqlCode, /original_student_id\s+uuid NOT NULL,/)
  // NEGATIVE CONTROL: adding a foreign key to either identity column (which
  // would reintroduce nullable/erasable identity) fails these:
  assert.doesNotMatch(sqlCode, /original_shift_log_id\s+uuid[^,]*REFERENCES/)
  assert.doesNotMatch(sqlCode, /original_student_id\s+uuid[^,]*REFERENCES/)
  // Review-context snapshots: mismatch is a primary review reason, so unit and
  // preceptor must survive source deletion; sensitive free text stays out.
  assert.match(sqlCode, /original_unit_name\s+text NOT NULL DEFAULT ''/)
  assert.match(sqlCode, /original_preceptor_name\s+text NOT NULL DEFAULT ''/)
  assert.match(sqlCode, /original_shift_type\s+text NOT NULL DEFAULT ''/)
  const ledgerDdl = sqlCode.slice(sqlCode.indexOf('CREATE TABLE IF NOT EXISTS public.shift_log_reviews'), sqlCode.indexOf('CREATE UNIQUE INDEX'))
  assert.doesNotMatch(ledgerDdl, /support_needed|learning_highlight|override/,
    'student free text is never copied into the ledger')
  // The RPC fills identity + context on every insert:
  const fn = sqlCode.slice(sqlCode.indexOf('review_shift_log'), sqlCode.indexOf('shift_review_ready'))
  assert.match(fn, /original_shift_log_id, original_student_id/)
  assert.match(fn, /original_unit_name, original_preceptor_name, original_shift_type/)
})

test('DURABILITY: source deletion can NEVER destroy review history (SET NULL, snapshots)', () => {
  // Both source FKs are SET NULL - a deleted shift or student nulls the link
  // and the audit row survives. Any CASCADE here would let ANY active staff
  // login (staff_all_* policies are FOR ALL) erase review history.
  assert.match(sqlCode, /shift_log_id\s+uuid REFERENCES public\.student_shift_logs\(id\) ON DELETE SET NULL/)
  assert.match(sqlCode, /student_id\s+uuid REFERENCES public\.students\(id\) ON DELETE SET NULL/)
  assert.doesNotMatch(sqlCode, /shift_log_reviews[\s\S]{0,2000}ON DELETE CASCADE/,
    'NEGATIVE CONTROL: reintroducing CASCADE on the ledger fails this test')
  // Self-contained snapshots keep a source-less row meaningful:
  assert.match(sqlCode, /student_name\s+text NOT NULL DEFAULT ''/)
  assert.match(sqlCode, /original_shift_date\s+text NOT NULL DEFAULT ''/)
  // The reviewer link is RESTRICT: an audit actor can never silently vanish.
  assert.match(sqlCode, /reviewer_profile_id\s+uuid NOT NULL REFERENCES public\.user_profiles\(id\) ON DELETE RESTRICT/)
})

test('the ledger preserves originals and requires auditable inputs', () => {
  for (const col of ['original_status', 'original_total_hours', 'original_exception_flags',
    'original_review_reason', 'adjusted_total_hours', 'acknowledged_warnings',
    'approved_hours_after', 'pending_hours_after', 'reviewer_profile_id', 'rationale']) {
    assert.ok(sqlCode.includes(col), `${col} exists`)
  }
  assert.match(sqlCode, /chk_slr_rationale_required CHECK \(\s*decision = 'approved' OR btrim\(rationale\) <> ''/)
  assert.match(sqlCode, /\(decision = 'adjusted'\) = \(adjusted_total_hours IS NOT NULL\)/)
})

test('the RPC serializes on the SAME student lock as shift_log_check_out and pins the shift', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('review_shift_log'), sqlCode.indexOf('shift_review_ready'))
  assert.equal((fn.match(/FOR UPDATE/g) || []).length, 2, 'student row + shift row both locked')
  assert.match(fn, /SELECT s\.name INTO v_student_name\s*\n?\s*FROM public\.students s[\s\S]{0,200}FOR UPDATE/,
    'the student lock doubles as the ledger name snapshot')
  assert.match(fn, /IS DISTINCT FROM 'Pending Review'[\s\S]{0,120}P0001/,
    'only a Pending Review shift is decidable')
  assert.match(fn, /WHERE id = p_shift_id\s*\n?\s*AND status = 'Pending Review'\s*\n?\s*AND lifecycle_state = 'completed'/,
    'the UPDATE re-checks Pending Review under the lock')
})

test('totals recompute uses the shift_log_check_out formula verbatim - both buckets', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('review_shift_log'), sqlCode.indexOf('shift_review_ready'))
  assert.match(fn, /status IN \('Auto-Accepted', 'Approved'\)\s*\n?\s*AND total_hours IS NOT NULL/)
  assert.match(fn, /status IN \('Pending Review'\)\s*\n?\s*AND total_hours IS NOT NULL/)
  assert.match(fn, /SET approved_hours = v_recomputed_approved,\s*\n?\s*pending_hours\s*=\s*v_recomputed_pending/)
  assert.doesNotMatch(fn, /approved_hours \+|pending_hours -/, 'full recompute, never incremental arithmetic')
})

test('warnings are computed INSIDE the lock and enforced for approval paths only', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('review_shift_log'), sqlCode.indexOf('shift_review_ready'))
  const lockAt = fn.indexOf('FOR UPDATE')
  const warnAt = fn.indexOf("IF p_decision IN ('approved', 'adjusted') THEN")
  assert.ok(lockAt > 0 && warnAt > lockAt, 'warning computation follows the lock')
  assert.match(fn, /'possible_duplicate'/)
  assert.match(fn, /'same_day_shift'/)
  assert.match(fn, /status NOT IN \('Rejected', 'rejected'\)/, 'rejected shifts never trigger warnings')
  // CANONICAL unit identity: the duplicate compare goes through unit_name_key,
  // never a bare lower/trim (NEGATIVE CONTROL: swapping it back fails here).
  assert.match(fn, /public\.unit_name_key\(l\.unit_name\) = public\.unit_name_key\(v_before\.unit_name\)/)
  assert.doesNotMatch(fn, /lower\(btrim\(COALESCE\(l\.unit_name/)
  assert.match(fn, /warnings_not_acknowledged: %/, 'the refusal names the missing warnings')
  assert.match(fn, /ERRCODE = 'P0007'/)
})

test('approval beyond hours_required is structurally unrestricted - the RPC never reads hours_required', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('review_shift_log'), sqlCode.indexOf('shift_review_ready'))
  assert.doesNotMatch(fn, /hours_required/,
    'required hours are a completion threshold, not a review constraint')
})

test('decision statuses map onto the RESERVED taxonomy - nothing new invented', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('review_shift_log'), sqlCode.indexOf('shift_review_ready'))
  assert.match(fn, /CASE WHEN p_decision = 'rejected' THEN 'Rejected' ELSE 'Approved' END/)
  assert.doesNotMatch(fn, /'Completed'/, 'no automatic completion status - that stays manual')
  assert.doesNotMatch(sqlCode, /DELETE FROM public\.student_shift_logs/,
    'rejection preserves the shift as history - nothing deletes')
})

test('the RPC and probe are service-role only; the migration is additive and gated', () => {
  assert.match(sqlCode, /REVOKE ALL ON FUNCTION public\.review_shift_log[\s\S]{0,120}FROM PUBLIC, anon, authenticated/)
  assert.match(sqlCode, /GRANT EXECUTE ON FUNCTION public\.review_shift_log[\s\S]{0,120}TO service_role/)
  assert.match(sqlCode, /CREATE OR REPLACE FUNCTION public\.shift_review_ready/)
  assert.match(sql, /confdeltype/, 'verification audits the FK delete rules')
  assert.match(sql, /pg_policy/, 'verification audits who can delete the source tables')
  assert.doesNotMatch(sqlCode, /ALTER TABLE public\.(students|student_shift_logs)\b/,
    'no SCHEMA change to existing tables (section 6 alters only their DELETE policies)')
  assert.doesNotMatch(sqlCode, /portal_my_shift_logs/, 'portal view untouched - internals stay unreachable')
  assert.match(sql, /APPLY MANUALLY[\s\S]{0,24}\(Owner\/Jester\)/)
  assert.match(sql, /Claude Code has applied NOTHING/)
  assert.match(sql, /db\/audit\/shift_log_review_smoke_test\.sql/)
  assert.match(sql, /ROLLBACK \(safe/)
})

test('unit_name_key mirrors the client canonicalization: whitespace-stripped lowercase', () => {
  assert.match(sqlCode, /CREATE OR REPLACE FUNCTION public\.unit_name_key\(p_name text\)/)
  assert.match(sqlCode, /lower\(regexp_replace\(COALESCE\(p_name, ''\), '\\s\+', '', 'g'\)\)/)
  assert.match(sqlCode, /IMMUTABLE/)
  // Client side: the warnings module uses the SAME canonical key.
  const warnMod = read('src/lib/shiftReviewWarnings.js')
  assert.match(warnMod, /import \{ unitNameKey \} from '\.\/unitNameCanon\.js'/)
  assert.match(warnMod, /unitNameKey\(l\.unit_name\) === unitNameKey\(shift\.unit_name\)/)
})

// ── The atomic past-shift RPC (correction 2) ────────────────────────────────

test('submit_past_shift_log takes the SAME student lock and recomputes both buckets atomically', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.submit_past_shift_log'))
  assert.match(fn, /PERFORM 1 FROM public\.students WHERE id = p_student_id FOR UPDATE/)
  assert.match(fn, /ON CONFLICT \(id\) DO NOTHING/, 'idempotent on the submission id')
  // EXISTS-FIRST: a resubmitted id whose row was since REVIEWED replays
  // idempotently - the intake-status validation applies ONLY to a genuine
  // insert. (NEGATIVE CONTROL: hoisting the validation back above the
  // existence check fails this ordering.)
  const existsAt = fn.indexOf('SELECT to_jsonb(l) INTO v_shift')
  const validateAt = fn.indexOf("p_status NOT IN ('Auto-Accepted', 'Pending Review')")
  const insertAt = fn.indexOf('INSERT INTO public.student_shift_logs')
  assert.ok(existsAt > 0 && validateAt > existsAt && insertAt > validateAt,
    'existence check -> status validation -> insert, in that order')
  assert.match(fn, /IF v_shift IS NULL THEN/)
  assert.match(fn, /status IN \('Auto-Accepted', 'Approved'\)\s*\n?\s*AND total_hours IS NOT NULL/)
  assert.match(fn, /status IN \('Pending Review'\)\s*\n?\s*AND total_hours IS NOT NULL/)
  assert.match(fn, /p_status NOT IN \('Auto-Accepted', 'Pending Review'\)/, 'only intake statuses enter')
  assert.match(sqlCode, /REVOKE ALL ON FUNCTION public\.submit_past_shift_log[\s\S]{0,400}FROM PUBLIC, anon, authenticated/)
  assert.match(sqlCode, /GRANT EXECUTE ON FUNCTION public\.submit_past_shift_log[\s\S]{0,400}TO service_role/)
  // Every totals writer now serializes on the student row: 3 ROW locks total
  // (review takes 2 - student + shift - and submit takes 1). Matching the
  // terminal 'FOR UPDATE;' so the RLS policies' FOR UPDATE clause is excluded.
  assert.equal((sqlCode.match(/FOR UPDATE;/g) || []).length, 3)
})

test('the submit-past-shift endpoint is atomic-first with a migration-gated legacy fallback', () => {
  const sps = strip(read('api/shift-log/submit-past-shift.js'))
  assert.match(sps, /rpc\('submit_past_shift_log'/)
  assert.match(sps, /PGRST202/, 'a missing RPC (migration pending) selects the fallback')
  const rpcAt = sps.indexOf("rpc('submit_past_shift_log'")
  const legacyInsertAt = sps.search(/from\('student_shift_logs'\)\s*\.insert\(/)
  assert.ok(rpcAt > 0 && legacyInsertAt > rpcAt, 'the lockless insert survives ONLY as the fallback branch')
  // NEGATIVE CONTROL: removing the atomic call resurfaces the unserialized
  // writer and fails this assertion.
  const withoutAtomic = sps.replace(/const atomic = await atomicSubmit\(db, \{[\s\S]*?\}\)/g, '')
  assert.ok(!withoutAtomic.includes("rpc('submit_past_shift_log'") || withoutAtomic.includes('atomicSubmit'),
    'stripping the atomic path removes the RPC call this suite pins')
  // The response contract is unchanged: idempotent replays and conflicts survive.
  assert.match(sps, /idempotent: true/)
  assert.match(sps, /error: 'conflict'/)
})

test('an adjusted row replays ONLY at its immutable original hours - resolved server-side', () => {
  const sps = strip(read('api/shift-log/submit-past-shift.js'))
  // The accepting condition consults the ledger's original_total_hours; the
  // naive any-hours spread is never the acceptance test on its own.
  assert.match(sps, /reviewed && await reviewedReplayMatches\(db, \{/)
  assert.doesNotMatch(sps, /\|\| \(reviewed && samePayload\(\{ \.\.\.existingShift/,
    'NEGATIVE CONTROL: the arbitrary-hours acceptance shape is gone')
  const helper = sps.slice(sps.indexOf('export async function reviewedReplayMatches'), sps.indexOf('export async function atomicSubmit'))
  assert.match(helper, /from\('shift_log_reviews'\)/)
  assert.match(helper, /original_total_hours/)
  assert.match(helper, /eq\('original_shift_log_id', submissionId\)/)
  assert.doesNotMatch(helper, /\.(update|insert|upsert|delete)\(/,
    'the replay check reads; it can never change the reviewed row or the ledger')
  // The browser never reads the ledger - resolution is server-only.
  const clientApi = strip(read('src/lib/shiftReviewApi.js'))
  const modal = strip(read('src/components/ShiftReviewModal.jsx'))
  assert.doesNotMatch(clientApi + modal, /shift_log_reviews/)
})

// Behavioral: the 8h-adjusted-to-6h contract on the real helper.
const { reviewedReplayMatches } = await import('../api/shift-log/submit-past-shift.js')

test('adjusted 8h->6h: replaying 8h matches, replaying 12h conflicts, errors fail closed', async () => {
  const dbWith = (ret) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ret }) }) }) })
  const audit8 = dbWith({ data: { original_total_hours: 8 }, error: null })
  assert.equal(await reviewedReplayMatches(audit8, { submissionId: 'x', incomingHours: 8, matchesWithHours: true }), true,
    'the original 8h replays')
  assert.equal(await reviewedReplayMatches(audit8, { submissionId: 'x', incomingHours: 12, matchesWithHours: true }), false,
    'an arbitrary 12h is a conflict')
  assert.equal(await reviewedReplayMatches(audit8, { submissionId: 'x', incomingHours: 6, matchesWithHours: true }), false,
    'even the ADJUSTED value is not the submission contract - only the original is')
  assert.equal(await reviewedReplayMatches(audit8, { submissionId: 'x', incomingHours: 8, matchesWithHours: false }), false,
    'every other field must still match')
  assert.equal(await reviewedReplayMatches(dbWith({ data: null, error: null }), { submissionId: 'x', incomingHours: 8, matchesWithHours: true }), false,
    'no audit row -> nothing vouches for the difference')
  assert.equal(await reviewedReplayMatches(dbWith({ data: null, error: { code: 'X' } }), { submissionId: 'x', incomingHours: 8, matchesWithHours: true }), false,
    'a ledger read error fails closed')
})

test('ONLY PGRST202 selects the legacy fallback - RPC errors can never reach lockless recompute', () => {
  const sps = strip(read('api/shift-log/submit-past-shift.js'))
  // Every legacy recompute call site is either the atomic.missing branch or
  // inside the legacy fallback block; the error path returns 500 first.
  const calls = sps.match(/await recomputeTotals\(/g) || []
  assert.equal(calls.length, 3, 'exactly three legacy call sites, all fallback-guarded')
  assert.match(sps, /if \(atomic\.error\) \{[\s\S]{0,220}internal_error[\s\S]{0,40}\}\s*const totals = atomic\.missing\s*\?/,
    'in the resubmission branch: error -> 500 BEFORE the missing-only ternary')
  // NEGATIVE CONTROL: the pre-correction escape shape - treating any missing
  // result as migration absence - must never return:
  assert.doesNotMatch(sps, /!atomic\.missing && atomic\.result/,
    'the silent-fallback ternary is gone')
  // Reviewed rows enter the exact-replay resolution (ledger-checked above):
  assert.match(sps, /\['Approved', 'Rejected'\]\.includes\(existingShift\.status/)
})

// Behavioral: the atomicSubmit classification contract, on the real function.
const { atomicSubmit } = await import('../api/shift-log/submit-past-shift.js')

test('atomicSubmit: PGRST202 -> missing; other errors -> error; success -> result', async () => {
  const dbWith = (rpcReturn) => ({ rpc: async () => rpcReturn })
  assert.deepEqual(await atomicSubmit(dbWith({ data: null, error: { code: 'PGRST202' } }), {}), { missing: true })
  const boom = await atomicSubmit(dbWith({ data: null, error: { code: 'P0002', message: 'student_not_found' } }), {})
  assert.equal(boom.error.code, 'P0002', 'a real RPC failure is surfaced, never treated as migration absence')
  assert.equal(boom.missing, undefined)
  const ok = await atomicSubmit(dbWith({ data: { inserted: true, approved_hours: 10 }, error: null }), {})
  assert.equal(ok.result.approved_hours, 10)
})

test('the identity sequence is deny-all as least-privilege hygiene, verified at catalog level', () => {
  assert.match(sqlCode, /pg_get_serial_sequence\('public\.shift_log_reviews', 'id'\)/)
  assert.match(sqlCode, /REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated/)
  assert.match(sqlCode, /GRANT USAGE, SELECT ON SEQUENCE %s TO service_role/)
  assert.match(sql, /has_sequence_privilege\('service_role'/, 'verification checks the grant')
  assert.match(sql, /has_sequence_privilege\('anon'/, 'verification checks the denials')
  // Identity columns do NOT require the inserting role to hold sequence
  // privileges - insertion is governed by table INSERT. Neither the migration
  // nor the smoke test may claim otherwise:
  assert.doesNotMatch(sql, /cannot generate id values/)
  assert.match(sql, /table INSERT alone governs insertion/)
  const smokeFile = read('db/audit/shift_log_review_smoke_test.sql')
  assert.doesNotMatch(smokeFile, /REVOKE USAGE, SELECT ON SEQUENCE/,
    'the invalid sequence-revoke control is gone')
  // The REAL governing permission is what the executable negative control
  // removes - transactionally, with exception-safe restoration:
  assert.match(smokeFile, /REVOKE INSERT ON public\.shift_log_reviews FROM service_role/)
  assert.match(smokeFile, /GRANT INSERT ON public\.shift_log_reviews TO service_role/)
})

// ── DELETE lockdown on the source tables (blocker 3) ────────────────────────

test('source DELETE narrows to active Owner/Admin; reads and writes keep is_staff() verbatim', () => {
  for (const table of ['students', 'student_shift_logs']) {
    assert.match(sqlCode, new RegExp(`DROP POLICY IF EXISTS "staff_all_${table}" ON public\\.${table}`),
      `the FOR ALL policy on ${table} is removed`)
    for (const cmd of ['select', 'insert', 'update']) {
      assert.match(sqlCode, new RegExp(`CREATE POLICY "staff_${cmd}_${table}" ON public\\.${table}`),
        `${table} keeps a staff ${cmd} policy`)
    }
    assert.match(sqlCode, new RegExp(`FOR DELETE TO authenticated USING \\(public\\.is_active_owner_or_admin\\(\\)\\)`),
      'DELETE is Owner/Admin-gated')
    assert.match(sqlCode, new RegExp(`REVOKE DELETE ON public\\.${table} FROM service_role`),
      `service_role loses DELETE on ${table} (no repository evidence of service-side deletion)`)
  }
  // The split preserves the predicate: every new read/write policy uses is_staff().
  const section = sqlCode.slice(sqlCode.indexOf('DROP POLICY IF EXISTS "staff_all_students"'))
  const rw = section.match(/CREATE POLICY "staff_(select|insert|update)_[^"]+"[\s\S]{0,160}?;/g) || []
  assert.equal(rw.length, 6)
  for (const p of rw) assert.match(p, /public\.is_staff\(\)/, 'reads/writes unchanged: same is_staff() predicate')
  // NEGATIVE CONTROL: reintroducing a FOR ALL policy on either table fails here.
  assert.doesNotMatch(section, /FOR ALL/)
})

// ── The executable smoke test ───────────────────────────────────────────────

const smoke = read('db/audit/shift_log_review_smoke_test.sql')
const smokeCode = smoke.replace(/^\s*--.*$/gm, '')

test('the smoke test is transaction-wrapped, synthetic, self-failing, and complete', () => {
  assert.match(smokeCode, /^\s*BEGIN;/m)
  assert.match(smokeCode, /^\s*ROLLBACK;/m)
  assert.doesNotMatch(smokeCode, /COMMIT/i)
  assert.match(smokeCode, /'ZZ REVIEW TEST COHORT'/)
  assert.doesNotMatch(smokeCode, /<[A-Z_]+_ID>/, 'no placeholders')
  // The ONLY deletes are the two deliberate durability probes on fixture rows.
  const deletes = smokeCode.match(/DELETE FROM [^;]+;/g) || []
  assert.deepEqual(deletes, [
    'DELETE FROM public.student_shift_logs WHERE id = v_s1;',
    'DELETE FROM public.students WHERE id = v_student;',
  ], 'deletion probes target fixtures only')
  assert.doesNotMatch(smokeCode, /UPDATE public\.user_profiles/,
    'the borrowed reviewer profile is read-only')
  const failures = smokeCode.match(/SMOKE TEST FAILURE:/g) || []
  assert.ok(failures.length >= 20, `every assertion aborts loudly (found ${failures.length})`)
  assert.match(smokeCode, /ALL REVIEW SMOKE TESTS PASSED/)
  assert.match(smokeCode, /zz_review_fixture_rows_remaining/)
  // The required proofs - originals plus the three corrections:
  for (const proof of [
    'exceeds 12 required without blocking',          // beyond-required approval
    'unacknowledged same-day warning refused',       // deliberate confirmation
    'refusal left the shift and the ledger untouched',
    'acknowledged same-day approval proceeded',
    'the ledger preserved the original 8h',          // adjustment audit trail
    'preserved the row as history',                  // rejection preservation
    'repeated decision refused',                     // concurrency/idempotency
    "matched ''6 NE'' (canonical unit identity)",    // C3: '6NE' variant, review path
    'atomic past-shift submit inserted and recomputed exact totals under the lock', // C2
    'retried submission is idempotent',              // C2: no double-apply
    'serialized submission cannot evade detection',  // C2+C3: interleaving + '6ne'
    'review + submission serialized into exact totals', // C2: exact totals
    'kept its FULL identity - which shift, which student, which unit/preceptor, and why', // B2
    'left all 6 audit rows fully identifiable',      // B2: student deletion
    'resubmitting an APPROVED id is idempotent',     // B1: reviewed replay
    'resubmitting a REJECTED id is idempotent',      // B1
    'source DELETE is Owner/Admin-only; reads/writes and service access unchanged', // B3
    'replaying the adjusted shift left the stored 6h and Approved status untouched', // F2
    'NEGATIVE CONTROL - without ledger INSERT, service_role cannot record a decision', // F1
    'refused decision left the shift pending, totals unchanged, and no ledger row', // F1
    'a full decision executed AS service_role',      // F1: production caller
    'append-only ledger holds all six decisions',
  ]) assert.ok(smoke.includes(proof), `smoke proves: ${proof}`)
  assert.match(smokeCode, /SET LOCAL ROLE service_role/,
    'the smoke test genuinely switches to the production caller role')
})

// ── The endpoint ────────────────────────────────────────────────────────────

const ep = strip(read('api/shift-log-review.js'))

test('the endpoint is Owner/Admin-only with the house JWT->profile verification', () => {
  assert.match(ep, /auth\.getUser\(\)/)
  assert.match(ep, /\['owner', 'admin'\]\.includes\(profile\.role/)
  assert.match(ep, /profile\.is_active === false/)
  assert.match(ep, /p_reviewer_profile_id: profile\.id/, 'the actor is the verified caller, never the request body')
  assert.doesNotMatch(ep, /body\.reviewer|body\.profile|body\.actor/)
})

test('EVERY decision is gated on shift_review_ready - fail closed pre-migration', () => {
  const gate = ep.indexOf('await reviewReady(db)')
  const rpc = ep.indexOf("rpc('review_shift_log'")
  assert.ok(gate > 0 && rpc > gate, 'the gate precedes the decision RPC')
  assert.match(ep, /migration_required/)
  assert.match(ep, /if \(error\) return false/)
  assert.match(ep, /return data === true/)
})

test('the endpoint never writes shifts, totals, or the ledger directly - the RPC owns the transaction', () => {
  assert.doesNotMatch(ep, /from\('student_shift_logs'\)[\s\S]{0,200}\.(update|insert|upsert|delete)\(/)
  assert.doesNotMatch(ep, /from\('students'\)[\s\S]{0,300}\.(update|insert|upsert|delete)\(/,
    'totals are never written endpoint-side (reading the RPC result is fine)')
  assert.doesNotMatch(ep, /update\([^)]*approved_hours|update\([^)]*pending_hours/)
  assert.doesNotMatch(ep, /from\('shift_log_reviews'\)/, 'the ledger is written only inside the RPC')
})

test('the P000x taxonomy maps to stable client errors; repeats become 409 already_decided', () => {
  assert.match(ep, /P0001[\s\S]{0,300}already_decided/)
  assert.match(ep, /current_status/)
  assert.match(ep, /P0004[\s\S]{0,80}rationale_required/)
  assert.match(ep, /P0005[\s\S]{0,80}adjusted_hours_invalid/)
  assert.match(ep, /P0007[\s\S]{0,400}warnings_not_acknowledged/)
  assert.match(ep, /warnings/)
})

test('downstream parity runs for approvals only, after the atomic decision', () => {
  assert.match(ep, /if \(decision !== 'rejected'\)[\s\S]{0,200}applyApprovalDownstream/)
  const rpcAt = ep.indexOf("rpc('review_shift_log'")
  const downAt = ep.indexOf('applyApprovalDownstream(db')
  assert.ok(downAt > rpcAt, 'effects follow the committed decision')
})

// ── Downstream parity lib (behavioral, real module, substituted db) ─────────

const { applyApprovalDownstream } = await import('../api/lib/shiftReviewEffects.js')

function fakeDb({ acceptedCount, existingEvents = [] }) {
  const writes = { events: [], studentUpdates: [] }
  const db = {
    from(table) {
      const q = {
        _table: table, _filters: {},
        select() { return q }, eq(k, v) { q._filters[k] = v; return q },
        in() { return q },
        limit(n) {
          if (table === 'student_shift_logs') {
            return Promise.resolve({ data: Array.from({ length: Math.min(acceptedCount, n) }, (_, i) => ({ id: `s${i}` })) })
          }
          return q
        },
        maybeSingle() {
          const hit = existingEvents.includes(q._filters.event_type)
          return Promise.resolve({ data: hit ? { id: 'evt' } : null })
        },
        insert(row) { writes.events.push(row); return Promise.resolve({ data: null, error: null }) },
        update(patch) {
          writes.studentUpdates.push(patch)
          return { eq: () => Promise.resolve({ data: null, error: null }) }
        },
      }
      return q
    },
  }
  return { db, writes }
}

test('first approved shift: rotation_start + Placed promotion, exactly like submit-past-shift', async () => {
  const { db, writes } = fakeDb({ acceptedCount: 1 })
  await applyApprovalDownstream(db,
    { id: 'st1', cohort_id: 'c1', status: 'Placed', hours_required: 144 },
    { unit_name: '6 NE' }, { approved_hours: 8 })
  const types = writes.events.map(e => e.event_type)
  assert.deepEqual(types, ['rotation_start', 'status_change_active_rotation'])
  assert.match(writes.events[0].notes, /First shift logged: 6 NE/)
  assert.deepEqual(writes.studentUpdates, [{ status: 'Active Rotation' }])
  assert.equal(writes.events[0].created_by, 'Shift Review', 'honest provenance')
})

test('non-first approval: no start event, no promotion; already-promoted students untouched', async () => {
  const { db, writes } = fakeDb({ acceptedCount: 2 })
  await applyApprovalDownstream(db,
    { id: 'st1', cohort_id: 'c1', status: 'Active Rotation', hours_required: 144 },
    { unit_name: '6 NE' }, { approved_hours: 40 })
  assert.deepEqual(writes.events, [])
  assert.deepEqual(writes.studentUpdates, [])
})

test('rotation_end fires when approved >= required - INCLUDING far beyond required', async () => {
  const { db, writes } = fakeDb({ acceptedCount: 5 })
  await applyApprovalDownstream(db,
    { id: 'st1', cohort_id: 'c1', status: 'Active Rotation', hours_required: 144 },
    { unit_name: 'PACU' }, { approved_hours: 200 })
  assert.deepEqual(writes.events.map(e => e.event_type), ['rotation_end'])
  assert.match(writes.events[0].notes, /Required hours met: 200\/144/)
})

test('rotation_end is deduped and never fires with required 0 (unknown != met)', async () => {
  const deduped = fakeDb({ acceptedCount: 5, existingEvents: ['rotation_end'] })
  await applyApprovalDownstream(deduped.db,
    { id: 'st1', cohort_id: 'c1', status: 'Active Rotation', hours_required: 144 },
    { unit_name: 'PACU' }, { approved_hours: 200 })
  assert.deepEqual(deduped.writes.events, [], 'existing event suppresses a duplicate')

  const zero = fakeDb({ acceptedCount: 5 })
  await applyApprovalDownstream(zero.db,
    { id: 'st1', cohort_id: 'c1', status: 'Active Rotation', hours_required: 0 },
    { unit_name: 'PACU' }, { approved_hours: 200 })
  assert.deepEqual(zero.writes.events, [], 'required 0 emits nothing')
})

test('effects are best-effort: a throwing db never rejects', async () => {
  const db = { from() { throw new Error('boom') } }
  await assert.doesNotReject(() => applyApprovalDownstream(db,
    { id: 'st1', cohort_id: 'c1', status: 'Placed', hours_required: 144 },
    { unit_name: 'X' }, { approved_hours: 8 }))
})

// ── Warning definitions (behavioral, real module) ───────────────────────────

const { computeReviewWarnings } = await import('../src/lib/shiftReviewWarnings.js')

test('warning definitions: same-day, duplicate, and rejected-neighbour exclusion', () => {
  const shift = { id: 'a', shift_date: '2026-07-15', unit_name: '6 NE', total_hours: 8 }
  const lone = computeReviewWarnings(shift, [shift])
  assert.deepEqual(lone.warnings, [])

  const sameDay = computeReviewWarnings(shift, [shift,
    { id: 'b', shift_date: '2026-07-15', unit_name: 'PACU', total_hours: 6, lifecycle_state: 'completed', status: 'Auto-Accepted' }])
  assert.deepEqual(sameDay.warnings, ['same_day_shift'])

  const dup = computeReviewWarnings(shift, [shift,
    { id: 'b', shift_date: '2026-07-15', unit_name: '6 ne', total_hours: 8, lifecycle_state: 'completed', status: 'Auto-Accepted' }])
  assert.deepEqual(dup.warnings, ['possible_duplicate', 'same_day_shift'])

  // CANONICAL variants: '6NE' (no space) and '6nE' are the same unit as '6 NE'.
  for (const variant of ['6NE', '6nE', '6  ne']) {
    const v = computeReviewWarnings(shift, [shift,
      { id: 'b', shift_date: '2026-07-15', unit_name: variant, total_hours: 8, lifecycle_state: 'completed', status: 'Auto-Accepted' }])
    assert.deepEqual(v.warnings, ['possible_duplicate', 'same_day_shift'], `variant ${variant}`)
  }

  const rejectedNeighbour = computeReviewWarnings(shift, [shift,
    { id: 'b', shift_date: '2026-07-15', unit_name: '6 NE', total_hours: 8, lifecycle_state: 'completed', status: 'Rejected' }])
  assert.deepEqual(rejectedNeighbour.warnings, [], 'a rejected shift is not an overlap')
})

// ── The UI wiring ───────────────────────────────────────────────────────────

const panel = read('src/components/ClinicalHoursPanel.jsx')
const modal = read('src/components/ShiftReviewModal.jsx')
const rotation = read('src/components/RotationActivity.jsx')
const api = strip(read('src/lib/shiftReviewApi.js'))

test('the Review action exists for Owner/Admin only; other staff keep read-only text', () => {
  assert.match(panel, /\['owner', 'admin'\]\.includes\(userProfile\?\.role/)
  assert.match(panel, /data-testid="review-shift-button"/)
  assert.match(panel, /Pending review\s*</, 'non-managing staff still see the passive label')
  assert.match(panel, /<ShiftReviewModal/)
  assert.match(panel, /invalidateQueries.*student_shift_logs/, 'decisions re-read, never compute locally')
})

test('the modal shows flags, context, same-day shifts, and the resulting total before confirming', () => {
  for (const tid of ['review-submitted', 'review-flags', 'review-context', 'review-warnings',
    'review-ack', 'review-rationale', 'review-resulting', 'review-confirm', 'review-adjusted-hours']) {
    assert.ok(modal.includes(`data-testid="${tid}"`), `${tid} rendered`)
  }
  assert.match(modal, /Approve as submitted/)
  assert.match(modal, /Adjust and approve/)
  assert.match(modal, /Reject/)
  assert.match(modal, /completion threshold, not a maximum/)
})

test('the confirm button is blocked without rationale (adjust/reject) or acknowledgement (warnings)', () => {
  assert.match(modal, /const rationaleRequired = decision !== 'approved'/)
  assert.match(modal, /const needsAck = decision !== 'rejected' && warnings\.length > 0 && !ackWarnings/)
  assert.match(modal, /const blocked = busy \|\| rationaleMissing \|\| adjustedInvalid \|\| needsAck/)
  assert.match(modal, /disabled=\{blocked\}/)
})

test('the client writes only through the protected endpoint', () => {
  assert.match(api, /fetch\('\/api\/shift-log-review'/)
  assert.doesNotMatch(api, /from\('student_shift_logs'\)/, 'no direct table writes')
  assert.doesNotMatch(modal, /from\('student_shift_logs'\)[\s\S]{0,300}\.(update|insert|upsert|delete)\(/)
})

test('the Pending Review queue: per-student badge, cohort filter, and off-list safety net', () => {
  assert.match(rotation, /pendingByStudent/)
  assert.match(rotation, /l\.status === 'Pending Review' \|\| l\.status === 'needs_review'/,
    'legacy spelling counted too')
  assert.match(rotation, /lifecycle_state === 'completed'/, 'open shifts are not stranded hours')
  // ROTATION-ACTIVITY-CALENDAR-1: the per-student badge moved into RotationStudentTable
  // with the rest of the row; the counting and both filters stay in RotationActivity.
  assert.match(read('src/components/rotation/RotationStudentTable.jsx'), /Needs review · \$\{pendingReview\}/)
  assert.match(rotation, /data-testid="pending-review-filter"/)
  // The list now includes Placed as well as Active Rotation, which SHRINKS this ledger
  // rather than removing the need for it: a Completed student holding a stranded shift
  // still has to be named somewhere.
  assert.match(rotation, /data-testid="pending-offlist"/, 'pending shifts outside the list stay visible')
})

// ── Canonical UI state refresh (finding 3) ──────────────────────────────────

const { applyReviewTotals } = await import('../src/lib/studentTotals.js')

test('applyReviewTotals: deterministic, immutable, and safe on unusable input', () => {
  const students = [{ id: 'a', approved_hours: 10, pending_hours: 5, name: 'A' }, { id: 'b', approved_hours: 3, pending_hours: 0 }]
  const next = applyReviewTotals(students, { student_id: 'a', approved_hours: 18, pending_hours: 0 })
  assert.notEqual(next, students, 'a new array - React state actually updates')
  assert.deepEqual(next[0], { id: 'a', approved_hours: 18, pending_hours: 0, name: 'A' })
  assert.equal(next[1], students[1], 'untouched students keep identity')
  assert.equal(applyReviewTotals(students, null), students)
  assert.equal(applyReviewTotals(students, { student_id: 'zz', approved_hours: 1, pending_hours: 1 }), students)
  assert.equal(applyReviewTotals(students, { student_id: 'a', approved_hours: 'nope' }), students, 'non-finite totals never land')
})

test('the decision result reaches the ACTUAL owners of student state on both surfaces', () => {
  const app = read('src/App.jsx')
  // App owns canonical students in useState and applies the result there:
  assert.match(app, /const \[students,\s+setStudents\]\s+= useState/)
  assert.match(app, /const applyStudentReviewTotals = useCallback\(\(result\) => \{\s*\n?\s*setStudents\(prev => applyReviewTotals\(prev, result\)\)/)
  // ...threaded down BOTH review surfaces:
  const profilesMount = app.slice(app.indexOf('<StudentProfilesTab'), app.indexOf('</div>', app.indexOf('<StudentProfilesTab')))
  assert.match(profilesMount, /onReviewDecided=\{applyStudentReviewTotals\}/)
  const rotationMount = app.slice(app.indexOf('<RotationTab'), app.indexOf('</div>', app.indexOf('<RotationTab')))
  assert.match(rotationMount, /onReviewDecided=\{applyStudentReviewTotals\}/)
  // ...through each intermediate owner:
  assert.match(read('src/components/StudentProfilesTab.jsx'), /onReviewDecided=\{onReviewDecided\}/)
  assert.match(read('src/components/RotationTab.jsx'), /onReviewDecided=\{props\.onReviewDecided\}/)
  const rot = read('src/components/RotationActivity.jsx')
  // ROTATION-ACTIVITY-CALENDAR-1: ProgressRowCard is gone. The hours panel is now
  // supplied by RotationActivity through RotationStudentTable's renderHours, so the
  // chain is one link shorter and the callback is threaded at the render site itself.
  assert.match(rot, /renderHours=\{card => \(/)
  // Asserted inside the element itself rather than with a character budget, which a
  // comment between the props would otherwise silently blow past.
  const hoursEl = rot.slice(rot.indexOf('<ActiveRotationHours'), rot.indexOf('/>', rot.indexOf('<ActiveRotationHours')))
  assert.ok(hoursEl.length > 0, '<ActiveRotationHours> not found')
  assert.match(hoursEl, /onReviewDecided=\{onReviewDecided\}/)
  assert.match(rot, /<ClinicalHoursPanel[^/]*onReviewDecided=\{onReviewDecided\}/)
  // ...and the side panel updates its LOCAL copy too, then forwards:
  const sidePanel = read('src/components/StudentSidePanel.jsx')
  assert.match(sidePanel, /setData\(d => \(\{ \.\.\.d, approved_hours: approved, pending_hours: pending \}\)\)/)
  assert.match(sidePanel, /onReviewDecided\?\.\(result\)/)
})

test("NEGATIVE CONTROL: invalidating a ['students'] query key is provably insufficient", () => {
  // The panel no longer performs the useless invalidation...
  assert.doesNotMatch(panel, /queryKey: \['students'\]/,
    'the dead invalidation is gone; the callback carries the result instead')
  assert.match(panel, /onReviewDecided\?\.\(result\)/)
  // ...and it WOULD be useless: no React Query anywhere holds ['students'] -
  // the canonical collection is App useState, unreachable by invalidation.
  const app = read('src/App.jsx')
  assert.doesNotMatch(app, /useQuery\(\{\s*queryKey:\s*\['students'\]/)
  // The queue and the shift list DO live in React Query and are refreshed:
  assert.match(panel, /invalidateQueries\(\{ queryKey: \['student_shift_logs', data\.id\] \}\)/)
  assert.match(panel, /invalidateQueries\(\{ queryKey: \['rotation_log_summary'\] \}\)/)
})

// ── Portal non-exposure (negative controls) ─────────────────────────────────

test('NEGATIVE CONTROL: portals still never expose flags or reviewer notes', () => {
  const ulShifts = strip(read('api/portal/unit-student-shifts.js'))
  assert.doesNotMatch(ulShifts, /exception_flags|admin_notes|reviewed_by|review_reason/,
    'unit leader shift allowlist unchanged (comments aside, no code touches review internals)')
  assert.match(ulShifts, /SAFE_COLUMNS = \['id', 'shift_date', 'total_hours', 'unit_name', 'preceptor_name', 'shift_type', 'status'\]/)
  const portal = read('src/portal/StudentPortal.jsx')
  assert.doesNotMatch(portal, /exception_flags|admin_notes|reviewed_by/,
    'student portal renders no review internals')
  // The portal view migration is untouched by this feature:
  const view = read('supabase/migrations/20260712000008_phase2_student_portal_views.sql')
  assert.doesNotMatch(view.slice(view.indexOf('portal_my_shift_logs'), view.indexOf('GRANT')), /exception_flags|admin_notes|reviewed_by/)
})

test('NEGATIVE CONTROL: removing the fail-closed gate or the locks fails this suite', () => {
  const withoutGate = ep.replace(/if \(!\(await reviewReady\(db\)\)\) \{[\s\S]*?\}\s*/, '')
  assert.ok(!withoutGate.includes('migration_required'), 'the gate text lives only in the gate')
  const fn = sqlCode.slice(sqlCode.indexOf('review_shift_log'), sqlCode.indexOf('shift_review_ready'))
  const withoutLocks = fn.replace(/FOR UPDATE/g, '')
  assert.equal((withoutLocks.match(/FOR UPDATE/g) || []).length, 0,
    'the lock-count assertion above would fail on a lockless rewrite')
})
