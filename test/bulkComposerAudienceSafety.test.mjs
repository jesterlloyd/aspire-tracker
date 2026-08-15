// BULK-EXACT-RECIPIENTS-1 (P0): the composer's audience-safety wiring.
//
// The behavioural rules live in src/lib/connect/bulkAudience.js and are tested
// in test/bulkAudienceModel.test.mjs; the server floor in
// test/bulkRecipientAllowlist.test.mjs and test/bulkSendExactPayload.test.mjs.
// This file pins the COMPOSER to those tested modules: that it actually uses
// them, that the lifecycle resets exist, and that the visibility surfaces
// (hidden-count, tray, restored notice, Review detail) are wired. Assertions
// target stable identifiers, not layout.
//
// Run: node --test test/bulkComposerAudienceSafety.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src/components/connect/BulkManualComposer.jsx'), 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── The composer defers to the tested audience model ────────────────────────

test('the composer imports every audience rule from the tested lib and defines none locally', () => {
  assert.match(code, /from '\.\.\/\.\.\/lib\/connect\/bulkAudience'/)
  for (const fn of ['buildCombinedRecipients', 'selectableShownStudentIds', 'visibleSelectionSplit',
    'notProceedingRecipients', 'buildPayloadRecipients']) {
    assert.match(code, new RegExp(`\\b${fn}\\b`), `${fn} is used`)
  }
  assert.doesNotMatch(code, /function studentToRecipient|function contactToRecipient/,
    'no local shadow of the audience model remains')
  assert.doesNotMatch(code, /dedupeRecipients\(/, 'dedupe happens only inside the tested lib')
})

test('the send payload comes from buildPayloadRecipients - no ad-hoc mapping', () => {
  assert.match(code, /const payloadRecipients = buildPayloadRecipients\(recipients, \{ ackNotProceeding \}\)/)
  assert.doesNotMatch(code, /payloadRecipients = recipients\.map/)
})

test("'Select all shown' selects only displayed, eligible students via the policy helper", () => {
  const fn = code.slice(code.indexOf('const selectAllStudents'), code.indexOf('const selectAllContacts'))
  assert.match(fn, /selectableShownStudentIds\(filteredStudents\)/)
  assert.doesNotMatch(fn, /students\.forEach|filteredStudents\.forEach/,
    'no direct roster iteration bypasses the Not Proceeding exclusion')
})

// ── Lifecycle resets ────────────────────────────────────────────────────────

test('changing cohorts clears every selection store', () => {
  const at = code.indexOf('hydratedCohort !== cohortId')
  assert.ok(at > -1, 'the cohort-change adjust exists')
  const block = code.slice(at, at + 600)
  for (const reset of ['setStudentSel(new Set())', 'setContactSel(new Set())', 'setPicked([])',
    'setRestoredAudience(0)', 'setAckNotProceeding(false)']) {
    assert.ok(block.includes(reset), `cohort change performs ${reset}`)
  }
})

test('a successful send clears ALL recipient-selection state in the same commit', () => {
  const at = code.indexOf('setSendResult(data)')
  assert.ok(at > -1)
  assert.match(code.slice(at, at + 400), /clearAll\(\)/,
    'a completed audience can never leak into the next send')
})

test('clearAll resets the audience stores AND the safety state', () => {
  const fn = code.slice(code.indexOf('const clearAll'), code.indexOf('const removeRecipient'))
  for (const reset of ['setStudentSel(new Set())', 'setContactSel(new Set())', 'setPicked([])',
    'setRestoredAudience(0)', 'setAckNotProceeding(false)']) {
    assert.ok(fn.includes(reset), `clearAll performs ${reset}`)
  }
})

test('selected contacts load eagerly so a restored contact selection resolves immediately', () => {
  assert.match(code, /source !== 'contacts' && contactSel\.size === 0/,
    'the contacts fetch fires for a non-empty contactSel even when the tab was never opened')
})

// ── Hidden selections are never silent ──────────────────────────────────────

test('the composer computes and surfaces the hidden-selection count', () => {
  assert.match(code, /visibleSelectionSplit\(\{ recipients, source, filteredStudents, filteredContacts, picked \}\)/)
  assert.match(code, /data-testid="hidden-selection-warning"/)
  assert.match(code, /not shown by the current view or filters/)
})

test('a persistent tray lists every selected recipient with a remove control', () => {
  assert.match(code, /data-testid="selected-recipient-tray"/)
  const tray = code.slice(code.indexOf('data-testid="selected-recipient-tray"'), code.indexOf('data-testid="selected-recipient-tray"') + 2400)
  assert.match(tray, /recipients\.map\(/, 'the tray renders the FULL audience, not the filtered view')
  assert.match(tray, /removeRecipient\(r\)/)
})

test('removeRecipient cleans all three selection stores', () => {
  const fn = code.slice(code.indexOf('const removeRecipient'), code.indexOf('const onTypeaheadSelect'))
  assert.match(fn, /setStudentSel/)
  assert.match(fn, /setContactSel/)
  assert.match(fn, /setPicked/)
})

test('a restored draft audience raises a persistent notice, not a 2-second flash', () => {
  assert.match(code, /setRestoredAudience\(restoredCount\)/, 'the hydrate records what it restored')
  assert.match(code, /data-testid="restored-audience-notice"/)
  assert.match(code, /restored<\/strong> from\s*\n?\s*your saved draft/)
})

// ── The Review contract ─────────────────────────────────────────────────────

test('Review shows total, duplicates, and the hidden-from-view count', () => {
  assert.match(code, /recipient\{recipients\.length === 1 \? '' : 's'\} total \(deduped\)/)
  assert.match(code, /not visible in the current audience view/)
})

test('Review rows carry school/organization and status', () => {
  const row = code.slice(code.indexOf('{recipients.map(r => {', code.indexOf('PRE-SEND REVIEW')))
  assert.match(row, /r\.school \|\| r\.organization/, 'school/organization rendered per row')
  assert.match(row, /r\.status/, 'student status rendered per row')
})

test('Not Proceeding recipients require an explicit Review acknowledgment before the send unlocks', () => {
  assert.match(code, /data-testid="not-proceeding-warning"/)
  assert.match(code, /const needsNpAck = notProceeding\.length > 0 && !ackNotProceeding/)
  assert.match(code, /!needsNpAck &&/, 'canSend is gated on the acknowledgment')
  assert.match(code, /notProceedingRecipients\(recipients\)\.length > 0 && !ackNotProceeding\) return/,
    'the click handler re-checks at send time (defense in depth)')
})

test('the acknowledgment resets when the review closes or the draft/audience changes', () => {
  assert.match(code, /const ackContext = `\$\{reviewOpen\}\|\$\{draftSig\}`/)
  assert.match(code, /if \(ackSeenContext !== ackContext\)/)
})

// ── Unchanged boundaries ────────────────────────────────────────────────────

test('the typed confirmation, batch id, and recipient ceiling are untouched', () => {
  assert.match(code, /CONFIRM_PHRASE = 'SEND MESSAGES'/)
  assert.match(code, /crypto\.randomUUID\(\)/)
  assert.match(code, /MAX_RECIPIENTS = 75/)
})

test('the composer still never imports the student routing resolver', () => {
  assert.doesNotMatch(code, /resolveStudentCorrespondenceRecipient/)
})
