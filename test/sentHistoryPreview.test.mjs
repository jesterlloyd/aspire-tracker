// SENT-HISTORY-PREVIEW-1: every send type has an explicit preview strategy.
//
// THE PRODUCTION DEFECT
// Most eye-icon previews in Sent History read "A safe preview could not be
// reconstructed for this message type." That single message was covering three
// different situations:
//
//   1. Template-backed types that were simply never added to RECONSTRUCTABLE
//      (unit_leader_alert, and birthday_greeting once it starts sending). Their
//      builders exist and sendNotification stores exactly the context those
//      builders take - nothing was missing but the registration.
//   2. bulk_message_sent, an operator-composed email whose body is deliberately
//      never archived. "Cannot be reconstructed" was the wrong explanation;
//      "the body was not stored" is the true one.
//   3. Types that genuinely must not be reconstructed - the weekly digest, whose
//      log row stores a transition COUNT and not the transitions, and the
//      secure-link emails, where re-rendering would either fabricate a link that
//      was never sent or omit the email's whole purpose.
//
// New sends now capture an immutable redacted snapshot. Historical rows first
// try a read-only retrieval of the exact provider body; classification is the
// truthful fallback when neither exact source exists.
//
// Nothing here sends: the module under test renders and classifies only.
//
// Run: node --test test/sentHistoryPreview.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// supabase_admin throws at import without these; no client is ever used here.
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key-not-a-secret'

const { RECONSTRUCTABLE, MANUAL_TYPES, UNSUPPORTED_REASONS, NOTICE } =
  await import('../api/notification-log-message.js')
const { templates } = await import('../src/lib/notifications/templates/index.js')
const { SECURE_LINK_TYPES } = await import('../api/lib/archiveClassification.js')

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

/**
 * Every notification_type that can reach Sent History, gathered from the send
 * paths rather than hand-listed, so a new type shows up here automatically.
 */
function discoveredTypes() {
  const found = new Set()
  const scan = (src) => {
    for (const m of src.matchAll(/sendNotification\('([a-z_]+)'/g)) found.add(m[1])
    for (const m of src.matchAll(/notification_type:\s*'([a-z_]+)'/g)) found.add(m[1])
  }
  for (const f of [
    'api/connect-send-bulk-message.js', 'api/connect-send-direct-email.js',
    'api/cron/coordinator-weekly-digest.js', 'api/cron/interview-reminders.js',
    'api/cron/midpoint-checkin.js', 'api/cron/student-birthday-greetings.js',
    'api/certificate-preceptor-reconcile.js',
  ]) { try { scan(read(f)) } catch { /* optional file */ } }
  // Types only reachable from modules not scanned above.
  for (const t of ['unit_leader_alert', 'unit_form_received', 'placement_request_received',
    'clockout_reminder', 'teams_invite_reminder', 'teams_invite_reminder_escalation',
    'form_received', 'evaluation_invitation_sent', 'evaluation_invitation_test',
    'evaluation_survey_test_sent', 'casey_fink_post_rotation_request_sent',
    'post_rotation_evaluation_request_sent', 'student_preceptor_eval_request_sent',
    'preceptor_feedback_request_sent', 'preceptor_certificate_ready']) found.add(t)
  return [...found].filter(t => t !== 'notification_type')
}

const strategiesFor = (t) => [
  RECONSTRUCTABLE.has(t) && 'reconstruct',
  MANUAL_TYPES.has(t) && 'manual',
  UNSUPPORTED_REASONS[t] && 'unsupported',
].filter(Boolean)

// ── Coverage: the structural guarantee ──────────────────────────────────────

test('every discovered send type has exactly one preview strategy', () => {
  const problems = []
  for (const t of discoveredTypes()) {
    const s = strategiesFor(t)
    if (s.length === 0) problems.push(`${t}: UNCLASSIFIED`)
    if (s.length > 1) problems.push(`${t}: CONFLICT (${s.join(' + ')})`)
  }
  assert.deepEqual(problems, [], problems.join('; '))
})

test('every reconstructable type actually has a registered template', () => {
  for (const t of RECONSTRUCTABLE) {
    assert.ok(templates[t], `${t} is marked reconstructable but has no template builder`)
  }
})

test('every unsupported reason has notice copy explaining WHY', () => {
  for (const [type, reason] of Object.entries(UNSUPPORTED_REASONS)) {
    assert.ok(NOTICE[reason], `${type} -> ${reason} has no notice text`)
    assert.ok(NOTICE[reason].length > 40, `${reason} should explain, not shrug`)
  }
})

// ── The specific gaps that were fixed ───────────────────────────────────────

test('unit_leader_alert is reconstructable (template existed, registration did not)', () => {
  assert.ok(RECONSTRUCTABLE.has('unit_leader_alert'))
  assert.ok(templates.unit_leader_alert)
})

test('birthday_greeting is reconstructable before its first send lands', () => {
  assert.ok(RECONSTRUCTABLE.has('birthday_greeting'))
  assert.ok(templates.birthday_greeting)
})

test('bulk_message_sent is manual, not generically unsupported', () => {
  assert.ok(MANUAL_TYPES.has('bulk_message_sent'))
  assert.ok(!UNSUPPORTED_REASONS.bulk_message_sent)
  // ARCHIVE-SNAPSHOT-1 changed the second half of this: bulk sends now DO write
  // an archive, so the manual path serves a real body going forward and the
  // "body was not stored" fallback applies only to historical rows sent before
  // the snapshot wiring. The classification itself is unchanged - bulk is a
  // manual composition, not a reconstructable template.
  assert.match(read('api/connect-send-bulk-message.js'), /contentKind: 'manual_bulk_email'/)
})

test('the weekly digest stays unsupported because its contents were never stored', () => {
  assert.equal(UNSUPPORTED_REASONS.coordinator_weekly_digest, 'digest_contents_not_stored')
  const cron = read('api/cron/coordinator-weekly-digest.js')
  // Only a COUNT is stored; the rows the template renders are not.
  assert.match(cron, /transition_count:/)
  assert.doesNotMatch(cron, /metadata:\s*\{[\s\S]{0,400}transitions:\s*\[/)
})

test('secure-link emails are never re-rendered', () => {
  for (const t of SECURE_LINK_TYPES) {
    assert.equal(UNSUPPORTED_REASONS[t], 'secure_link_email')
    assert.ok(!RECONSTRUCTABLE.has(t), `${t} must not be reconstructed`)
  }
  assert.match(NOTICE.secure_link_email, /secure personal link/)
})

// ── Reconstruction renders the real template, safely ────────────────────────

test('a reconstructable type renders from stored context, not current data', () => {
  const out = templates.unit_leader_alert.unit_leader?.({ firstName: 'Sam' })
    || Object.values(templates.unit_leader_alert)[0]({ firstName: 'Sam' })
  assert.ok(out && typeof out.html === 'string' && out.html.length > 0)
  const src = read('api/notification-log-message.js')
  // The context comes from the ROW, never from a students lookup.
  assert.match(src, /const ctx = \(row\.metadata && row\.metadata\.context\) \|\| \{\}/)
  assert.doesNotMatch(src, /from\('students'\)/, 'a past email must never be rebuilt from present student data')
})

test('reconstructed HTML is redacted before it reaches the client', () => {
  const src = read('api/notification-log-message.js')
  assert.match(src, /redactArchiveHtml\(out\.html\)/, 'reconstructed bodies are sanitized')
  assert.match(src, /function bodyPreview[\s\S]{0,260}redactArchiveHtml\(html\)/, 'all HTML bodies are sanitized')
})

test('preview precedence is archive, exact provider body, then reconstruction', () => {
  const src = read('api/notification-log-message.js')
  const archive = src.indexOf('let preview = await archivedPreview(row.id)')
  const provider = src.indexOf('providerPreview(row.resend_email_id)')
  const reconstruct = src.indexOf('RECONSTRUCTABLE.has(type)', provider)
  assert.ok(archive > 0 && provider > archive && reconstruct > provider)
})

test('provider recovery is read-only, redacted, verified, and never cached', () => {
  const src = read('api/notification-log-message.js')
  const fn = src.slice(src.indexOf('async function providerPreview'), src.indexOf('export default async function handler'))
  assert.match(fn, /emails\.get\(resendEmailId\)/)
  assert.match(fn, /buildSecureLinkSnapshot\(\{ html: data\.html, text: data\.text \}\)/)
  assert.match(fn, /if \(!safe\.safe\) return null/)
  assert.doesNotMatch(fn, /insert|update|upsert|delete|archiveSentMessage|emails\.send/)
  assert.match(NOTICE.provider_redacted, /delivery provider/)
})

test('historical manual and digest explanations remain the final honest fallback', () => {
  const src = read('api/notification-log-message.js')
  const provider = src.indexOf('providerPreview(row.resend_email_id)')
  assert.ok(src.indexOf('MANUAL_TYPES.has(type)', provider) > provider)
  assert.ok(src.indexOf('UNSUPPORTED_REASONS[type]', provider) > provider)
})

test('an incomplete record degrades to unavailable rather than a broken render', () => {
  const src = read('api/notification-log-message.js')
  assert.match(src, /preview = html[\s\S]{0,220}unavailable\('reconstruction_failed'\)/)
  assert.match(src, /catch \(e\)[\s\S]{0,200}unavailable\('reconstruction_failed'\)/)
})

test('an unknown type still gets the generic unavailable state', () => {
  const t = 'a_type_nobody_has_written_yet'
  assert.equal(strategiesFor(t).length, 0)
  assert.ok(NOTICE.reconstruction_unsupported)
})

// ── Previewing cannot send ──────────────────────────────────────────────────

test('the preview endpoint has no send path at all', () => {
  // Comments are stripped first: this file DISCUSSES sendNotification in its
  // header, and asserting absence against raw source would flag the prose.
  const code = read('api/notification-log-message.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.match(code, /emails\.get\(/, 'historical recovery may only read the provider record')
  assert.doesNotMatch(code, /sendNotification\(|emails\.send\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/,
    'a preview must read only: no send, no tracking write, no log write')
  assert.match(code, /req\.method !== 'GET'/, 'and it is GET-only')
})
