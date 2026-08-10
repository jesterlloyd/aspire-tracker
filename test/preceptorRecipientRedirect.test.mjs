// PRECEPTOR-ROUTE-1: Primary-by-default recipient routing with Owner redirect to
// another ACTIVE canonical preceptor assignment (Owner decision 2026-08-10).
//
// The rule these pins hold in place:
//   - One assessment per student per timepoint (unchanged; DB constraint).
//   - Recipient defaults to the canonical primary exactly as before.
//   - The Owner may redirect a send ONLY to a preceptors.id that matches an ACTIVE
//     student_preceptor_assignments row for that student+cohort - never an email,
//     never free text, never an ended/removed assignment.
//   - The selected recipient is snapshotted at release (respondent_* columns) exactly
//     as today, so later assignment changes never alter history.
//   - One engine governs BOTH timepoints: both endpoints delegate to the same core
//     and neither contains timepoint-specific recipient logic.
// Run: node --test test/preceptorRecipientRedirect.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const core    = read('lib/server/evaluation/preceptorSend.js')
const release = read('api/evaluation-release-preceptor-survey.js')
const manual  = read('api/evaluation-send-preceptor-invitations.js')
const autoUi  = read('src/components/evaluation/PreceptorAutomationPanel.jsx')
const sendUi  = read('src/components/evaluation/PreceptorFeedbackPanel.jsx')

test('redirects are validated against ACTIVE canonical assignments only', () => {
  // The SPA lookup is scoped to this student, this cohort, this preceptor, active.
  assert.match(core, /\.from\('student_preceptor_assignments'\)/)
  assert.match(core, /\.eq\('student_id', student\.id\)\s*\n\s*\.eq\('cohort_id', cohortId\)\s*\n\s*\.eq\('preceptor_id', redirectPreceptorId\)\s*\n\s*\.eq\('status', 'active'\)/)
  // A non-matching target refuses with nothing written.
  assert.match(core, /Redirect target is not an active preceptor assignment for this student/)
  // Redirect resolution reads the canonical preceptors row - and only that.
  assert.match(core, /Redirect target preceptor record not found/)
  assert.match(core, /Redirect target has no email on file/)
})

test('redirects never fall back to free text', () => {
  // The retired free-text fallback still exists for legacy primary rows, but a
  // redirected send can never reach it.
  assert.match(core, /if \(!respondentEmail && !redirectRole\) \{/)
})

test('the default path is byte-for-byte the primary resolution', () => {
  // No redirect -> the same students.preceptor_id resolution as before, free-text
  // fallback included. The redirect branch only runs for a DIFFERENT target.
  assert.match(core, /redirectPreceptorId && redirectPreceptorId !== student\.preceptor_id/)
  assert.match(core, /\} else if \(student\.preceptor_id\) \{/)
})

test('the snapshot columns are unchanged and the redirect is audited', () => {
  // respondent_* snapshot exactly as today.
  assert.match(core, /respondent_preceptor_id:\s+respondentPreceptorId/)
  assert.match(core, /respondent_email/)
  assert.match(core, /respondent_name/)
  // The redirect is recorded in notification_log metadata with the assignment role.
  assert.match(core, /redirect: \{ preceptor_id: respondentPreceptorId, role: redirectRole \}/)
})

test('release endpoint: id-only selection, override posture intact', () => {
  assert.match(release, /'redirect_preceptor_id'\]\);/)
  assert.match(release, /redirect_preceptor_id must be a valid UUID/)
  assert.match(release, /redirectPreceptorId,/)
  // The strict allowlist still exists and still excludes every email-shaped field.
  assert.match(release, /const ALLOWED = new Set\(\['student_id', 'period', 'expected_preceptor_email', 'redirect_preceptor_id'\]\)/)
  // The 5b guard still compares the PRIMARY the Owner saw; a redirect is separate.
  assert.match(release, /currentEmail\.toLowerCase\(\) !== expectedPreceptorEmail\.toLowerCase\(\)/)
})

test('manual endpoint: per-item id-only selection, recipient rejection intact', () => {
  assert.match(manual, /items\[\$\{i\}\]\.redirect_preceptor_id must be a valid UUID/)
  assert.match(manual, /redirectPreceptorId: item\.redirect_preceptor_id \?\? null/)
  // The email-shaped override rejection list is untouched.
  assert.match(manual, /\['email', 'recipient_email', 'recipient', 'to', 'cc', 'bcc', 'respondent_email'\]/)
})

test('one engine, both timepoints: both endpoints delegate to the shared core', () => {
  assert.match(release, /processPreceptorSend\(\{/)
  assert.match(manual, /processPreceptorSend\(\{/)
  // No timepoint-conditional recipient logic anywhere in the core.
  const code = core.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.ok(!/timepoint\s*===\s*'(midpoint|post_rotation)'[^\n]*preceptor/i.test(code),
    'recipient resolution must not branch on timepoint')
})

test('release modal: Primary default, role-labelled canonical alternates, reset on open', () => {
  assert.match(autoUi, /\.eq\('status', 'active'\)\s*\n\s*\.in\('role', \['secondary', 'coverage'\]\)/)
  assert.match(autoUi, /— Primary/)
  assert.match(autoUi, /'Coverage' : 'Secondary'/)
  // Selection travels only when set, and resets when a new confirmation opens.
  assert.match(autoUi, /\.\.\.\(redirectId \? \{ redirect_preceptor_id: redirectId \} : \{\}\)/)
  assert.match(autoUi, /setReleaseMsg\(null\); setRedirectId\(''\); setAlternates\(\[\]\); setConfirm\(r\)/)
  // Alternates must be live records with an email - never a dead-end selection.
  assert.match(autoUi, /is_active !== false && \(r\.prec\.email \|\| ''\)\.trim\(\)/)
})

test('manual panel: per-student selection defaults to primary and clears on period change', () => {
  assert.match(sendUi, /\.eq\('status', 'active'\)\s*\n\s*\.in\('role', \['secondary', 'coverage'\]\)/)
  assert.match(sendUi, /— Primary/)
  assert.match(sendUi, /\.\.\.\(redirect \? \{ redirect_preceptor_id: redirect \} : \{\}\)/)
  assert.match(sendUi, /setRedirects\(new Map\(\)\) \}, \[period\]\)/)
  assert.match(sendUi, /prec\.is_active === false \|\| !\(prec\.email \|\| ''\)\.trim\(\)/)
})
