// Commit 3: shared role-safe evaluation reporting components. Display-logic unit tests plus
// source guards that the components stay role-safe (no identity/preceptor/free text/dates)
// and the modal is an accessible dialog.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  metricLabel, metricKind, instrumentLabel, fmtMetric, QUANT_METRIC_META,
  APPROVED_UL_INSTRUMENTS, NO_APPROVED_METRICS_MESSAGE,
} from '../src/lib/unitEvaluationDisplay.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
// Scan CODE only — the components' own comments legitimately describe what they must NOT show
// (e.g. "No composite score", "must not display preceptor"), so strip comments before guarding.
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

test('display metadata covers exactly the five approved paths and two instruments', () => {
  assert.equal(Object.keys(QUANT_METRIC_META).length, 5)
  assert.equal(metricLabel('overall_experience.overall_rating'), 'Overall Experience')
  assert.equal(metricKind('developmental_feedback.context.shifts_observed'), 'context')  // context, not outcome
  assert.equal(metricKind('readiness_endorsement.transition_readiness'), 'outcome')
  assert.deepEqual(APPROVED_UL_INSTRUMENTS.map(i => i.slug).sort(), ['preceptor_progress', 'student_preceptor_eval'])
  assert.equal(instrumentLabel('student_preceptor_eval'), 'Preceptor & Unit Feedback')
})
test('fmtMetric formats integers plainly and decimals to two places; blanks on non-numbers', () => {
  assert.equal(fmtMetric(4), '4')
  assert.equal(fmtMetric(4.5), '4.50')
  assert.equal(fmtMetric(null), '—')
  assert.equal(fmtMetric('x'), '—')
})
test('the no-approved-metrics message is the exact required copy', () => {
  assert.equal(NO_APPROVED_METRICS_MESSAGE,
    'Released responses are available, but no approved quantitative metrics are configured for display.')
})

test('the reporting primitives are role-safe (no identity/preceptor/free-text fields)', () => {
  const rep = code('src/components/evaluation/shared/EvalReporting.jsx')
  for (const bad of ['student_name', 'first_name', 'last_name', 'email', 'preceptor', 'narrative',
    'free_text', 'response_id', 'released_at', 'moderation', 'released_by', 'submitted_at']) {
    assert.ok(!rep.includes(bad), `reporting components must not reference ${bad}`)
  }
  // No invented composite score, and context metrics are tagged (not treated as outcomes).
  assert.ok(!/composite|overall_score|total_score/i.test(rep))
  assert.match(rep, /metricKind\(path\) === 'context'/)
  // The no-approved-metrics state exists.
  assert.match(rep, /export function EvalNoMetrics/)
})

test('the quantitative modal is role-safe and an accessible dialog', () => {
  const modal = code('src/components/evaluation/shared/EvalQuantModal.jsx')
  // Role-safe: opens from the in-memory row, shows only allowlisted quantitative fields.
  for (const bad of ['student', 'preceptor', 'narrative', 'free_text', 'response_id',
    'released_at', 'revoked_at', 'moderation', 'notes', 'public_token', 'created_at', 'email']) {
    assert.ok(!modal.includes(bad), `modal must not reference ${bad}`)
  }
  assert.match(modal, /metricPaths/)                          // only allowlisted paths rendered
  assert.match(modal, /response\.quantitative\[p\]/)
  // Accessible dialog: role, aria-modal, Escape close, focus trap, focus restoration.
  assert.match(modal, /role="dialog"/)
  assert.match(modal, /aria-modal="true"/)
  assert.match(modal, /e\.key === 'Escape'/)
  assert.match(modal, /prev\?\.focus/)                        // focus restoration
  assert.match(modal, /e\.key !== 'Tab'/)                     // focus trap
  assert.match(modal, /overflowY: 'auto'/)                    // internal scroll
  assert.match(modal, /Quantitative responses only/)          // states its own limit
})
