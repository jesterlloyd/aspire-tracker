// EVALUATION-REMINDERS-1: the cron endpoint, EXECUTED.
//
// The real handler runs with its Supabase and Resend clients substituted, so
// these are behavioural claims: what a paused automation does, what an
// unreadable settings table does, what a dry run touches, and what happens when
// two runs overlap. Nothing is sent and no database is touched.
//
// Run: node --test test/evaluationRemindersCron.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.EVALUATION_TOKEN_PEPPER ||= 'test-pepper-not-a-secret'
process.env.CRON_SECRET = 'test-cron-secret'
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key-not-a-secret'
process.env.RESEND_API_KEY ||= 'test-key-not-a-secret'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')
const abs = (p) => JSON.stringify(pathToFileURL(join(repo, p)).href)

const NOW_MS = Date.now()
const daysAgo = (n) => new Date(NOW_MS - n * 86400000).toISOString()
const daysAhead = (n) => new Date(NOW_MS + n * 86400000).toISOString()

// ── The substituted world ───────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'evalrem-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

writeFileSync(join(dir, 'fake.mjs'), `
  export let state = {};
  export let ops = [];
  export let sends = [];
  export function __reset(s = {}) {
    ops = []; sends = [];
    state = {
      automationRow: { enabled: true },
      automationError: null,
      assignments: [],
      instruments: [],
      students: [],
      claimReturns: null,
      claimError: null,
      ...s,
    };
  }
  export function __ops() { return ops }
  export function __sends() { return sends }

  export class Resend {
    constructor() {
      this.emails = { send: async (payload, options) => {
        if (state.trapWrites) throw new Error('TRAP: provider call attempted during a dry run');
        sends.push({ payload, options });
        return { data: { id: 're_' + sends.length }, error: null };
      } };
    }
  }

  // Any mutation at all, while armed, is a hard failure rather than a silent write.
  function trap(kind, table) {
    if (state.trapWrites) throw new Error('TRAP: ' + kind + ' on ' + table + ' attempted during a dry run');
  }

  function builder(table) {
    const op = { table, kind: null, payload: null, filters: [] };
    const result = () => {
      if (table === 'automation_settings') {
        if (state.automationError) return { data: null, error: state.automationError };
        return { data: state.automationRow ? [state.automationRow] : [], error: null };
      }
      // Hydration reads are the SECOND read of a table and are filtered by id.
      // Failing only those isolates the recovery path from the due-window scan.
      const isHydration = op.filters.some(([f]) => f === 'id');
      if (state.hydrateError === table && isHydration) {
        return { data: null, error: { message: 'transient read error on ' + table } };
      }
      if (table === 'evaluation_assignments') {
        return { data: (isHydration && state.hydrateAssignments) ? state.hydrateAssignments : state.assignments, error: null };
      }
      if (table === 'evaluation_instruments') return { data: state.instruments, error: null };
      if (table === 'students') return { data: state.students, error: null };
      if (table === 'cron_runs' && op.kind === 'insert') return { data: { id: 'run-1' }, error: null };
      if (table === 'evaluation_assignment_tokens' && op.kind === 'select') return { data: [{ id: 'tok-old' }], error: null };
      if (table === 'evaluation_assignment_tokens' && op.kind === 'insert') return { data: { id: 'tok-new' }, error: null };
      if (table === 'notification_log' && op.kind === 'insert') return { data: { id: 'log-1' }, error: null };
      if (table === 'user_student_links') return { data: [], error: null };
      return { data: null, error: null };
    };
    const api = {
      select() { op.kind = op.kind || 'select'; return api },
      __record() { if (!op.pushed) { op.pushed = true; op.kind = op.kind || 'select'; ops.push(op) } },
      insert(row) { trap('insert', table); op.kind = 'insert'; op.payload = row; op.pushed = true; ops.push(op); return api },
      update(row) { trap('update', table); op.kind = 'update'; op.payload = row; op.pushed = true; ops.push(op); return api },
      upsert(row) { trap('upsert', table); op.kind = 'upsert'; op.payload = row; op.pushed = true; ops.push(op); return Promise.resolve({ error: null }) },
      eq(f, v) { op.filters.push([f, v]); return api },
      is(f, v) { op.filters.push([f, v]); return api },
      in(f, v) { op.filters.push([f, v]); return api },
      gte(f, v) { op.filters.push([f, v]); return api },
      lte(f, v) { op.filters.push([f, v]); return api },
      gt(f, v) { op.filters.push([f, v]); return api },
      order() { return api },
      limit() { return api },
      single() { api.__record(); return Promise.resolve(result()) },
      then(res, rej) {
        api.__record();
        return Promise.resolve(result()).then(res, rej);
      },
    };
    return api;
  }

  export function createClient() {
    return {
      from: (t) => builder(t),
      rpc: async (fn, args) => {
        trap('rpc', fn);
        ops.push({ table: 'rpc:' + fn, kind: 'rpc', payload: args });
        if (state.claimError) return { data: null, error: state.claimError };
        if (state.claimReturns) return { data: state.claimReturns, error: null };
        // Default: claim everything offered.
        return {
          data: (args.p_candidates || []).map((c, i) => ({
            id: 'led-' + i, assignment_id: c.assignment_id,
            reminder_number: c.reminder_number, status: 'claimed', attempts: 1,
          })),
          error: null,
        };
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email_confirmed_at: 'x' } }, error: null }) } },
    };
  }
`)

const src = read('api/cron/evaluation-reminders.js')
  .replace(/from '@supabase\/supabase-js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
  .replace(/from 'resend'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
  .replace(/from '\.\.\/lib\/cronRuns\.js'/, `from ${abs('api/lib/cronRuns.js')}`)
  // S-12: the cron auth guard now lives in a shared helper.
  .replace(/from '\.\.\/lib\/cronAuth\.js'/, `from ${abs('api/lib/cronAuth.js')}`)
  .replace(/from '\.\.\/lib\/automationSettings\.js'/, `from ${abs('api/lib/automationSettings.js')}`)
  .replace(/from '\.\.\/\.\.\/lib\/server\/appUrl\.js'/, `from ${abs('lib/server/appUrl.js')}`)
  .replace(/from '\.\.\/\.\.\/src\/lib\/evaluation\/reminderSchedule\.js'/, `from ${abs('src/lib/evaluation/reminderSchedule.js')}`)
  .replace(/from '\.\.\/\.\.\/lib\/server\/evaluation\/reminderRecipient\.js'/, `from ${abs('lib/server/evaluation/reminderRecipient.js')}`)
  .replace(/from '\.\.\/\.\.\/lib\/server\/evaluation\/reminderSend\.js'/, `from ${abs('lib/server/evaluation/reminderSend.js')}`)
writeFileSync(join(dir, 'handler.mjs'), src)

const fake = await import(pathToFileURL(join(dir, 'fake.mjs')).href)
const mod = await import(pathToFileURL(join(dir, 'handler.mjs')).href)
const { default: handler, runEvaluationReminders } = mod
/** The hourly recovery endpoint calls the shared run with sweep fixed in code. */
const sweepHandler = (req, res) => runEvaluationReminders(req, res, { sweep: true })

// ── Fixtures ────────────────────────────────────────────────────────────────
const CASEY = { id: 'i-casey', slug: 'casey_fink_readiness_2024', permission_status: 'authorized' }
const dueAssignment = (over = {}) => ({
  id: 'a-1', instrument_id: CASEY.id, student_id: 's-1', cohort_id: 'c-1',
  timepoint: 'post_rotation', respondent_type: 'student',
  respondent_email: null, respondent_name: null,
  status: 'sent', sent_at: daysAgo(7), expires_at: daysAhead(21),
  completed_at: null, revoked_at: null, ...over,
})
const STUDENT = {
  id: 's-1', first_name: 'Ava', last_name: 'Wong',
  school_email: 'ava@school.example.edu', personal_email: 'ava@personal.example.com',
  status: 'Completed', ngrp_outcome: 'Pending',
}

function makeRes() {
  const res = { statusCode: null, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  res.end = () => res
  return res
}
const req = (query = {}) => ({
  method: 'GET', query, headers: { authorization: 'Bearer test-cron-secret', host: 'aspireintelligence.app' },
})

const oneDue = () => ({ assignments: [dueAssignment()], instruments: [CASEY], students: [STUDENT] })
/** EVERY mutation, cron_runs included - the dry run is allowed none of them. */
const writeOps = () => fake.__ops().filter(o => ['insert', 'update', 'upsert', 'rpc'].includes(o.kind))
/** Mutations other than the run heartbeat, which a LIVE run legitimately writes. */
const effectOps = () => writeOps().filter(o => o.table !== 'cron_runs')

// ── Authentication ──────────────────────────────────────────────────────────

test('the endpoint requires the cron secret', async () => {
  fake.__reset(oneDue())
  const res = makeRes()
  await handler({ ...req(), headers: { authorization: 'Bearer wrong' } }, res)
  assert.equal(res.statusCode, 401)
  assert.equal(fake.__sends().length, 0)
  assert.equal(writeOps().length, 0)
})

// ── Paused / unreadable settings send nothing ───────────────────────────────

test('A PAUSED AUTOMATION SENDS NOTHING', async () => {
  fake.__reset({ ...oneDue(), automationRow: { enabled: false } })
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.skipped, true)
  assert.equal(res.body.reason, 'automation_disabled')
  assert.equal(fake.__sends().length, 0)
  assert.equal(effectOps().length, 0, 'not even a ledger row is created while paused')
})

test('DEFAULT OFF: a missing settings row sends nothing', async () => {
  fake.__reset({ ...oneDue(), automationRow: null })
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.body.skipped, true)
  assert.equal(res.body.reason, 'automation_disabled')
  assert.equal(fake.__sends().length, 0)
})

test('FAIL CLOSED: an unreadable settings table sends nothing', async () => {
  fake.__reset({ ...oneDue(), automationError: { message: 'settings table unavailable' } })
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.skipped, true)
  assert.equal(res.body.reason, 'automation_settings_unreadable')
  assert.equal(fake.__sends().length, 0)
  assert.equal(effectOps().length, 0)
})

// ── Dry run is read-only ────────────────────────────────────────────────────

test('THE DRY RUN PERFORMS NO WRITES AND NO SENDS', async () => {
  fake.__reset(oneDue())
  const res = makeRes()
  await handler(req({ dryRun: '1' }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.dry_run, true)
  assert.equal(res.body.would_send_count, 1)

  assert.equal(fake.__sends().length, 0, 'no email')
  const writes = writeOps()
  assert.deepEqual(writes.map(w => `${w.table}.${w.kind}`), [],
    'a dry run must mutate nothing at all')
  // Specifically: no heartbeat, no claim, no token, no ledger row, no log, no archive.
  const tables = fake.__ops().map(o => o.table)
  assert.ok(!tables.includes('cron_runs'), 'NOT EVEN THE cron_runs HEARTBEAT')
  assert.ok(!tables.includes('rpc:claim_evaluation_reminders'), 'no claim')
  assert.ok(!tables.includes('evaluation_assignment_tokens'), 'no token stored')
  assert.ok(!tables.includes('evaluation_reminder_deliveries'), 'no ledger row')
  assert.ok(!tables.includes('message_archive'), 'no archive')
})

test('DRY RUN WRITE TRAP: the real handler completes with every mutation armed to throw', async () => {
  // Any insert, update, upsert, RPC, or provider call raises. If the dry run
  // touched anything, this test fails loudly instead of quietly passing.
  fake.__reset({ ...oneDue(), trapWrites: true })
  const res = makeRes()
  await handler(req({ dryRun: '1' }), res)
  assert.equal(res.statusCode, 200, 'the dry run completed without attempting a single mutation')
  assert.equal(res.body.dry_run, true)
  assert.equal(res.body.would_send_count, 1, 'and still did its real work of reporting')
  assert.equal(fake.__sends().length, 0)
  assert.deepEqual(writeOps(), [])
})

test('the write trap is real: a LIVE run trips it', async () => {
  // Negative control for the test above - proves the trap can actually fire.
  fake.__reset({ ...oneDue(), trapWrites: true })
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.statusCode, 500, 'a live run does mutate, so the armed trap must catch it')
})

test('the dry run still reports honest counts and sanitized reasons', async () => {
  fake.__reset({
    assignments: [
      dueAssignment({ id: 'due' }),
      dueAssignment({ id: 'done', completed_at: daysAgo(1) }),
      dueAssignment({ id: 'closed', expires_at: daysAgo(1) }),
    ],
    instruments: [CASEY], students: [STUDENT],
  })
  const res = makeRes()
  await handler(req({ dry_run: '1' }), res)
  assert.equal(res.body.eligible_count, 1)
  assert.equal(res.body.completed_suppressed_count, 1)
  assert.equal(res.body.expired_suppressed_count, 1)
  for (const reason of Object.keys(res.body.skip_reasons)) {
    assert.match(reason, /^[a-z0-9_]{1,64}$/, `reason "${reason}" is not a sanitized token`)
  }
})

test('a dry run reports even while the automation is paused, and still sends nothing', async () => {
  fake.__reset({ ...oneDue(), automationRow: { enabled: false } })
  const res = makeRes()
  await handler(req({ dryRun: '1' }), res)
  assert.equal(res.body.dry_run, true)
  assert.equal(res.body.automation_enabled, false)
  assert.equal(fake.__sends().length, 0)
  assert.deepEqual(writeOps(), [])
})

// ── Live run ────────────────────────────────────────────────────────────────

test('a live run claims, sends, and records the outcome', async () => {
  fake.__reset(oneDue())
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.sent_count, 1)
  assert.equal(res.body.claimed_count, 1)
  assert.equal(res.body.duplicate_suppressed_count, 0)
  assert.equal(fake.__sends().length, 1)
  const claim = fake.__ops().find(o => o.table === 'rpc:claim_evaluation_reminders')
  assert.ok(claim, 'the atomic claim is what authorizes the send')
  assert.deepEqual(claim.payload.p_candidates, [{ assignment_id: 'a-1', reminder_number: 1 }])
  assert.match(claim.payload.p_worker, /^evaluation-reminders:/)
})

test('CONCURRENT OR RETRIED RUNS CANNOT DUPLICATE: an unclaimed candidate is not sent', async () => {
  // The ledger row is already sent/claimed elsewhere, so the claim returns nothing.
  fake.__reset({ ...oneDue(), claimReturns: [] })
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.body.eligible_count, 1)
  assert.equal(res.body.claimed_count, 0)
  assert.equal(res.body.sent_count, 0)
  assert.equal(res.body.duplicate_suppressed_count, 1, 'the unclaimed candidate is reported, not silently dropped')
  assert.equal(fake.__sends().length, 0, 'a second run sends nothing')
})

test('the run reports every count the operator needs, all numeric', async () => {
  fake.__reset(oneDue())
  const res = makeRes()
  await handler(req(), res)
  for (const k of [
    'eligible_count', 'claimed_count', 'sent_count', 'failed_count',
    'completed_suppressed_count', 'expired_suppressed_count',
    'missing_email_count', 'duplicate_suppressed_count',
  ]) {
    assert.equal(typeof res.body[k], 'number', `${k} must be reported`)
  }
})

test('a recipient with no usable address is counted, and no email is attempted', async () => {
  fake.__reset({
    assignments: [dueAssignment()], instruments: [CASEY],
    students: [{ ...STUDENT, ngrp_outcome: 'Hired' }],   // hired, and no portal account exists
  })
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.body.missing_email_count, 1)
  assert.equal(res.body.deliverable_count, 0)
  assert.equal(res.body.sent_count, 0)
  assert.equal(fake.__sends().length, 0)
  assert.equal(res.body.recipient_reasons.missing_verified_cedars_email, 1)
})

test('an unregistered instrument is never reminded through this cron', async () => {
  fake.__reset({
    assignments: [dueAssignment()],
    instruments: [{ id: 'i-casey', slug: 'some_future_survey', permission_status: 'authorized' }],
    students: [STUDENT],
  })
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.body.eligible_count, 0)
  assert.equal(fake.__sends().length, 0)
  assert.equal(res.body.skip_reasons.unregistered_instrument, 1)
})

test('the per-run send cap is conservative and any overflow is reported, never dropped', async () => {
  const { MAX_SENDS_PER_RUN } = await import('../api/cron/evaluation-reminders.js')
  assert.ok(MAX_SENDS_PER_RUN > 0 && MAX_SENDS_PER_RUN <= 50, `cap ${MAX_SENDS_PER_RUN} should stay conservative`)

  const many = Array.from({ length: MAX_SENDS_PER_RUN + 3 }, (_, i) => dueAssignment({ id: `a-${i}`, student_id: 's-1' }))
  fake.__reset({ assignments: many, instruments: [CASEY], students: [STUDENT] })
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.body.eligible_count, MAX_SENDS_PER_RUN + 3)
  assert.equal(res.body.sent_count, MAX_SENDS_PER_RUN)
  assert.equal(res.body.capped_count, 3, 'the overflow is visible in the run report')
  assert.equal(fake.__sends().length, MAX_SENDS_PER_RUN)
})

test('a claim failure fails the run loudly rather than sending unclaimed', async () => {
  fake.__reset({ ...oneDue(), claimError: { message: 'deadlock' } })
  const res = makeRes()
  await handler(req(), res)
  assert.equal(res.statusCode, 500)
  assert.equal(fake.__sends().length, 0)
})

// ── The recovery sweep ──────────────────────────────────────────────────────

test('THE SWEEP RECONCILES ONLY PRIOR ATTEMPTS - it offers no new recipients', async () => {
  fake.__reset({ ...oneDue(), claimReturns: [] })
  const res = makeRes()
  await sweepHandler(req(), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.mode, 'recovery_sweep')

  const claim = fake.__ops().find(o => o.table === 'rpc:claim_evaluation_reminders')
  assert.ok(claim, 'the sweep still goes through the atomic claim')
  assert.equal(claim.payload.p_recover_only, true)
  assert.deepEqual(claim.payload.p_candidates, [],
    'NO CANDIDATES: recipient cadence stays 7/14/21, the sweep only reconciles')
  assert.match(claim.payload.p_worker, /^evaluation-reminders-recovery:/,
    'the claim holder names the recovery identity, so a stuck claim is attributable')
  assert.equal(fake.__sends().length, 0)
})

test('SWEEP METRICS: duplicate_suppressed_count is zero and never negative', async () => {
  // The sweep offers no candidates but claims prior work - the naive
  // offered-minus-claimed subtraction would go negative here.
  fake.__reset({
    ...oneDue(),
    claimReturns: [
      { id: 'led-a', assignment_id: 'a-1', reminder_number: 1, status: 'claimed', attempts: 1, delivery_epoch: 0, sent_at: daysAgo(0), notification_log_id: 'log-1' },
      { id: 'led-b', assignment_id: 'a-1', reminder_number: 2, status: 'claimed', attempts: 1, delivery_epoch: 0, sent_at: daysAgo(0), notification_log_id: 'log-2' },
    ],
  })
  const res = makeRes()
  await sweepHandler(req(), res)
  assert.equal(res.body.duplicate_suppressed_count, 0)
  assert.equal(res.body.capped_count, 0)
})

test('EVERY reported count is a nonnegative integer, in both modes', async () => {
  const isCount = (k) => k.endsWith('_count')
  const check = (body, mode) => {
    const counts = Object.entries(body).filter(([k]) => isCount(k))
    assert.ok(counts.length > 0, `${mode}: counts are reported`)
    for (const [k, v] of counts) {
      assert.equal(typeof v, 'number', `${mode}.${k} must be a number`)
      assert.ok(Number.isInteger(v), `${mode}.${k} must be an integer, saw ${v}`)
      assert.ok(v >= 0, `${mode}.${k} must be nonnegative, saw ${v}`)
    }
  }

  // Weekly, with work claimed.
  fake.__reset(oneDue())
  const weekly = makeRes()
  await handler(req(), weekly)
  check(weekly.body, 'weekly')

  // Weekly, with everything already handled elsewhere.
  fake.__reset({ ...oneDue(), claimReturns: [] })
  const dup = makeRes()
  await handler(req(), dup)
  check(dup.body, 'weekly/duplicate')

  // Sweep, claiming prior work with zero candidates offered.
  fake.__reset({
    ...oneDue(),
    claimReturns: [{ id: 'led-a', assignment_id: 'a-1', reminder_number: 1, status: 'claimed', attempts: 1, delivery_epoch: 0, sent_at: daysAgo(0), notification_log_id: 'log-1' }],
  })
  const sweep = makeRes()
  await sweepHandler(req(), sweep)
  check(sweep.body, 'sweep')

  // Dry run.
  fake.__reset(oneDue())
  const dry = makeRes()
  await handler(req({ dryRun: '1' }), dry)
  check(dry.body, 'dry_run')
})

// ── Recovery hydration must fail safely ─────────────────────────────────────

for (const [label, table] of [
  ['assignments', 'evaluation_assignments'],
  ['instruments', 'evaluation_instruments'],
  ['students', 'students'],
]) {
  test(`a failed ${label} hydration read FAILS THE RUN and leaves the ledger recoverable`, async () => {
    fake.__reset({
      assignments: [], instruments: [CASEY], students: [STUDENT],
      hydrateError: table,
      // The recovered row's assignment is outside the due-window scan, so the
      // sweep must hydrate it - and then its instrument and student too.
      hydrateAssignments: [dueAssignment({ id: 'a-old' })],
      claimReturns: [{
        id: 'led-x', assignment_id: 'a-old', reminder_number: 1, status: 'claimed',
        attempts: 1, delivery_epoch: 0,
      }],
    })
    const res = makeRes()
    await sweepHandler(req(), res)

    assert.equal(res.statusCode, 500, 'the run reports failure')
    assert.equal(fake.__sends().length, 0, 'zero provider calls')

    // Crucially: the ledger row is NOT driven to a terminal state. A momentary
    // read error must never permanently cancel a reminder.
    const ledgerWrites = fake.__ops()
      .filter(o => o.table === 'evaluation_reminder_deliveries' && o.kind === 'update')
    for (const w of ledgerWrites) {
      assert.ok(!['suppressed', 'sent', 'failed', 'needs_reconciliation'].includes(w.payload.status),
        `a transient ${label} read error must not produce a terminal ${w.payload.status} row`)
    }
    assert.equal(ledgerWrites.length, 0, 'in fact the ledger is not touched at all')
  })
}

test('BOTH CRON ENTRIES REGISTER, on distinct paths with no query string', () => {
  const vercel = JSON.parse(read('vercel.json'))
  const crons = vercel.crons.filter(c => c.path.includes('evaluation-reminders'))
  assert.equal(crons.length, 2)

  const weekly = crons.find(c => c.path === '/api/cron/evaluation-reminders')
  const sweep = crons.find(c => c.path === '/api/cron/evaluation-reminders-recovery')
  assert.ok(weekly, 'the weekly reminder run is registered')
  assert.ok(sweep, 'the hourly recovery sweep is registered on its OWN path')

  // Vercel invokes these with a plain production GET. Behaviour must not depend
  // on a query parameter that could be dropped - a sweep entry that lost its
  // flag would become a full weekly send.
  for (const c of crons) assert.ok(!c.path.includes('?'), `${c.path} must carry no query string`)

  assert.match(weekly.schedule, /^\d+ \d+ \* \* \d$/, 'reminders run once a week')
  assert.match(sweep.schedule, /^\d+ \* \* \* \*$/, 'reconciliation runs hourly, inside the 24h provider window')

  // The first production run processed 27 of 35 reminders before Vercel killed
  // it at the old 60-second ceiling. Both the weekly worker and the recovery
  // worker need enough room for the full crash-safe batch.
  assert.equal(vercel.functions['api/cron/evaluation-reminders.js']?.maxDuration, 300)
  assert.equal(vercel.functions['api/cron/evaluation-reminders-recovery.js']?.maxDuration, 300)
  const recovery = read('api/cron/evaluation-reminders-recovery.js')
  assert.match(recovery, /runEvaluationReminders\(req, res, \{ sweep: true \}\)/,
    'the recovery path fixes the mode in code, not in a query string')
})

test('the weekly and recovery runs record under DIFFERENT cron names', async () => {
  fake.__reset(oneDue())
  await handler(req(), makeRes())
  const weeklyRun = fake.__ops().find(o => o.table === 'cron_runs' && o.kind === 'insert')
  assert.equal(weeklyRun.payload.cron_name, 'evaluation-reminders')

  fake.__reset({ ...oneDue(), claimReturns: [] })
  await sweepHandler(req(), makeRes())
  const sweepRun = fake.__ops().find(o => o.table === 'cron_runs' && o.kind === 'insert')
  assert.equal(sweepRun.payload.cron_name, 'evaluation-reminders-recovery',
    'a healthy sweep must not be able to stand in for a missed weekly run')
})

test('the Automations card still monitors the WEEKLY run only', () => {
  const catalog = read('src/lib/automationCatalog.js')
  const entry = catalog.slice(catalog.indexOf("id: 'evaluation_reminders'"), catalog.indexOf("id: 'midpoint_checkin'"))
  assert.match(entry, /cronName: 'evaluation-reminders'/)
  assert.ok(!entry.includes('evaluation-reminders-recovery'),
    'the card must not watch the sweep, or hourly success would mask a missed weekly send')
  // And the recovery name is registered nowhere as a card.
  assert.ok(!read('src/components/connect/AutomationView.jsx').includes('evaluation-reminders-recovery'))
})

test('a sweep hydrates assignments the due-window scan would never return', async () => {
  // The claimed row's assignment is completed and long past the reminder window,
  // so only hydration makes it resolvable at all.
  fake.__reset({
    assignments: [], instruments: [CASEY], students: [STUDENT],
    claimReturns: [{
      id: 'led-x', assignment_id: 'a-old', reminder_number: 1, status: 'claimed',
      attempts: 1, delivery_epoch: 0, sent_at: daysAgo(1), notification_log_id: 'log-1',
    }],
  })
  const res = makeRes()
  await sweepHandler(req(), res)
  assert.equal(res.statusCode, 200)
  const hydrate = fake.__ops().filter(o => o.table === 'evaluation_assignments' && o.kind === 'select')
  assert.ok(hydrate.length >= 1, 'the sweep looks up assignments outside the due window')
  assert.equal(fake.__sends().length, 0, 'and a delivered row is tidied, never re-sent')
})

// ── Structural guards ───────────────────────────────────────────────────────

test('the cron asks the shared gate for default-OFF, and no other cron changed', () => {
  const code = read('api/cron/evaluation-reminders.js')
  assert.match(code, /defaultEnabled: false/, 'this automation must default to OFF')
  // The shared helper is untouched, so every existing cron keeps failing open.
  const shared = read('api/lib/automationSettings.js')
  assert.match(shared, /defaultEnabled = true/, 'the shared default stays true for existing crons')
})

test('the dry-run branch returns before the claim call in source order', () => {
  const code = read('api/cron/evaluation-reminders.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const dryReturn = code.indexOf('if (isDryRun)')
  const claim = code.indexOf('claim_evaluation_reminders')
  assert.ok(dryReturn > 0 && claim > dryReturn,
    'the dry run must be structurally incapable of reaching the claim')
})

test('batch progress logs counts only, never reminder or recipient identifiers', () => {
  const sender = read('lib/server/evaluation/reminderSend.js')
  assert.match(sender, /progress processed=\$\{processedCount\} total=\$\{totalCount\}/)
  const progressLine = sender.split('\n').find(line => line.includes('progress processed=')) || ''
  for (const forbidden of ['assignment', 'recipient', 'email', 'token', 'surveyUrl', 'ledgerRow']) {
    assert.ok(!progressLine.includes(forbidden), `progress log leaked ${forbidden}`)
  }
})
