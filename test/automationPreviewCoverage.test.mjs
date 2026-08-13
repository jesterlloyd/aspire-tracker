// AUTOMATION-PREVIEW-COVERAGE-1: the eye icon must mean something.
//
// THE PRODUCTION DEFECT
// Student Birthday Greetings shipped with the shared Preview eye on its card but
// no entry in AUTOMATION_PREVIEW_FIXTURES, so clicking it opened "Preview
// unavailable / No preview available". The affordance promised something that
// did not exist.
//
// Two things are pinned here. Every card that SHOWS the eye must have a fixture
// (coverage), and the eye is now rendered from that same capability rather than
// unconditionally, so a future automation cannot repeat this - it will simply
// have no eye until someone registers a preview.
//
// The preview renders the REAL registered template with sample data. It never
// sends: nothing in this path touches sendNotification, Resend, or a cron.
//
// Run: node --test test/automationPreviewCoverage.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AUTOMATION_PREVIEW_FIXTURES, getPreviewFixture } from '../src/lib/notifications/previewFixtures.js'
import { buildBirthdayGreetingEmail } from '../src/lib/notifications/templates/birthdayGreeting.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const viewSrc = read('src/components/connect/AutomationView.jsx')

/** Card ids declared in AUTOMATION_CARDS. */
function cardIds(src) {
  const block = src.slice(src.indexOf('const AUTOMATION_CARDS'), src.indexOf('\n]', src.indexOf('const AUTOMATION_CARDS')))
  return [...block.matchAll(/\{ id: '([a-z0-9_]+)'/g)].map(m => m[1])
}

// ── Coverage ────────────────────────────────────────────────────────────────

test('every automation card has a registered preview fixture', () => {
  const missing = cardIds(viewSrc).filter(id => !getPreviewFixture(id))
  assert.deepEqual(missing, [],
    `these cards would open "No preview available": ${missing.join(', ')}`)
})

test('the eye is capability-driven, not unconditional', () => {
  assert.match(viewSrc, /canPreview={!!getPreviewFixture\(card\.id\)}/,
    'the card must be told whether a preview exists')
  assert.match(viewSrc, /\{canPreview && \(/, 'and must render the eye only then')
})

test('every fixture actually renders a subject and a body', () => {
  for (const [id, fx] of Object.entries(AUTOMATION_PREVIEW_FIXTURES)) {
    const variants = fx.variants ? fx.variants.map(v => v.key) : [undefined]
    for (const v of variants) {
      const out = fx.render(v)
      assert.ok(out && typeof out.subject === 'string' && out.subject.length > 0, `${id}/${v}: subject`)
      assert.ok(out && typeof out.html === 'string' && out.html.length > 0, `${id}/${v}: html`)
    }
    assert.ok(fx.recipientType, `${id}: recipientType`)
  }
})

// ── The birthday preview specifically ───────────────────────────────────────

test('the birthday preview renders the REAL template, not duplicated markup', () => {
  const fx = getPreviewFixture('student_birthday_greetings')
  assert.ok(fx, 'registered')
  const preview = fx.render()
  const real = buildBirthdayGreetingEmail({ firstName: 'Jordan' })
  assert.equal(preview.subject, real.subject, 'same subject as a real send')
  assert.equal(preview.html, real.html, 'byte-identical body to a real send')

  const src = read('src/lib/notifications/previewFixtures.js')
  assert.match(src, /buildBirthdayGreetingEmail/, 'imports the registered builder')
  // No hand-written copy in the fixture file for this email.
  assert.doesNotMatch(src, /Happy Birthday/, 'the greeting text lives only in the template')
})

test('the birthday preview is Student-addressed and uses sample data', () => {
  const fx = getPreviewFixture('student_birthday_greetings')
  assert.equal(fx.recipientType, 'Student')
  assert.match(fx.render().html, /Jordan/, 'the shared fictional sample name')
})

test('the preview exposes no DOB, age, or student identifier', () => {
  const { subject, html, text } = getPreviewFixture('student_birthday_greetings').render()
  const all = `${subject} ${html} ${text || ''}`
  assert.doesNotMatch(all, /\b(19|20)\d{2}\b/, 'no year, so no birth year')
  assert.doesNotMatch(all, /\bage\b|\byears old\b|\bturning\b/i)
  assert.doesNotMatch(all, /date of birth|\bdob\b/i)
  assert.doesNotMatch(all, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no uuid')
})

// ── Preview can never send ──────────────────────────────────────────────────

test('the preview path cannot send an email', () => {
  const src = read('src/lib/notifications/previewFixtures.js')
  assert.doesNotMatch(src, /sendNotification|new Resend|resend\.emails/,
    'fixtures render only; they hold no send path')
  // The drawer is a client-side render. No Send Test action was added, because
  // the existing preview architecture has none to reuse.
  assert.doesNotMatch(viewSrc, /Send test|sendTest|send_test/i,
    'no Send Test action exists in this architecture and none was invented')
})

test('the SAMPLE DATA treatment is preserved', () => {
  const drawer = read('src/components/connect/AutomationEmailPreviewDrawer.jsx')
  assert.match(drawer, /SAMPLE DATA/i, 'the not-a-real-send treatment must remain')
})

test('real send behaviour is untouched by this change', () => {
  // The cron, its eligibility module, and the settings key are not edited here.
  const cron = read('api/cron/student-birthday-greetings.js')
  assert.doesNotMatch(cron, /previewFixtures|getPreviewFixture/, 'the cron knows nothing about previews')
  assert.match(cron, /AUTOMATION_KEY = 'student_birthday_greetings'/)
})
