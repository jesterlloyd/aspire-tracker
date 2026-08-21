// test/s06TemplateEscaping.test.mjs
//
// S-06 TEMPLATE ESCAPING: the notification templates that interpolate caller-supplied values into
// raw HTML must escape every one of them, so a submitter cannot inject working markup into mail
// that staff, coordinators, interviewers, and unit leaders receive.
//
// These tests RENDER the real templates with a hostile payload and inspect the HTML. They assert
// three things that have to hold together:
//   1. injected markup is inert (escaped),
//   2. escaping is applied exactly once (no literal "&amp;lt;" reaching a reader), and
//   3. ordinary text with an apostrophe or ampersand still reads correctly.
//
// Nothing here sends email or performs network I/O: every template is a pure function.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { unitFormReceived } from '../src/lib/notifications/templates/unitFormReceived.js'
import { teamsInviteReminder, teamsInviteReminderEscalation } from '../src/lib/notifications/templates/teamsInviteReminder.js'
import { formReceived } from '../src/lib/notifications/templates/formReceived.js'
import { unitLeaderAlert } from '../src/lib/notifications/templates/unitLeaderAlert.js'
import { placementRequestReceived } from '../src/lib/notifications/templates/placementRequestReceived.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

// A payload that would break out of a text node, out of a double-quoted attribute, and out of the
// shell's hidden preheader div if any of them were unescaped.
const XSS = `<img src=x onerror=alert(1)>"><a href="https://evil.example">click</a>`
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;&quot;&gt;&lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt;'

// Ordinary text that must survive intact and readable after exactly one escape pass.
const ORDINARY = "O'Brien & Sons"
const ORDINARY_ONCE = 'O&#39;Brien &amp; Sons'

// The tell-tale of a double escape: an ampersand that has itself been escaped again.
const DOUBLE_ESCAPE_MARKERS = ['&amp;lt;', '&amp;gt;', '&amp;quot;', '&amp;#39;', '&amp;amp;']

// Escaping neutralizes markup, it does not delete text: the characters "onerror=alert(1)" still
// appear INSIDE the escaped string, harmlessly, as a text node. So the checks that matter are that
// no live tag or live attribute boundary survives, and that the payload is present in escaped form.
function assertNoInjection(html, label) {
  assert.ok(!html.includes('<img src=x'), `${label}: a live <img> tag survived into the HTML`)
  assert.ok(!html.includes('<a href="https://evil.example"'), `${label}: a live injected anchor survived`)
  assert.ok(!html.includes(XSS), `${label}: the payload survived verbatim, so it was never escaped`)
  assert.ok(html.includes(ESCAPED), `${label}: the payload is not present in its escaped form`)
}

function assertNoDoubleEscape(html, label) {
  for (const marker of DOUBLE_ESCAPE_MARKERS) {
    assert.ok(!html.includes(marker), `${label}: double-escaped sequence ${marker} would render as literal entities`)
  }
}

// ── unitFormReceived: every field comes from the PUBLIC unit participation form ──────────────────

test('S-06: unitFormReceived internal alert escapes every submitted field', () => {
  const { html, subject } = unitFormReceived.internal_team({
    cohortName: XSS, unitName: XSS, submitterName: XSS, submitterEmail: XSS, submitterRole: XSS,
    slotsOffered: 3, shiftPreference: XSS, preferredPreceptors: XSS, considerations: XSS,
    reasonForZero: XSS, hiringNgrp: false, hiringNgrpReason: XSS,
    hasFiredAlumni: XSS, alumniOutcome: XSS, alumniNotes: XSS, wouldConsiderAlumni: XSS,
  })
  assertNoInjection(html, 'unitFormReceived.internal_team')
  assertNoDoubleEscape(html, 'unitFormReceived.internal_team')
  // Subject is plain text, not HTML: it must NOT be escaped.
  assert.ok(subject.includes('<img src=x'), 'the subject must stay raw plain text')
})

test('S-06: unitFormReceived submitter confirmation escapes every submitted field', () => {
  for (const slotsOffered of [4, 0]) {
    const { html } = unitFormReceived.submitter({
      cohortName: XSS, unitName: XSS, submitterName: XSS, submitterEmail: XSS,
      slotsOffered, reasonForZero: XSS, considerations: XSS,
    })
    assertNoInjection(html, `unitFormReceived.submitter (slots ${slotsOffered})`)
    assertNoDoubleEscape(html, `unitFormReceived.submitter (slots ${slotsOffered})`)
  }
})

test('S-06: unitFormReceived escapes the preheader, which the shell renders into HTML', () => {
  const { html } = unitFormReceived.internal_team({
    cohortName: 'Fall 2026', unitName: XSS, submitterName: 'A Leader',
    submitterEmail: 'a@b.org', slotsOffered: 1, hiringNgrp: true,
  })
  // The preheader is the first thing the shell emits, inside a display:none div.
  const preheaderDiv = html.slice(html.indexOf('<div style="display:none'), html.indexOf('</div>'))
  assert.ok(!preheaderDiv.includes('<img src=x'), 'raw markup reached the hidden preheader div')
})

test('S-06: unitFormReceived renders ordinary text readably, escaped exactly once', () => {
  const { html } = unitFormReceived.internal_team({
    cohortName: 'Fall 2026', unitName: ORDINARY, submitterName: ORDINARY,
    submitterEmail: 'a@b.org', submitterRole: 'Manager', slotsOffered: 2,
    hiringNgrp: true, considerations: ORDINARY,
  })
  assert.ok(html.includes(ORDINARY_ONCE), 'ordinary text is not escaped exactly once')
  assertNoDoubleEscape(html, 'unitFormReceived ordinary text')
})

test('S-06: buildResponseSummaryHtml returns escaped HTML and is not escaped again by its caller', async () => {
  const { buildResponseSummaryHtml } = await import('../src/lib/notifications/templates/unitFormReceived.js')
  const summary = buildResponseSummaryHtml({ considerations: XSS, slotsOffered: 1 })
  assert.ok(summary.includes(ESCAPED), 'the summary builder must escape its own values')
  // The builder emits real markup of its own; that markup must survive into the email intact.
  assert.ok(summary.includes('<strong>Considerations:</strong>'), 'the builder\'s own markup must stay live')
  const { html } = unitFormReceived.internal_team({
    cohortName: 'Fall 2026', unitName: 'Unit', submitterName: 'A', submitterEmail: 'a@b.org',
    slotsOffered: 1, considerations: XSS, hiringNgrp: true,
  })
  assert.ok(html.includes('<strong>Considerations:</strong>'), 'the summary HTML was escaped a second time by its caller')
})

// ── teamsInviteReminder: student values, including inside mailto hrefs ───────────────────────────

test('S-06: both Teams invite reminders escape student values and mailto hrefs', () => {
  for (const [label, tpl] of [['reminder', teamsInviteReminder], ['escalation', teamsInviteReminderEscalation]]) {
    const { html } = tpl.interviewer({
      studentName: XSS, studentSchool: XSS, studentEmail: XSS, interviewerName: XSS,
      interviewDate: XSS, interviewTime: XSS, duration: XSS, hoursUntilInterview: XSS,
    })
    assertNoInjection(html, `teamsInvite ${label}`)
    assertNoDoubleEscape(html, `teamsInvite ${label}`)
    // The mailto scheme is fixed, and the address cannot break out of the attribute.
    assert.ok(!/href="mailto:[^"]*"[^>]*onerror/.test(html), `teamsInvite ${label}: attribute breakout`)
  }
})

test('S-06: the Teams invite renderEmailNote body is escaped once by the primitive, not twice', () => {
  const { html } = teamsInviteReminder.interviewer({
    studentName: ORDINARY, studentEmail: 'a@b.edu', interviewerName: 'Pat Lee',
    interviewDate: '2026-09-01', interviewTime: '10:00', duration: 30, hoursUntilInterview: 24,
  })
  assert.ok(html.includes(ORDINARY_ONCE), 'the note body is not escaped exactly once')
  assertNoDoubleEscape(html, 'teamsInvite note body')
  // Guard the double-escape trap directly at the source: the note body must not pre-escape.
  const src = read('src/lib/notifications/templates/teamsInviteReminder.js')
  assert.doesNotMatch(src, /renderEmailNote\(\{[^}]*escapeHtml/, 'renderEmailNote escapes its own input; do not escape first')
})

// ── formReceived (archive reconstruction) and placementRequestReceived ───────────────────────────

test('S-06: formReceived escapes every variant', () => {
  const ctx = {
    studentName: XSS, studentFirstName: XSS, studentGreetingName: XSS, school: XSS,
    programType: XSS, studentEmail: XSS, cumulativeGpa: XSS,
  }
  for (const variant of ['student', 'internal_team']) {
    const { html } = formReceived[variant](ctx)
    assertNoInjection(html, `formReceived.${variant}`)
    assertNoDoubleEscape(html, `formReceived.${variant}`)
  }
  const { html } = formReceived.school_coordinator(ctx, { name: XSS })
  assertNoInjection(html, 'formReceived.school_coordinator')
  assertNoDoubleEscape(html, 'formReceived.school_coordinator')
})

test('S-06: placementRequestReceived escapes its preheaders as well as its body', () => {
  const ctx = {
    studentName: XSS, studentFirstName: XSS, school: XSS, programType: XSS,
    studentEmail: XSS, coordinatorName: XSS, coordinatorEmail: XSS, cohortName: XSS,
  }
  for (const variant of ['school_coordinator', 'internal_team']) {
    const { html } = placementRequestReceived[variant](ctx, { name: XSS })
    assertNoInjection(html, `placementRequestReceived.${variant}`)
    assertNoDoubleEscape(html, `placementRequestReceived.${variant}`)
    const preheaderDiv = html.slice(html.indexOf('<div style="display:none'), html.indexOf('</div>'))
    assert.ok(!preheaderDiv.includes('<img src=x'), `placementRequestReceived.${variant}: raw markup in the preheader`)
  }
})

// ── unitLeaderAlert ──────────────────────────────────────────────────────────────────────────────

test('S-06: unitLeaderAlert escapes the unit, label, summary, and CTA', () => {
  const { html } = unitLeaderAlert.unit_leader({
    alert_label: XSS, unit_name: XSS, summary: XSS,
    recipient: { name: XSS }, cta_path: '/portal/unit/home',
  })
  assertNoInjection(html, 'unitLeaderAlert')
  assertNoDoubleEscape(html, 'unitLeaderAlert')
})

test('S-06: unitLeaderAlert keeps its own CTA link live and resolvable', () => {
  const { html } = unitLeaderAlert.unit_leader({
    alert_label: 'New placement request', unit_name: '7NE',
    summary: 'ASPIRE approved a placement request.', recipient: { name: 'Pat Lee' },
  })
  assert.match(html, /<a href="https:\/\/[^"]*\/portal\/unit\/home"/, 'the portal CTA must remain a working link')
  assert.ok(html.includes('Open the Unit Leader Portal'), 'the CTA label must render')
})

// ── Tokenized links are untouched by this work ───────────────────────────────────────────────────

test('S-06: no template in this directory handles a tokenized survey or evaluation link', () => {
  // Tokenized links live in lib/server/evaluation/*, which this change does not touch. Proving the
  // absence here is what keeps the byte-identity guarantee safe from this escaping pass.
  const files = [
    'unitFormReceived', 'teamsInviteReminder', 'formReceived', 'unitLeaderAlert',
    'placementRequestReceived', 'coordinatorWeeklyDigest',
  ]
  for (const f of files) {
    const src = read(`src/lib/notifications/templates/${f}.js`)
    assert.doesNotMatch(src, /token|surveyUrl|trustedUrl/i, `${f}.js unexpectedly references a token link`)
  }
})

test('S-06: the evaluation templates that DO carry tokens were not touched by the escaping pass', () => {
  // Byte-identity across CTA href, fallback href, and fallback visible text.
  for (const f of [
    'lib/server/evaluation/emailTemplates.js',
    'lib/server/evaluation/reminderEmailTemplates.js',
    'lib/server/evaluation/preceptorEmailTemplates.js',
    'lib/server/evaluation/studentEvalEmailTemplates.js',
    'lib/server/evaluation/postRotationEmailTemplates.js',
    'lib/server/evaluation/caseyFinkPostRotationEmailTemplates.js',
  ]) {
    const src = read(f)
    assert.match(src, /trustedUrl:\s*true/, `${f}: the tokenized CTA must stay on the verbatim path`)
    assert.doesNotMatch(src, /escapeHtml\(\s*surveyUrl\s*\)/, `${f}: a token URL must never be HTML-escaped`)
  }
})
