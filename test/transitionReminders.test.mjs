// TRANSITION-REMINDER-1 (Owner, 2026-11-01): the Transition Form goes out again each day until the
// response is in. Who gets one is pure; a reminder adds a link and revokes nothing, so last week's
// email and an open page keep working, which needs the one-active index gone.
// Run: node --test test/transitionReminders.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  reminderTargets, addReminderLink, retireUnsentLink, RECENT_HOURS, REMINDER_NOTIFICATION_TYPE,
} from '../lib/server/ngrpTransitionReminders.js'
import { buildTransitionReminderEmail } from '../lib/server/email/ngrpTransitionEmail.js'
import { getPreviewFixture } from '../src/lib/notifications/previewFixtures.js'
import { classifySendRecipients } from '../lib/server/ngrpTransition.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

const NOW = Date.parse('2026-11-02T16:00:00Z')
const DAY = 86_400_000
const ago = ms => new Date(NOW - ms).toISOString()
const CYCLE = { id: 'cy', name: 'Winter 2027', application_deadline: '2026-11-11', transition_form_deadline: '2026-11-11' }

// One waiting alumnus, sent two days ago; each test changes one thing.
const scene = (over = {}) => ({
  cycle: CYCLE, nowMs: NOW,
  candidates: [{ id: 'c1', student_id: 's1', assignment_id: 'a1', ...over.candidate }],
  assignments: [{ id: 'a1', status: 'sent', revoked_at: null, revision_count: 0, deadline_at: null, ...over.assignment }],
  tokens: over.tokens || [{ assignment_id: 'a1', status: 'active', created_at: ago(2 * DAY) }],
  students: [{ id: 's1', status: 'Completed', personal_email: 'ace@home.test', school_email: 'ace@school.test', rotation: { rotation_end_date: '2026-08-01' }, ...over.student }],
})
const sends = s => reminderTargets(s).targets.length === 1
const why = s => Object.keys(reminderTargets(s).skipped)[0]

test('a form that was sent, opened or started, with no response yet, gets a reminder', () => {
  for (const status of ['sent', 'opened', 'in_progress']) assert.ok(sends(scene({ assignment: { status } })), status)
  assert.equal(reminderTargets(scene()).targets[0].email, 'ace@home.test', "the same address as the send: an alumnus's personal email")
})

test('the reminders stop once the response is in', () => {
  for (const status of ['submitted', 'revised']) assert.ok(!sends(scene({ assignment: { status, revision_count: 1 } })), status)
  assert.ok(!sends(scene({ assignment: { status: 'sent', revision_count: 1 } })), 'a revision counts, whatever the status says')
})

test('never to someone not sent the form, a revoked assignment, or a provider-failed first send', () => {
  assert.ok(!sends({ ...scene(), assignments: [] }), 'no form was sent')
  assert.ok(!sends(scene({ candidate: { assignment_id: null } })), 'a candidate with no assignment')
  assert.ok(!sends(scene({ assignment: { status: 'pending' } })), 'never delivered')
  assert.ok(!sends(scene({ assignment: { revoked_at: ago(DAY) } })), 'assignment revoked')
})

test('the reminders stop when the form closes, Pacific end of the deadline day', () => {
  const at = iso => ({ ...scene(), nowMs: Date.parse(iso) })
  assert.ok(sends(at('2026-11-12T07:59:00Z')), '11:59 PM PST on the 11th is still open')
  assert.ok(!sends(at('2026-11-12T08:00:00Z')))
  assert.equal(why(at('2026-11-12T08:00:00Z')), 'closed')
  assert.ok(!sends(scene({ assignment: { deadline_at: ago(1000) } })), "the assignment's own close wins")
  assert.ok(!sends({ ...scene(), cycle: { id: 'cy', name: 'x' } }), 'no close configured sends nothing')
})

test('a link staff revoked stays revoked: a daily job must not hand them a new one', () => {
  const s = scene({ tokens: [{ assignment_id: 'a1', status: 'revoked', created_at: ago(5 * DAY) }] })
  assert.ok(!sends(s))
  assert.equal(why(s), 'link_revoked')
})

test('once a day: a recent send or an earlier run today means nothing today', () => {
  const recent = hours => scene({ tokens: [{ assignment_id: 'a1', status: 'active', created_at: ago(hours * 3_600_000) }] })
  assert.equal(RECENT_HOURS, 20)
  assert.ok(!sends(recent(1)), 'a re-run of the job')
  assert.equal(why(recent(19)), 'recently_sent', 'sent by hand yesterday afternoon')
  assert.ok(sends(recent(24)), 'yesterday morning is today')
})

test('a closed application is not reminded', () => {
  for (const candidate of [{ application_status: 'not_proceeding' }, { application_status: 'withdrawn' }, { outcome: { hired_at: ago(DAY) } }, { outcome: { offer_declined_at: ago(DAY) } }, { outcome: { not_selected_at: ago(DAY) } }]) {
    assert.equal(why(scene({ candidate })), 'application_over', JSON.stringify(candidate))
  }
})

test('no email on file and not an alumnus are skipped and counted', () => {
  assert.equal(why(scene({ student: { personal_email: null, school_email: null } })), 'no_email')
  assert.equal(why(scene({ student: { status: 'Placed' } })), 'not_completed')
})

// ── A reminder adds a link and revokes nothing ─────────────────────────────

const tokenDb = (result) => {
  const calls = []
  return {
    calls,
    from: table => ({
      insert: row => { calls.push({ table, op: 'insert', row }); return { select: () => ({ maybeSingle: () => Promise.resolve(result) }) } },
      update: row => { calls.push({ table, op: 'update', row }); return { eq: (c, v) => { calls.at(-1).where = [c, v]; return Promise.resolve({ error: null }) } } },
    }),
  }
}
const mint = () => ({ raw: 'RAW', hash: 'HASH', hashPrefix: 'HASHPREF' })

test('the new link is active at once, hashed, and only its hash is stored', async () => {
  const db = tokenDb({ data: { id: 't1', token_hash_prefix: 'HASHPREF' }, error: null })
  const out = await addReminderLink(db, 'a1', mint)
  assert.equal(out.raw, 'RAW')
  assert.deepEqual(db.calls[0].row, { assignment_id: 'a1', token_hash: 'HASH', token_hash_prefix: 'HASHPREF', status: 'active' })
  assert.ok(!JSON.stringify(db.calls).includes('RAW'))
})

test('before the migration the insert is refused and the run stops before anything is mailed', async () => {
  assert.deepEqual(await addReminderLink(tokenDb({ data: null, error: { code: '23505' } }), 'a1', mint), { notReady: true })
  const cron = read('api/cron/ngrp-transition-reminders.js')
  const refused = cron.indexOf('if (link.notReady)')
  const mailed = cron.indexOf('await sendEmail(mailer')
  assert.ok(refused > 0 && refused < mailed, 'checked before the send')
  assert.match(cron.slice(refused, mailed), /links_migration_pending/)
})

test('the cron never calls the rotation that revokes earlier links, and a refused email retires its link', async () => {
  const cron = read('api/cron/ngrp-transition-reminders.js')
  assert.ok(!/ngrp_activate_token_tx|sendOneTransitionForm|revokeTokensById/.test(cron))
  assert.match(cron, /if \(out\.rejected\) await retireUnsentLink/)
  const db = tokenDb({})
  await retireUnsentLink(db, 't1', 'provider_rejected')
  assert.deepEqual(db.calls[0].row, { status: 'failed', failed_reason: 'provider_rejected' })
  assert.deepEqual(db.calls[0].where, ['id', 't1'])
})

test('the migration drops only the one-active index; a hand send and revoke still act on every link', () => {
  const sql = read('supabase/migrations/20261117000000_ngrp_tokens_many_active.sql')
  assert.deepEqual(sql.split('\n').filter(l => l.trim() && !l.startsWith('--')), ['DROP INDEX IF EXISTS public.ngrp_tokens_one_active;'])
  const base = read('supabase/migrations/20260904000000_ngrp_planning_transition.sql')
  assert.match(base, /WHERE assignment_id = a\.id AND id <> p_token_id AND status IN \('pending', 'active'\)/)
  assert.match(read('api/ngrp-manage.js'), /\.eq\('assignment_id', live\.assignment\.id\)\.eq\('status', 'active'\)[\s\S]{0,200}\.map\(t => t\.id\)/)
  // A hand resend's classification is untouched by any of this.
  assert.equal(classifySendRecipients({ students: [], candidatesByStudent: new Map(), liveAssignmentsByCandidate: new Map() }).send.length, 0)
})

// ── The email and its place in the app ─────────────────────────────────────

test('the email has the button, the close date and the promise to stop, and its preview is the same builder', () => {
  const { subject, html } = buildTransitionReminderEmail({
    student: { first_name: 'Grace', preferred_first_name: 'Ace' }, cycle: CYCLE,
    url: 'https://x.test/ngrp/transition#t=abc', closeText: '2026-11-12T07:59:59.999Z',
  })
  assert.equal(subject, 'Reminder: Your NGRP Transition Form - Winter 2027')
  assert.match(html, /Hi Ace,/)
  assert.match(html, /href="https:\/\/x\.test\/ngrp\/transition#t=abc"/)
  assert.match(html, /November 11, 2026/)
  assert.match(html, /Once you submit it, the reminders stop/)
  assert.match(html, /earlier emails still work/)
  const fx = getPreviewFixture('ngrp_transition_reminders').render()
  assert.match(fx.subject, /^Reminder: Your NGRP Transition Form/)
  assert.match(fx.html, /SAMPLE-PREVIEW-LINK/)
})

test('it is scheduled, can be paused, shows in Sent History and never logs the link', () => {
  const vercel = JSON.parse(read('vercel.json'))
  assert.deepEqual(vercel.crons.find(c => c.path === '/api/cron/ngrp-transition-reminders'), { path: '/api/cron/ngrp-transition-reminders', schedule: '0 16 * * *' })
  assert.equal(vercel.functions['api/cron/ngrp-transition-reminders.js'].maxDuration, 120)
  assert.match(read('api/automation-settings.js'), /\{ key: 'ngrp_transition_reminders', label: 'Transition Form Reminders',[\s\S]{0,300}defaultEnabled: true \}/)
  assert.match(read('src/components/connect/AutomationView.jsx'), /\{ id: 'ngrp_transition_reminders', title: 'Transition Form Reminders',/)
  assert.equal(REMINDER_NOTIFICATION_TYPE, 'ngrp_transition_form_reminder')
  assert.match(read('api/notification-log-message.js'), /ngrp_transition_form_reminder: +'secure_link_email'/)
  assert.match(read('src/components/connect/SentHistory.jsx'), /types: \['ngrp_transition_form_sent', 'ngrp_transition_form_reminder'\]/)
  const cron = read('api/cron/ngrp-transition-reminders.js')
  assert.match(cron, /populationDb\(createClient\(/, 'real rows only')
  assert.match(cron, /isAutomationEnabled\(\{ supabaseAdmin: db, automationKey: AUTOMATION_KEY \}\)/)
  const logged = cron.slice(cron.indexOf("from('notification_log')"), cron.indexOf('if (log.error)'))
  assert.ok(!/link\.raw|\burl\b|html/.test(logged), 'the raw link never reaches the log')
})
