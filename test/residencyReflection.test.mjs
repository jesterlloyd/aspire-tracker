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
  TSAM_TIERS, HELP, PLACEHOLDERS, SCHEDULE_SHIFTS, RESIDENT_SHIFTS, periodWindow, marksInWindow, seedShiftCards, EMPTY_SHIFT,
} from '../src/lib/ngrp/ngrpReflectionForm.js'
import {
  sendReflectionPeriod, resolveReflectionToken, periodsToSend, periodClosesAt, reflectionRecipient,
  addScheduleDay, removeScheduleDay, loadSchedule, residentShift, isRealDay, SCHEDULE,
} from '../lib/server/ngrpReflection.js'
import { validateOutcomePayload } from '../lib/server/ngrpPlanning.js'
import { shiftColor, SHIFT_COLORS } from '../src/lib/ngrp/ngrpActivity.js'
import { shiftBadge } from '../src/lib/shiftStatus.js'
import { CANONICAL_SHIFTS } from '../src/lib/preceptorProjection.js'
import { buildReflectionEmail } from '../lib/server/email/ngrpReflectionEmail.js'
import { NGRP_AUDIT_EVENTS } from '../lib/server/ngrpAudit.js'
import { duringResidency } from '../src/lib/ngrp/ngrpSupportView.js'
import { AUTOMATION_CATALOG } from '../src/lib/automationCatalog.js'
import { getPreviewFixture } from '../src/lib/notifications/previewFixtures.js'
import { NGRP_REFLECTION_PREVIEW } from '../src/lib/ngrp/reflectionPreviewFixture.js'

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

test('validation: a draft is never refused; a submission needs the on-track answer and (period 1) the unit, never a shift', () => {
  assert.equal(validateReflection({}, { periodNumber: 2, requireComplete: false }).ok, true)
  const bad = validateReflection({}, { periodNumber: 1, requireComplete: true })
  assert.equal(bad.ok, false)
  // RESIDENCY-REFLECTION-2 (Owner, 2026-09-14): seeded shift cards must never
  // hold up a submission, so no shift is required at all.
  assert.deepEqual(bad.errors.map(e => e.field), ['about.unit', 'competencies_on_track'])
  assert.equal(validateReflection({ competencies_on_track: true }, { periodNumber: 2 }).ok, true, 'period 2 with no shift at all submits')
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
  assert.equal(ok.payload.shifts[0].tsam_tier, 2, 'the tier is a number 1..5')
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
  // Owner, 2026-09-14: the NGRP mailbox, in the body line and the footer both.
  assert.equal(html.split('ngrp@cshs.org').length - 1, 3, 'mailto href, link text, and the footer note')
  assert.ok(!html.includes('aspire@cshs.org'), 'not the ASPIRE mailbox')
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
  for (const s of ['About you', 'Your schedule', 'Your shifts', 'Skills this period', 'Goals for this two-week period', 'Professional and personal development', 'Where are you finding it hard?', 'Orientation competencies on track?']) {
    assert.ok(page.includes(s), s)
  }
  assert.ok(!page.includes('Kahuna'), 'Kahuna is not used (Owner, 2026-09-14)')
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

// ── The Automations card and the email preview (Owner, 2026-09-14) ─────────

test('the cron is an Automations card: registered in the view, the server, and the monitor, on the same key', () => {
  const view = read('src/components/connect/AutomationView.jsx')
  const server = read('api/automation-settings.js')
  const cron = read('api/cron/resident-reflections.js')
  assert.match(view, /\{ id: 'resident_reflections', title: 'Resident Reflections',\s*\n\s*cron_name: 'resident-reflections', automation_key: 'resident_reflections',/)
  assert.match(view, /hasGlobalSetting: true,\s*\n\s*desc: 'Sends each resident their next bi-weekly/)
  assert.match(server, /\{ key: 'resident_reflections', label: 'Resident Reflections',[\s\S]{0,400}defaultEnabled: true \}/,
    'default On, matching the cron helper which is default-on')
  assert.match(cron, /export const AUTOMATION_KEY = 'resident_reflections'/)
  assert.match(cron, /export const CRON_NAME = 'resident-reflections'/)
  assert.ok(AUTOMATION_CATALOG.some(a => a.id === 'resident_reflections' && a.cronName === 'resident-reflections' && a.automationKey === 'resident_reflections'))
  assert.equal(AUTOMATION_CATALOG.find(a => a.id === 'resident_reflections').maxAgeHours, 192, 'the cron runs weekly, so a week plus slack')
})

test('the preview is the real email, rendered once for both the card and the Support tab', () => {
  const fx = getPreviewFixture('resident_reflections')
  assert.ok(fx, 'the card has a preview, so its eye means something')
  assert.equal(fx, NGRP_REFLECTION_PREVIEW, 'the SAME object the Support tab renders')
  assert.deepEqual(fx.variants.map(v => v.key), ['first', 'later'])
  const first = fx.render('first')
  const later = fx.render('later')
  // Byte-identical to a real send with the same inputs.
  const schedule = buildSchedule({ startedOn: '2026-09-18' })
  const real = buildReflectionEmail({ student: { first_name: 'Jordan', preferred_first_name: 'Jordan' }, run: { period_count: 5 }, period: schedule[1], url: 'https://aspireintelligence.app/ngrp/reflection/#sample-preview-not-a-real-link' })
  assert.equal(later.subject, real.subject)
  assert.equal(later.html, real.html)
  assert.ok(first.subject.includes('period 1 of 5'))
  assert.ok(later.subject.includes('period 2 of 5'))
  assert.ok(first.html.includes('your preceptor'), 'period 1 explains the About you section')
  // Nothing real, and above all no token shape.
  for (const out of [first, later]) {
    assert.ok(out.html.includes('#sample-preview-not-a-real-link'))
    assert.doesNotMatch(out.html, /#t=[A-Za-z0-9_-]{43}/, 'never a real token')
    assert.doesNotMatch(out.html, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no uuid')
  }
  const fixture = read('src/lib/ngrp/reflectionPreviewFixture.js')
  assert.doesNotMatch(fixture, /sendNotification|new Resend|resend\.emails|generateToken/, 'a fixture renders only')
})

test('Support > During residency has the eye, the same drawer, and the same fixture as Profiles & Interest', () => {
  const tab = read('src/components/ngrp/SupportTab.jsx')
  const profiles = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /import AutomationEmailPreviewDrawer from '\.\.\/connect\/AutomationEmailPreviewDrawer'/)
  assert.match(profiles, /import AutomationEmailPreviewDrawer from '\.\.\/connect\/AutomationEmailPreviewDrawer'/, 'the Transition Form preview uses the same drawer')
  assert.match(tab, /aria-label="Preview the reflection email"/)
  assert.match(tab, /<Eye size=\{15\} \/>/)
  assert.match(tab, /<AutomationEmailPreviewDrawer\s+title="NGRP Bi-Weekly Reflection"\s+entry=\{NGRP_REFLECTION_PREVIEW\}/)
  assert.match(tab, /footNote="The resident, the dates and the link are synthetic\./)
})

test('no em dash in anything this change added', () => {
  for (const f of [
    'src/lib/ngrp/ngrpReflectionForm.js', 'lib/server/ngrpReflection.js', 'lib/server/email/ngrpReflectionEmail.js',
    'api/ngrp-reflection.js', 'api/cron/resident-reflections.js', 'src/pages/NgrpReflectionPage.jsx',
    'supabase/migrations/20260917000000_ngrp_reflections.sql', 'db/audit/ngrp_reflections_checks.sql',
    'src/lib/ngrp/reflectionPreviewFixture.js',
    'supabase/migrations/20260918000000_ngrp_resident_schedule.sql', 'db/audit/ngrp_resident_schedule_checks.sql',
    'src/lib/ngrp/ngrpActivity.js',
  ]) {
    assert.doesNotMatch(read(f), /—/, f)
  }
})

// ── RESIDENCY-REFLECTION-2 (Owner, 2026-09-14) ──────────────────────────────
// The refined questionnaire and the resident's schedule.

test('the refined questionnaire: sample answers in every text field, four (i) terms, the TSAM ladder, Met/Not met aligned', () => {
  // Every placeholder is a greyed example, never an instruction.
  for (const [k, v] of Object.entries(PLACEHOLDERS)) assert.match(v, /^For example: /, k)
  assert.deepEqual(Object.keys(HELP), ['tsam', 'ana', 'caritas', 'cslink'], 'the four unfamiliar terms')
  assert.equal(HELP.tsam.tiers, TSAM_TIERS)
  assert.equal(TSAM_TIERS.length, 5)
  assert.deepEqual(TSAM_TIERS.map(t => t.tier), [1, 2, 3, 4, 5])
  assert.match(HELP.tsam.body, /Tiered Skills Acquisition Model/)
  assert.match(HELP.tsam.body, /structured, competence-based framework/, "the Owner's own words")
  assert.deepEqual(TSAM_TIERS[0].orientee, ['Shadow', 'Observation'])
  assert.deepEqual(TSAM_TIERS[4].orientee, ['Delegation, teamwork, and communication', 'Admissions, discharges, and transfers'])
  for (const t of TSAM_TIERS) assert.ok(t.orientee.length && t.preceptor.length, `tier ${t.tier} has both columns`)
  assert.match(HELP.cslink.body, /electronic health record/)
  assert.match(HELP.caritas.body, /Jean Watson/)
  // The tier is a number; anything else is null.
  for (const [input, want] of [['2', 2], [3, 3], ['0', null], ['6', null], ['', null], ['two', null], [null, null]]) {
    assert.equal(validateReflection({ shifts: [{ date: '2026-09-21', tsam_tier: input }] }, { periodNumber: 2, requireComplete: false }).payload.shifts[0]?.tsam_tier ?? null, want, String(input))
  }
  const page = read('src/pages/NgrpReflectionPage.jsx')
  for (const k of Object.keys(PLACEHOLDERS)) assert.ok(page.includes(`PLACEHOLDERS.${k}`), `the page uses PLACEHOLDERS.${k}`)
  for (const k of ['tsam', 'ana', 'caritas', 'cslink']) assert.ok(page.includes(`help('${k}'`) || page.includes(`helpKey: '${k}'`), `the (i) for ${k}`)
  assert.match(page, /<option value="">Choose a tier<\/option>/)
  assert.match(page, /TSAM_TIERS\.map\(t => <option key=\{t\.tier\} value=\{t\.tier\}>Tier \{t\.tier\}: \{t\.orientee\.join\(', '\)\}<\/option>\)/)
  assert.match(page, /\.ngrpr-help\[aria-expanded="true"\]/, 'the (i) shows which one is open')
  assert.match(page, /className="ngrpr-help" aria-label=\{`What is \$\{HELP\[key\]\.title\}\?`\}/)
  // Met | Not met sits under its own label so its row lines up with the goal input.
  assert.match(page, /<label id=\{`go\$\{i\}`\}>Outcome<\/label>/)
  assert.match(page, /\.ngrpr-goal \.ngrpr-opt \{ min-height: 40px;/)
  assert.match(page, /\.ngrpr-field select \{[\s\S]*?min-height: 40px;/)
  // Phones first (Owner, 2026-09-14): measured at 375px, no sideways scroll and
  // no tap target under 40px. The hint drops to its own line without its dot,
  // the pills and the day-menu buttons fill the row, the ladder stacks per tier.
  const phone = page.slice(page.indexOf('@media (max-width: 620px)'))
  assert.match(phone, /\.ngrpr-field label \.lh::before \{ content: none; \}/)
  assert.match(phone, /\.ngrpr-goal \.ngrpr-opts \{ display: grid; grid-template-columns: 1fr 1fr; \}/)
  assert.match(phone, /\.ngrpr-daymenu \.ngrpr-btn \{ flex: 1 1 0; min-height: 44px; \}/)
  assert.match(page, /\.ngrpr-cal-nav button \{ min-width: 44px; min-height: 40px;/)
  assert.match(page, /\.ngrpr-link \{[^}]*min-height: 40px;/)
  assert.match(page, /<div className="tier" key=\{t\.tier\}>/, 'the TSAM ladder is one block per tier, readable at any width')
  assert.match(page, /<label htmlFor=\{id\}><span className="lt">\{label\}\{helpKey && <> \{help\(helpKey\)\}<\/>\}<\/span>\{hint && <span className="lh">\{hint\}<\/span>\}<\/label>/, 'the (i) travels with the label text')
  // The renamed line and the retired textarea.
  assert.ok(page.includes('Orientation competencies on track? <span className="req">*</span>'))
  assert.ok(!page.includes('Current work schedule'), 'the calendar replaced the free-text schedule')
  assert.ok(!page.includes("'work_schedule'"), 'the page no longer writes work_schedule')
  // Helpers stay plain functions (a component inside render loses focus on each keystroke).
  assert.match(page, /const text = \(\{ id, label, value, onChange, rows, hint, placeholder, helpKey \}\) =>/)
  assert.match(page, /const help = \(key, inst\) =>/)
  assert.doesNotMatch(page, /function (Text|Help|Calendar)\(/)
})

test("the resident's schedule: one calendar, any date, Add/Dismiss then Delete/Cancel, marks coloured by the hired shift", () => {
  assert.deepEqual([...RESIDENT_SHIFTS], [...CANONICAL_SHIFTS], "Rotation's own vocabulary")
  assert.deepEqual([...SCHEDULE_SHIFTS], ['Day', 'Night', 'Mid'], 'a Variable resident names one of these per day')
  // Colours and glyphs: one source, the app's own badge.
  assert.equal(shiftColor('Day'), SHIFT_COLORS.Day)
  assert.equal(shiftColor(null), SHIFT_COLORS.unspecified)
  assert.equal(shiftColor('bogus'), SHIFT_COLORS.unspecified)
  assert.notEqual(SHIFT_COLORS.Day, SHIFT_COLORS.Night)
  assert.equal(shiftBadge('Day').label.split(' ')[0], '☀')
  assert.equal(shiftBadge('Night').label.split(' ')[0], '☾')
  assert.equal(shiftBadge('Mid').label.split(' ')[0], '◐')
  // The window and the seeding.
  const period = { opens_on: '2026-09-18', due_on: '2026-10-04' }
  assert.deepEqual(periodWindow(period), { from: '2026-09-18', to: '2026-10-04' })
  const marks = [{ on_date: '2026-09-17' }, { on_date: '2026-09-18' }, { on_date: '2026-09-22', shift: 'Night' }, { on_date: '2026-10-04' }, { on_date: '2026-10-05' }]
  assert.deepEqual(marksInWindow(marks, periodWindow(period)).map(m => m.on_date), ['2026-09-18', '2026-09-22', '2026-10-04'], 'inclusive on both ends')
  const seeded = seedShiftCards([{ ...EMPTY_SHIFT }], marks, periodWindow(period))
  assert.deepEqual(seeded.map(s => s.date), ['2026-09-18', '2026-09-22', '2026-10-04'], 'one card per marked day in the window, the blank starter dropped')
  assert.deepEqual(seeded[0], { ...EMPTY_SHIFT, date: '2026-09-18' }, 'a seeded card is empty apart from its date')
  // Seeding is idempotent and keeps what the resident already wrote.
  const written = [{ ...EMPTY_SHIFT, date: '2026-09-22', went_well: 'Handoff' }, { ...EMPTY_SHIFT, diagnoses: 'undated but written' }]
  const again = seedShiftCards(written, marks, periodWindow(period))
  assert.deepEqual(again.map(s => s.date), ['2026-09-18', '2026-09-22', '2026-10-04', ''])
  assert.equal(again[1].went_well, 'Handoff')
  assert.equal(again[3].diagnoses, 'undated but written', 'an undated card with words survives')
  assert.deepEqual(seedShiftCards(again, marks, periodWindow(period)), again, 'idempotent')
  // Never past the six cards.
  const many = Array.from({ length: 9 }, (_, i) => ({ on_date: addDays('2026-09-18', i) }))
  assert.equal(seedShiftCards([], many, periodWindow(period)).length, MAX_SHIFTS)
  assert.deepEqual(seedShiftCards([], [], periodWindow(period)), [{ ...EMPTY_SHIFT }], 'no marks: the one blank card')
  // A seeded card never blocks submission: dates alone, nothing else, submits.
  const sub = validateReflection({ shifts: seeded, competencies_on_track: true }, { periodNumber: 2 })
  assert.equal(sub.ok, true)
  assert.equal(sub.payload.shifts.length, 3, 'dated-only cards are kept as the record of days worked')
  // The page: every period, the Plan Shift interaction, no portal CSS.
  const page = read('src/pages/NgrpReflectionPage.jsx')
  assert.match(page, /\{calendar\}\s*\n\s*<section className="ngrpr-sec">\s*\n\s*<h2>Your shifts<\/h2>/, 'the schedule sits above the shifts in every period')
  assert.ok(page.indexOf('{calendar}') > page.indexOf('{n === 1 && ('), 'after About you, which only period 1 shows')
  assert.match(page, /import \{ monthGrid, monthLabel, pacificToday \} from '\.\.\/lib\/rotationCalendarDates\.js'/, 'the Plan Shift calendar date math')
  assert.doesNotMatch(page, /ptl-|CanonicalMonthCell/, 'portal CSS is not loaded on public pages; the calendar is self-contained')
  for (const s of ['>Add<', '>Dismiss<', '>Delete<', '>Cancel<']) assert.ok(page.includes(s), s)
  assert.match(page, /post\('schedule_add', \{ date: ymd, shift: shift \|\| undefined \}\)/)
  assert.match(page, /post\('schedule_remove', \{ date: ymd \}\)/)
  assert.match(page, /residentShift === 'Variable' && \(/, 'a Variable resident picks the shift per day')
  assert.match(page, /disabled=\{calBusy \|\| \(residentShift === 'Variable' && !dayPick\.shift\)\}/, 'Add waits for that pick')
  assert.match(page, /tag: shift \? shiftBadge\(shift\)\.label\.split\(' '\)\[0\] : 'ON'/, "plain ON until the shift is on file")
  assert.match(page, /if \(body\.state === 'form'\) merged\.shifts = seedShiftCards\(merged\.shifts, marks, periodWindow\(/, 'seeded on load')
  assert.match(page, /const next = \{ \.\.\.p, shifts: seedShiftCards\(p\.shifts, marks, window_\) \}/, 'and after each Add')
  assert.match(page, /aria-label="Previous month"/)
  assert.match(page, /aria-label="Next month"/)
})

test('the schedule endpoint: token-gated, rate-limited, not closed by the period, shift only for Variable, idempotent add', async () => {
  const api = read('api/ngrp-reflection.js')
  assert.match(api, /const ACTIONS = new Set\(\['load', 'save_draft', 'submit', 'schedule_add', 'schedule_remove'\]\)/)
  assert.match(api, /schedule_add:\s+\{ window: 60, max: 40 \}/)
  assert.match(api, /schedule_remove:\s+\{ window: 60, max: 40 \}/)
  assert.ok(api.indexOf("if (action === 'schedule_add' || action === 'schedule_remove')") < api.indexOf("if (action === 'load')"), 'the schedule branch sits before the closed-period gates')
  assert.doesNotMatch(api, /schedule_add[^]*?resolved\.closed[^]*?WINDOW_CLOSED[^]*?if \(action === 'load'\)/, 'never refused for a closed period')
  assert.match(api, /residentShift: shiftType,\s*\n\s*schedule: schedule\.error \? null : schedule\.rows,/, 'load returns the marks and the hired shift')
  assert.match(api, /\.select\('hired_unit, shift'\)/)
  assert.match(api, /\.select\('hired_unit'\)/, 'and still loads before the migration')
  // The helpers.
  assert.equal(SCHEDULE, 'ngrp_resident_schedule_days')
  assert.equal(residentShift({ shift: 'Night' }), 'Night')
  assert.equal(residentShift({ shift: 'bogus' }), null)
  assert.equal(residentShift(null), null)
  assert.equal(isRealDay('2026-02-30'), false)
  assert.equal(isRealDay('2026-09-22'), true)
  assert.equal(isRealDay('2026-9-2'), false)
  const inserts = []
  const db = fakeDb(s => {
    if (s.table === SCHEDULE && s.op === 'insert') { inserts.push(s.payload); return { error: inserts.length > 1 ? { code: '23505' } : null } }
    if (s.table === SCHEDULE && s.op === 'delete') return { error: null }
    if (s.table === SCHEDULE) return { data: [{ on_date: '2026-09-22', shift: null }] }
    return { data: null, error: null }
  })
  assert.deepEqual(await addScheduleDay(db, { run: RUN, onDate: 'nope' }), { ok: false, reason: 'invalid_date' })
  assert.deepEqual(await addScheduleDay(db, { run: RUN, onDate: '2026-09-22', shift: 'Night', residentShiftType: 'Day' }), { ok: true, mark: { on_date: '2026-09-22', shift: null } }, 'a Day resident\'s mark carries no shift of its own, whatever the body says')
  assert.deepEqual(inserts[0], { candidate_id: 'k1', student_id: 's1', on_date: '2026-09-22', shift: null }, 'ids come from the run, never the body')
  assert.deepEqual(await addScheduleDay(db, { run: RUN, onDate: '2026-09-22', residentShiftType: 'Day' }), { ok: true, idempotent: true }, 'marking a marked day is fine')
  assert.deepEqual(await addScheduleDay(db, { run: RUN, onDate: '2026-09-23', residentShiftType: 'Variable' }), { ok: false, reason: 'shift_required' })
  assert.deepEqual(await addScheduleDay(db, { run: RUN, onDate: '2026-09-23', shift: 'Weekend', residentShiftType: 'Variable' }), { ok: false, reason: 'shift_required' })
  assert.deepEqual(await removeScheduleDay(db, { run: RUN, onDate: '2026-09-22' }), { ok: true })
  assert.deepEqual(await removeScheduleDay(db, { run: RUN, onDate: '22/09/2026' }), { ok: false, reason: 'invalid_date' })
  assert.deepEqual(await loadSchedule(db, 'k1'), { rows: [{ on_date: '2026-09-22', shift: null }] })
  // The hire record.
  assert.equal(validateOutcomePayload({ shift: 'Variable' }).outcome.shift, 'Variable')
  assert.equal(validateOutcomePayload({ shift: ' Night ' }).outcome.shift, 'Night')
  const badShift = validateOutcomePayload({ shift: 'Weekend' })
  assert.equal(badShift.ok, false)
  assert.ok(badShift.errors.some(e => e.field === 'shift'), 'an unknown shift is refused')
  assert.equal(validateOutcomePayload({ shift: '' }).outcome.shift, null, 'empty means not recorded yet')
  assert.equal(validateOutcomePayload({}).outcome.shift, null)
  const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(drawer, /RESIDENT_SHIFTS\.map\(s => <option key=\{s\} value=\{s\}>\{shiftBadge\(s\)\.label\}<\/option>\)/, 'the drawer offers the four shifts with the app\'s glyphs')
  assert.match(drawer, /shift: form\.shift \|\| null,/)
  assert.match(drawer, /\{o\.shift && <Row label="Shift">\{shiftBadge\(o\.shift\)\.label\}<\/Row>\}/)
  assert.match(read('lib/server/ngrpApplicants.js'), /cs_email, not_selected_at, offer_declined_at, shift`\)/, 'readOutcomes reads the shift with a fallback')
})

test('Residency > Activity shows the marks: a read action for both audiences, first-name chips in the shift colour', () => {
  const api = read('api/ngrp-support.js')
  assert.match(api, /'reflection_view', 'schedule'\]\)/, 'schedule is an action')
  assert.doesNotMatch(api, /TEAM_ONLY = new Set\(\[[^\]]*'schedule'/, 'a schedule names no answer: both audiences read it')
  assert.match(api, /if \(action === 'schedule'\) \{/)
  assert.match(api, /\.gte\('on_date', from\)\.lte\('on_date', to\)/)
  assert.match(api, /if \(!cycleId \|\| !from \|\| !to \|\| from > to\) return res\.status\(422\)/)
  assert.match(api, /provisioned: false, marks: \[\], shifts: \{\}/, 'before the migration the calendar is simply empty')
  const cal = read('src/components/ngrp/ActivityCalendar.jsx')
  assert.match(cal, /postNgrpSupport\('schedule', \{ cycle_id: cycle\.id, from, to \}\)/)
  assert.match(cal, /shift: m\.shift \|\| schedule\?\.shifts\?\.\[m\.candidate_id\] \|\| null/, 'a per-day shift wins, else the hire record')
  assert.match(cal, /marksOn\(date\)\.slice\(0, 3\)\.map\(m => <ShiftMark key=\{m\.candidate_id\} mark=\{m\} \/>\)/)
  assert.match(cal, /\{firstNameOf\(mark\.name\) \|\| mark\.name\} \{mark\.shift \? badge\.label\.split\(' '\)\[0\] : ''\}/)
  assert.match(cal, /marks=\{marksOn\(dayOpen\)\}/, 'the day modal lists them too')
  assert.match(read('src/components/ngrp/ngrp.css'), /\.ngrp-shift-mark \{/)
})

test('migration 20260918: the schedule table, the hire shift, DELETE for service_role only here, and its checks', () => {
  const sql = read('supabase/migrations/20260918000000_ngrp_resident_schedule.sql')
  const body = code(sql)
  assert.match(body, /CREATE TABLE IF NOT EXISTS public\.ngrp_resident_schedule_days/)
  assert.match(body, /candidate_id\s+uuid\s+NOT NULL REFERENCES public\.ngrp_candidates\(id\) ON DELETE CASCADE/)
  assert.match(body, /on_date\s+date\s+NOT NULL/)
  assert.match(body, /REVOKE ALL PRIVILEGES ON TABLE public\.ngrp_resident_schedule_days FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(body, /shift\s+text\s+CHECK \(shift IS NULL OR shift IN \('Day', 'Night', 'Mid'\)\)/)
  assert.match(body, /CONSTRAINT uq_ngrp_resident_schedule_day UNIQUE \(candidate_id, on_date\)/)
  assert.match(body, /ALTER TABLE public\.ngrp_residency_outcomes\s+ADD COLUMN IF NOT EXISTS shift text/)
  assert.match(body, /CHECK \(shift IS NULL OR shift IN \('Day', 'Night', 'Mid', 'Variable'\)\)/)
  assert.match(body, /ENABLE ROW LEVEL SECURITY/)
  assert.match(body, /GRANT SELECT, INSERT, DELETE ON TABLE public\.ngrp_resident_schedule_days TO service_role/, 'a mark is a plan, not a record: removing one is a DELETE')
  assert.doesNotMatch(body, /GRANT[^;]*UPDATE[^;]*ngrp_resident_schedule_days/, 'no UPDATE: a changed mark is a delete and an add')
  assert.doesNotMatch(body, /TO (anon|authenticated|PUBLIC)/i)
  assert.doesNotMatch(body, /ngrp_audit_events/, 'no audit change in this migration')
  const checks = read('db/audit/ngrp_resident_schedule_checks.sql')
  for (const s of ['PRE 1', 'POST 1', 'POST 2', 'POST 3', 'POST 4', 'POST 5']) assert.ok(checks.includes(s), s)
  assert.match(checks, /DELETE,INSERT,SELECT/)
  assert.match(read('docs/security/OWNER_SQL_GATE.md'), /20260918000000_ngrp_resident_schedule\.sql/)
})
