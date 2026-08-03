// PRECEPTOR-FREETEXT-REPLACE-1: the legacy free-text preceptor editor is retired.
//
// The Student Side Panel's unlinked state is now a READ-ONLY "Unlinked legacy
// entry" display; the only way to change a primary preceptor is the canonical
// PreceptorAssignmentModal -> /api/preceptor-primary-assign ->
// assign_primary_preceptor RPC, whose sync trigger rewrites the display
// mirrors from the selected record. The broken preceptor-email input is
// deleted, not repaired. Match-revert keeps its current shape by explicit
// decision (no canonical primary-clear workflow exists yet); these pins make
// any future change to that shape deliberate.
//
// Run: node --test test/preceptorFreetextReplacement.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const panel = read('src/components/StudentSidePanel.jsx')
const modal = read('src/components/PreceptorAssignmentModal.jsx')
const appjs = read('src/App.jsx')

// ── Read-only legacy display ─────────────────────────────────────────────────

test('the unlinked state is a read-only legacy display, never inputs', () => {
  assert.match(panel, /Unlinked legacy entry/)
  // The legacy name and email render as text from the shared resolver.
  assert.match(panel, /\{resolved\.name && \(\n\s+<span style=\{\{ fontSize:13, fontWeight:600/)
  assert.match(panel, /openOutlookCompose\(\{ to: resolved\.email \}\)/)
  // No editable binding to either free-text column survives anywhere.
  assert.doesNotMatch(panel, /value=\{data\.matched_preceptor/)
  assert.doesNotMatch(panel, /value=\{data\.preceptor_email/)
  assert.doesNotMatch(panel, /placeholder="Preceptor name…"/)
})

test('the broken preceptor-email input is deleted, not repaired', () => {
  assert.doesNotMatch(panel, /placeholder="preceptor@cshs\.org"/)
  // And no editable email field of any kind sits in the preceptor section.
  assert.doesNotMatch(panel, /handleText\('preceptor_email'/)
})

// ── Permission gating ────────────────────────────────────────────────────────

test('Link to preceptor record is the one action and is canEdit-gated', () => {
  const occurrences = panel.split('Link to preceptor record').length - 1
  assert.equal(occurrences, 1, 'exactly one Link action')
  // The action lives inside the canEdit guard and opens the canonical modal.
  assert.match(panel, /\{canEdit && \(\n\s+<button onClick=\{\(\) => setAssignModalOpen\(true\)\}[\s\S]{0,400}?Link to preceptor record/)
  // Non-Owner/Admin readers get the read-only display with no editable field:
  // the badge and text render outside the guard, the button inside it.
  const badgeIdx = panel.indexOf('Unlinked legacy entry')
  const guardIdx = panel.indexOf('Link to preceptor record')
  assert.ok(badgeIdx > -1 && guardIdx > badgeIdx, 'badge renders before the gated action')
})

// ── No free-text save path ───────────────────────────────────────────────────

test('no free-text preceptor save path remains in the panel', () => {
  // The explicit placement action now carries the shift only.
  assert.match(panel, /if \(field === 'shift_assigned'\) \{/)
  assert.doesNotMatch(panel, /field === 'matched_preceptor'/)
  assert.doesNotMatch(panel, /handleText\('matched_preceptor'/)
})

test('the panel still mirrors a successful link locally exactly as the trigger writes it', () => {
  // onAssigned merges the canonical record's identity + display fields; this is
  // a local-state echo of the server-side sync, not a write path.
  assert.match(panel, /preceptor_id:\s+preceptor\.id,\n\s+matched_preceptor: preceptor\.full_name,\n\s+preceptor_email:\s+preceptor\.email,/)
})

// ── Canonical modal and RPC ──────────────────────────────────────────────────

test('all primary linking resolves to a preceptor record id through the audited endpoint', () => {
  assert.match(modal, /fetch\('\/api\/preceptor-primary-assign'/)
  assert.match(modal, /body: JSON\.stringify\(\{ requestId, studentId, preceptorId \}\)/)
  // Lookup is by name OR email, resolved to a canonical record - never saved as text.
  assert.match(modal, /full_name\.ilike\.%\$\{q\}%,email\.ilike\.%\$\{q\}%/)
})

test('already-linked students keep the canonical Change preceptor flow', () => {
  assert.match(panel, /resolved\.source === 'normalized' \?/)
  assert.match(panel, /Change preceptor/)
})

// ── Match-revert guard (decision pending; shape pinned) ──────────────────────

test('match-revert still never touches the canonical identity directly', () => {
  // App.jsx contains NO reference to preceptor_id at all: reverts clear only
  // display fields, and no direct client write of the canonical field was
  // invented. The surviving hidden primary after a revert is a recorded
  // product decision (canonical primary-clear workflow does not exist yet).
  assert.doesNotMatch(appjs, /preceptor_id/)
  assert.match(appjs, /matched_unit_id: null, matched_preceptor: '', shift_assigned: '', interview_outcome: 'Pending Interview'/)
  assert.match(appjs, /matched_unit_id: null, matched_preceptor: '', shift_assigned: '', match_quality: null/)
})

// ── Existing workflows stay pinned ───────────────────────────────────────────

test('secondary/coverage, staff manager, and the integrity monitor are untouched', () => {
  assert.match(read('src/components/AdditionalPreceptors.jsx'), /\/api\/preceptor-assignments/)
  assert.match(read('src/lib/staffPreceptorAssignmentApi.js'), /\/api\/preceptor-assignment-manage/)
  const parity = read('src/components/settings/PreceptorParityPanel.jsx')
  assert.match(parity, /READ-ONLY: only \.select\(\) calls\. Writes NOTHING to any table/)
  assert.match(parity, /Preceptor Assignment Integrity/)
})
