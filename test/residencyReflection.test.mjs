// RESIDENCY-REFLECTION-1: the NGRP Bi-Weekly Clinical Orientation Progress and
// Reflection Tool, sent to residents by secure link. Owner decisions,
// 2026-09-13: bi-weekly, five periods, ten weeks, started by a button; the
// preceptor's section and sharing deferred; it REPLACES the weekly check-in.
// Run: node --test test/residencyReflection.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  buildSchedule, closesOn, validateReflection, summarizeReflections, addDays, weekdayOf,
  PERIOD_COUNT, PERIOD_DAYS, GRACE_DAYS, DIFFICULTY_AREA_KEYS, MAX_SHIFTS,
} from '../src/lib/ngrp/ngrpReflectionForm.js'
import {
  sendReflectionPeriod, resolveReflectionToken, periodsToSend, periodClosesAt, reflectionRecipient,
} from '../lib/server/ngrpReflection.js'
import { buildReflectionEmail } from '../lib/server/email/ngrpReflectionEmail.js'
import { NGRP_AUDIT_EVENTS } from '../lib/server/ngrpAudit.js'
import { duringResidency } from '../src/lib/ngrp/ngrpSupportView.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const code = src => src.split('\n').filter(l => !/^\s*(--|\/\/)/.test(l)).join('\n')

// ── Schedule ────────────────────────────────────────────────────────────────

test('the schedule: five periods, Sunday due dates, Friday sends, from the day Start was pressed', () => {
  // Started on a Friday.
  const s = buildSchedule({ startedOn: '2026-09-18' })
  assert.equal(s.length, PERIOD_COUNT)
  assert.equal(PERIOD_COUNT, 5)
  assert.equal(PERIOD_DAYS, 14)
  assert.deepEqual(s[0], { period_number: 1, opens_on: '2026-09-18', due_on: '2026-10-04', send_on: '2026-09-18' })
  assert.deepEqual(s[1], { period_number: 2, opens_on: '2026-10-05', due_on: '2026-10-18', send_on: '2026-10-02' })
  assert.deepEqual(s[4], { period_number: 5, opens_on: '2026-11-16', due_on: '2026-11-29', send_on: '2026-11-13' })
  for (const p of s) {
    assert.equal(weekdayOf(p.due_on), 0, `period ${p.period_number} is due on a Sunday`)
    if (p.period_number > 1) {
      assert.equal(weekdayOf(p.send_on), 5, `period ${p.period_number} is sent on a Friday`)
      assert.equal(weekdayOf(p.opens_on), 1, `period ${p.period_number} opens on a Monday`)
    }
  }
  // Ten weeks from the first due date to the last.
  assert.equal(addDays(s[0].due_on, PERIOD_DAYS * 4), s[4].due_on)
  // Period 1 is sent at once, whatever day it is; it is 13 to 19 days long.
  for (const day of ['2026-09-20', '2026-09-21', '2026-09-24']) {
    const first = buildSchedule({ startedOn: day })[0]
    assert.equal(first.send_on, day)
    assert.equal(weekdayOf(first.due_on), 0)
    const len = (Date.parse(first.due_on) - Date.parse(day)) / 86400000
    assert.ok(len >= 13 && len <= 19, `${day}: ${len} days`)
  }
  // The link stays open past the Sunday.
  assert.equal(GRACE_DAYS, 2)
  assert.equal(closesOn(s[0]), '2026-10-06')
  assert.match(periodClosesAt(s[0]), /^2026-10-07T06:59:59\.999Z$/, 'Pacific end of day, PDT')
  assert.throws(() => buildSchedule({ startedOn: 'nope' }))
})

// ── The form ────────────────────────────────────────────────────────────────

test('validation: a draft is never refused; a submission needs a dated shift, the on-track answer, and (period 1) the unit', () => {
  assert.equal(validateReflection({}, { periodNumber: 2, requireComplete: false }).ok, true)
  const bad = validateReflection({}, { periodNumber: 1, requireComplete: true })
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.errors.map(e => e.field), ['about.unit', 'shifts', 'competencies_on_track'])
  const ok = validateReflection({
    about: { unit: ' 5 SCCT ', preceptor_names: 'Ana Lim', work_schedule: 'M/T/W', questions: '' },
    shifts: [
      { date: '2026-09-21', patients: '3', tsam_tier: '2', diagnoses: 'CHF', went_well: 'Handoff', improve: 'Time' },
      { date: '', patients: '', tsam_tier: '', diagnoses: '', went_well: '', improve: '' },
      { date: '2026-02-30', patients: 'x', diagnoses: 'bad date is dropped, shift kept' },
    ],
    goals: [{ text: 'Two patients solo', met: 'not_met', carry_forward: true }, { text: '' }, { text: 'IV starts', met: 'bogus' }],
    difficulty_areas: ['time_management', 'nope', 'time_management', 'critical_thinking'],
    competencies_on_track: false,
    unexpected: 'dropped',
  }, { periodNumber: 1 })
  assert.equal(ok.ok, true)
  assert.equal(ok.payload.about.unit, '5 SCCT')
  assert.equal(ok.payload.shifts.length, 2, 'the blank shift is dropped')
  assert.equal(ok.payload.shifts[0].patients, 3)
  assert.equal(ok.payload.shifts[1].date, null, 'an impossible date is null, not a crash')
  assert.deepEqual(ok.payload.goals.map(g => g.met), ['not_met', null])
  assert.deepEqual(ok.payload.difficulty_areas, ['time_management', 'critical_thinking'])
  assert.equal(ok.payload.competencies_on_track, false)
  assert.equal('unexpected' in ok.payload, false)
  // Period 2 and later carry no About section at all.
  assert.equal(validateReflection({ about: { unit: 'x' }, shifts: [{ date: '2026-10-06' }], competencies_on_track: true }, { periodNumber: 2 }).payload.about, null)
  assert.equal(DIFFICULTY_AREA_KEYS.length, 10, 'the ten areas on the cover page')
  assert.equal(MAX_SHIFTS, 6, 'six shift boxes across the two inner pages')
})

// ── Sending ─────────────────────────────────────────────────────────────────

// A tiny chainable fake: `script(state)` answers each query by table and op.
function fakeDb(script) {
  const calls = []
  const from = (table) => {
    const state = { table, op: null, args: [], payload: null }
    const chain = new Proxy({}, {
      get: (_, prop) => {
        if (prop === 'then') return (res, rej) => { calls.push(state); return Promise.resolve(script(state)).then(res, rej) }
        return (...a) => {
          if (['insert', 'update', 'delete'].includes(prop)) { state.op = prop; state.payload = a[0] }
          else if (prop === 'select') { state.op = state.op || 'select' }
          else state.args.push([prop, ...a])
          if (prop === 'maybeSingle') { calls.push(state); return Promise.resolve(script(state)) }
          return chain
        }
      },
    })
    return chain
  }
  return { from, calls }
}
const RUN = { id: 'run1', candidate_id: 'k1', cycle_id: 'cy1', student_id: 's1', status: 'active', period_count: 5 }
const PERIOD = { id: 'p1', run_id: 'run1', period_number: 1, opens_on: '2026-09-18', due_on: '2026-10-04', send_on: '2026-09-18', sent_at: null }
const STUDENT = { id: 's1', first_name: 'Maya', last_name: 'Lin', personal_email: 'maya@home.com' }
const HIRED = { hired_at: '2026-09-01T00:00:00Z', cs_email: 'Maya.Lin@cshs.org' }
const gen = () => ({ raw: 'R'.repeat(43), hash: 'HASH', hashPrefix: 'HASHPREF' })

test('sending: mint pending, send with a per-token key, activate on acceptance, mark sent; never the raw token in results', async () => {
  const db = fakeDb(s => {
    if (s.table === 'ngrp_reflection_tokens' && s.op === 'select') return { data: [], error: null }
    if (s.table === 'ngrp_reflection_tokens' && s.op === 'insert') return { data: { id: 'tok1' }, error: null }
    return { data: null, error: null }
  })
  const sends = []
  const out = await sendReflectionPeriod({
    db, run: RUN, period: PERIOD, student: STUDENT, outcome: HIRED, actorProfileId: 'staff1', generateToken: gen,
    sendEmail: async e => { sends.push(e); return { ok: true, providerId: 're_1' } },
    buildEmail: ({ url }) => ({ subject: 'S', html: `<a href="${url}">x</a>` }),
    baseUrl: 'https://aspireintelligence.app', nowIso: '2026-09-18T20:00:00Z',
  })
  assert.equal(out.outcome, 'sent')
  assert.equal(out.to, 'Maya.Lin@cshs.org', 'the residency address rule: Cedars-Sinai first')
  assert.equal(out.tokenHashPrefix, 'HASHPREF')
  assert.ok(!JSON.stringify(out).includes('R'.repeat(43)), 'the raw token never comes back')
  assert.equal(sends.length, 1)
  assert.equal(sends[0].idempotencyKey, 'ngrp-reflection/p1/tok1')
  assert.ok(sends[0].html.includes('/ngrp/reflection#t=' + 'R'.repeat(43)), 'the link carries the token in the fragment')
  const minted = db.calls.find(c => c.table === 'ngrp_reflection_tokens' && c.op === 'insert')
  assert.equal(minted.payload.status, 'pending')
  assert.equal(minted.payload.token_hash, 'HASH')
  const activated = db.calls.find(c => c.table === 'ngrp_reflection_tokens' && c.op === 'update')
  assert.equal(activated.payload.status, 'active')
  const marked = db.calls.find(c => c.table === 'ngrp_reflection_periods' && c.op === 'update')
  assert.deepEqual(marked.payload, { status: 'sent', sent_at: '2026-09-18T20:00:00Z' })
  assert.ok(db.calls.some(c => c.table === 'ngrp_audit_events' && c.payload?.event_type === 'reflection_sent'))
})

test('sending: an active token with an unsent period is REPAIRED, not resent; a rejection fails the token; a non-resident is refused', async () => {
  const repair = fakeDb(s => {
    if (s.table === 'ngrp_reflection_tokens' && s.op === 'select') {
      return { data: [{ id: 't0', status: 'active', token_hash_prefix: 'OLDPREFX', provider_email_id: 're_0', provider_accepted_at: '2026-09-18T19:00:00Z' }], error: null }
    }
    return { data: null, error: null }
  })
  let sent = 0
  const r = await sendReflectionPeriod({
    db: repair, run: RUN, period: PERIOD, student: STUDENT, outcome: HIRED, generateToken: gen,
    sendEmail: async () => { sent += 1; return { ok: true } }, buildEmail: () => ({ subject: '', html: '' }),
    baseUrl: 'x', nowIso: '2026-09-18T20:00:00Z',
  })
  assert.equal(r.outcome, 'repaired')
  assert.equal(sent, 0, 'the provider is not called again')
  assert.equal(repair.calls.find(c => c.table === 'ngrp_reflection_periods').payload.sent_at, '2026-09-18T19:00:00Z', 'sent_at is the acceptance moment')

  const reject = fakeDb(s => {
    if (s.table === 'ngrp_reflection_tokens' && s.op === 'select') return { data: [], error: null }
    if (s.table === 'ngrp_reflection_tokens' && s.op === 'insert') return { data: { id: 'tok2' }, error: null }
    return { data: null, error: null }
  })
  const f = await sendReflectionPeriod({
    db: reject, run: RUN, period: PERIOD, student: STUDENT, outcome: HIRED, generateToken: gen,
    sendEmail: async () => ({ ok: false, reason: 'provider_rejected' }), buildEmail: () => ({ subject: '', html: '' }),
    baseUrl: 'x', nowIso: '2026-09-18T20:00:00Z',
  })
  assert.equal(f.outcome, 'failed')
  assert.equal(f.reason, 'provider_rejected')
  const failed = reject.calls.find(c => c.table === 'ngrp_reflection_tokens' && c.op === 'update')
  assert.deepEqual(failed.payload, { status: 'failed', failed_reason: 'provider_rejected' })
  assert.ok(!reject.calls.some(c => c.table === 'ngrp_reflection_periods' && c.op === 'update'), 'the period stays unsent')

  assert.deepEqual(reflectionRecipient({ outcome: { ...HIRED, separated_at: '2026-10-01T00:00:00Z' }, student: STUDENT }), { email: null, reason: 'not_a_resident' })
  assert.deepEqual(reflectionRecipient({ outcome: null, student: STUDENT }), { email: null, reason: 'not_a_resident' })
  assert.equal((await sendReflectionPeriod({ db: reject, run: RUN, period: { ...PERIOD, sent_at: 'x' }, student: STUDENT, outcome: HIRED })).reason, 'already_sent')
})

test('resolution: only an ACTIVE token resolves; a period is closed after the grace days; a stopped run is unknown', async () => {
  const mk = (tokenStatus, runStatus = 'active') => fakeDb(s => {
    if (s.table === 'ngrp_reflection_tokens') return { data: { id: 't1', status: tokenStatus, revoked_at: null, period_id: 'p1' }, error: null }
    if (s.table === 'ngrp_reflection_periods') return { data: { ...PERIOD, draft: null }, error: null }
    if (s.table === 'ngrp_reflection_runs') return { data: { ...RUN, status: runStatus }, error: null }
    return { data: null, error: null }
  })
  assert.equal((await resolveReflectionToken(mk('pending'), 'HASH', '2026-09-20T00:00:00Z')).state, 'unknown')
  assert.equal((await resolveReflectionToken(mk('failed'), 'HASH', '2026-09-20T00:00:00Z')).state, 'unknown')
  assert.equal((await resolveReflectionToken(mk('active', 'stopped'), 'HASH', '2026-09-20T00:00:00Z')).state, 'unknown')
  const open = await resolveReflectionToken(mk('active'), 'HASH', '2026-10-06T12:00:00Z')
  assert.equal(open.state, 'ok')
  assert.equal(open.closed, false, 'still open on the last grace day')
  const late = await resolveReflectionToken(mk('active'), 'HASH', '2026-10-07T08:00:00Z')
  assert.equal(late.closed, true, 'closed after Pacific end of day on due + 2')
})

test('the cron picks periods whose send day has come and whose due day has not, on active runs, never period 1', () => {
  const runs = new Map([['a', { status: 'active' }], ['z', { status: 'stopped' }]])
  const periods = [
    { run_id: 'a', period_number: 2, send_on: '2026-10-02', due_on: '2026-10-18', sent_at: null },
    { run_id: 'a', period_number: 3, send_on: '2026-10-16', due_on: '2026-11-01', sent_at: null },
    { run_id: 'a', period_number: 1, send_on: '2026-09-18', due_on: '2026-10-04', sent_at: null },
    { run_id: 'a', period_number: 2, send_on: '2026-09-25', due_on: '2026-10-11', sent_at: 'x' },
    { run_id: 'z', period_number: 2, send_on: '2026-10-02', due_on: '2026-10-18', sent_at: null },
    { run_id: 'a', period_number: 2, send_on: '2026-09-11', due_on: '2026-09-27', sent_at: null },
  ]
  const due = periodsToSend(periods, runs, '2026-10-02')
  assert.deepEqual(due.map(p => [p.run_id, p.period_number, p.send_on]), [['a', 2, '2026-10-02']])
  // A missed Friday is caught the next week, as long as the period is not past due.
  assert.equal(periodsToSend(periods, runs, '2026-10-09').length, 1)
  const cron = read('api/cron/resident-reflections.js')
  assert.match(cron, /weekday === 'Fri' && pacificHour\(now\) >= SEND_AFTER_PACIFIC_HOUR/)
  assert.match(cron, /export const SEND_AFTER_PACIFIC_HOUR = 19/)
  assert.match(cron, /isAuthorizedCronRequest\(req\)/)
  assert.match(cron, /isAutomationEnabled\(\{ supabaseAdmin: supabase, automationKey: AUTOMATION_KEY \}\)/)
  assert.match(cron, /actorProfileId: null/)
  const vercel = JSON.parse(read('vercel.json'))
  const entry = vercel.crons.find(c => c.path === '/api/cron/resident-reflections')
  assert.deepEqual(entry, { path: '/api/cron/resident-reflections', schedule: '0 2,3,4 * * 6' }, 'three Saturday-UTC slots = Friday evening Pacific')
  assert.equal(vercel.functions['api/cron/resident-reflections.js'].maxDuration, 60)
})

// ── Email, page, endpoint ───────────────────────────────────────────────────

test('the email names the period, the due Sunday, and the close; carries the link once; no em dash', () => {
  const { subject, html } = buildReflectionEmail({
    student: { first_name: 'Maya' }, run: { period_count: 5 },
    period: { period_number: 2, opens_on: '2026-10-05', due_on: '2026-10-18' }, url: 'https://x/ngrp/reflection#t=abc',
  })
  assert.equal(subject, 'Your NGRP reflection: period 2 of 5, due October 18')
  assert.ok(html.includes('Hi Maya,'))
  assert.ok(html.includes('opens on <strong>Monday, October 5</strong>'))
  assert.ok(html.includes('submit it by <strong>Sunday, October 18</strong>'))
  assert.ok(html.includes('stays open until Tuesday, October 20'))
  assert.equal(html.split('#t=abc').length - 1, 1, 'the link appears exactly once')
  assert.ok(html.includes('aspire@cshs.org'))
  assert.doesNotMatch(subject + html, /—/)
  const first = buildReflectionEmail({ student: {}, run: { period_count: 5 }, period: { period_number: 1, opens_on: '2026-09-18', due_on: '2026-10-04' }, url: 'u' })
  assert.ok(first.html.includes('Hi there,'))
  assert.ok(first.html.includes('your preceptor'), 'period 1 explains the About you section')
})

test('the public endpoint: shape gate before db, fail-closed rate limit, one submission per period, no identifier from the client', () => {
  const api = read('api/ngrp-reflection.js')
  assert.match(api, /isWellFormedRawToken\(token\)\) \{\s*\n\s*return res\.status\(400\)/)
  assert.ok(api.indexOf('isWellFormedRawToken') < api.indexOf('consume_evaluation_rate_limit'), 'shape gate first')
  assert.ok(api.indexOf('consume_evaluation_rate_limit') < api.indexOf('resolveReflectionToken('), 'then the rate limit, then the db')
  assert.match(api, /if \(rlError \|\| allowed !== true\) return res\.status\(429\)/)
  assert.match(api, /if \(ins\.error\.code === '23505'\) return res\.status\(409\)/)
  assert.doesNotMatch(api, /body\.(period_id|candidate_id|student_id|run_id)/, 'the period comes from the token, never the body')
  assert.match(api, /actorKind: 'alumnus'/)
  // The route and the page.
  assert.match(read('src/App.jsx'), /<Route path="\/ngrp\/reflection\/\*" element=\{<div data-theme-lock="light"><NgrpReflectionPage \/><\/div>\} \/>/)
  const page = read('src/pages/NgrpReflectionPage.jsx')
  assert.match(page, /fetch\('\/api\/ngrp-reflection'/)
  assert.match(page, /window\.history\.replaceState\(null, '', window\.location\.pathname\)/, 'the token leaves the address bar')
  for (const s of ['About you', 'Your shifts', 'Skills this period', 'Goals for this two-week period', 'Professional and personal development', 'Where are you finding it hard?', 'Kahuna on track']) {
    assert.ok(page.includes(s), s)
  }
  assert.ok(!page.includes('mergency contact'), 'the emergency-contact line is deliberately not collected')
})

// ── Support: Start, the view, and the retired check-in ─────────────────────

test('Support > During residency: Start sends period 1 after a confirm; View opens the periods; the check-in is gone', () => {
  const tab = read('src/components/ngrp/SupportTab.jsx')
  assert.match(tab, /postNgrpSupport\('reflection_start', \{ candidate_id: r\.row\.candidate_id \}\)/)
  assert.match(tab, /Send period 1 now\?/)
  assert.match(tab, />\s*Start Reflections\s*</)
  assert.match(tab, /postNgrpSupport\('reflection_view', \{ period_id: period\.id \}\)/)
  assert.match(tab, /postNgrpSupport\('reflection_stop', \{ candidate_id: resident\.row\.candidate_id \}\)/)
  assert.match(tab, /<th className="aspire-th">Reflections<\/th>/)
  assert.doesNotMatch(tab, /Send Check-in|RESIDENT_CHECKIN|WEEKLY_CHECKIN|Last Check-in|writeLaunchContext/)
  const api = read('api/ngrp-support.js')
  assert.match(api, /const TEAM_ONLY = new Set\(\[\.\.\.WRITES, 'reflection_view'\]\)/)
  assert.match(api, /if \(TEAM_ONLY\.has\(action\) && isTA\) return res\.status\(403\)/)
  assert.match(api, /if \(!isHired\(outcome\.data\)\) return res\.status\(422\)\.json\(\{ error: 'not_a_resident' \}\)/)
  assert.match(api, /if \(periods\[0\]\?\.sent_at\) return res\.status\(409\)\.json\(\{ error: 'already_started' \}\)/, 'a failed first send is retried, a sent one is not duplicated')
  assert.doesNotMatch(api, /fetchResidentCheckins|checkins/)
  // The view math.
  const d = duringResidency([{ id: 'x', candidate_id: 'k1', student: { id: 's1' }, outcome: HIRED }], {
    today: '2026-10-20',
    reflections: { runs: [RUN], periods: [
      { run_id: 'run1', period_number: 1, due_on: '2026-10-04', sent_at: 'x', status: 'submitted' },
      { run_id: 'run1', period_number: 2, due_on: '2026-10-18', sent_at: 'x', status: 'opened' },
    ] },
  })
  assert.deepEqual(d.kpis, { residents: 1, withMentor: 0, reflecting: 1, submitted: 1, overdue: 1, sessions: 0 })
  assert.equal(summarizeReflections(null, [], '2026-10-20').started, false)
})

test('the weekly check-in is retired everywhere, not just hidden', () => {
  assert.equal(existsSync(join(here, '..', 'lib/server/ngrpSupportCheckins.js')), false)
  assert.equal(existsSync(join(here, '..', 'test/residencyCheckin.test.mjs')), false)
  for (const f of [
    'src/lib/connect/launchContext.js', 'src/lib/connect/templateRegistry.js', 'src/lib/outreachTemplates.js',
    'src/components/connect/OutreachView.jsx', 'api/connect-send-direct-email.js', 'src/lib/ngrp/ngrpSupportActivities.js',
  ]) {
    assert.doesNotMatch(read(f), /RESIDENT_CHECKIN|resident_weekly_checkin|buildResidentWeeklyCheckinDraft|WEEKLY_CHECKIN/, f)
  }
  assert.match(read('api/connect-send-direct-email.js'), /const TEMPLATE_KEYS = new Set\(\[\]\)/, 'the allowlist mechanism stays, empty')
})

// ── Migration and audit ─────────────────────────────────────────────────────

test('the migration: four server-only tables, an immutable submission, and the audit CHECK widened', () => {
  const sql = code(read('supabase/migrations/20260917000000_ngrp_reflections.sql'))
  assert.match(sql, /^BEGIN;$/m)
  assert.match(sql, /^COMMIT;$/m)
  for (const t of ['ngrp_reflection_runs', 'ngrp_reflection_periods', 'ngrp_reflection_tokens', 'ngrp_reflection_submissions']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`), t)
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`), t)
    assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON TABLE public\\.${t}\\s+FROM PUBLIC, anon, authenticated, service_role;`), t)
  }
  assert.match(sql, /GRANT SELECT, INSERT\s+ON TABLE public\.ngrp_reflection_submissions TO service_role;/, 'no UPDATE, no DELETE on the answer')
  assert.doesNotMatch(sql, /GRANT[^;]*DELETE|GRANT[^;]*TO (anon|authenticated)/)
  assert.match(sql, /candidate_id\s+uuid\s+NOT NULL UNIQUE REFERENCES public\.ngrp_candidates\(id\)/, 'one run per resident')
  assert.match(sql, /CONSTRAINT uq_ngrp_reflection_period UNIQUE \(run_id, period_number\)/)
  assert.match(sql, /period_id\s+uuid\s+NOT NULL UNIQUE REFERENCES public\.ngrp_reflection_periods\(id\) ON DELETE RESTRICT/, 'one answer per period')
  assert.match(sql, /token_hash\s+text\s+NOT NULL UNIQUE/)
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE public/, 'additive; the rollback lives in comments only')
  // Audit: every earlier value survives, five are new, and JS agrees.
  const audit = sql.slice(sql.indexOf('ngrp_audit_events_event_type_check'))
  for (const ev of ['hire_recorded', 'not_selected', 'unit_preferences_set', 'reflection_started', 'reflection_sent', 'reflection_opened', 'reflection_submitted', 'reflection_stopped']) {
    assert.ok(audit.includes(`'${ev}'`), ev)
    assert.ok(NGRP_AUDIT_EVENTS.includes(ev), `${ev} in JS`)
  }
})

test('no em dash in anything this change added', () => {
  for (const f of [
    'src/lib/ngrp/ngrpReflectionForm.js', 'lib/server/ngrpReflection.js', 'lib/server/email/ngrpReflectionEmail.js',
    'api/ngrp-reflection.js', 'api/cron/resident-reflections.js', 'src/pages/NgrpReflectionPage.jsx',
    'supabase/migrations/20260917000000_ngrp_reflections.sql', 'db/audit/ngrp_reflections_checks.sql',
  ]) {
    assert.doesNotMatch(read(f), /—/, f)
  }
})
