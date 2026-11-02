// FEEDBACK-MODAL-1 (Owner, 2026-11-02): the roster's Preceptor feedback chip opens the latest
// feedback, End of Rotation before Midpoint; Talent Acquisition still opens it only under the
// Transition Form's consent, and a staff open writes no Talent Acquisition view.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { latestFeedback, chipOpens, feedbackTarget } from '../src/lib/ngrp/feedbackPick.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

test('the latest End of Rotation, else the latest Midpoint, else the latest of anything', () => {
  const mid1 = { period: 'Midpoint', submittedAt: '2026-08-01T00:00:00Z' }
  const mid2 = { period: 'Midpoint', submittedAt: '2026-08-20T00:00:00Z' }
  const end = { period: 'End of Rotation', submittedAt: '2026-08-10T00:00:00Z' }
  const other = { period: 'Other / Interim Check-In', submittedAt: '2026-09-01T00:00:00Z' }
  assert.equal(latestFeedback([mid1, end, mid2, other]), end, 'a newer midpoint does not outrank the end of rotation')
  assert.equal(latestFeedback([mid1, mid2, other]), mid2)
  assert.equal(latestFeedback([other]), other)
  assert.equal(latestFeedback([]), null)
})

test('who the chip opens for, and what it asks for', () => {
  const owner = { audience: 'staff', canDecide: true }
  const coLead = { audience: 'staff', canDecide: false }
  const ta = { audience: 'talent_acquisition' }
  assert.equal(chipOpens({ count: 2 }, owner), true, 'Owner and Admin, when any is on file')
  assert.equal(chipOpens({ count: 2 }, coLead), false, 'the rest of the team sees the chip, not the content')
  assert.equal(chipOpens({ available: true, canView: false }, ta), true, 'Talent Acquisition sees why it is closed')
  assert.equal(chipOpens({ count: 0 }, owner), false)
  assert.equal(chipOpens(null, owner), false)
  const row = { candidate_id: 'k1' }
  assert.deepEqual(feedbackTarget(row, { count: 1 }, 'staff'), { candidate_id: 'k1' })
  assert.deepEqual(feedbackTarget(row, { canView: true }, 'talent_acquisition'), { candidate_id: 'k1' })
  assert.deepEqual(feedbackTarget(row, { canView: false, request: { id: 'r1', status: 'approved' } }, 'talent_acquisition'), { request_id: 'r1' })
  assert.equal(feedbackTarget(row, { canView: false }, 'talent_acquisition'), null, 'before the form: nothing is fetched')
  assert.equal(feedbackTarget({}, { count: 1 }, 'staff'), null)
})

test('the chip is a button that stops the row, and the dialog is the binder\'s own entry', () => {
  const chip = read('src/components/ngrp/PreceptorFeedbackChip.jsx')
  assert.match(chip, /onClick=\{e => \{ stop\(e\); onOpen\(\) \}\} onKeyDown=\{stop\}/)
  const dlg = read('src/components/ngrp/PreceptorFeedbackDialog.jsx')
  assert.match(dlg, /import \{ FeedbackEntry \} from '\.\/ApplicantDrawer'/)
  assert.match(dlg, /role="dialog" aria-modal="true"/)
  assert.match(dlg, /useDialogKeys\(ref, onClose\)/)
  assert.match(dlg, /\}, \[key, onLoad\]\)/, 'one fetch per open: a TA open is logged')
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /const loadFeedback = useCallback\(target => postNgrpPreceptorFeedback\('view', target\), \[\]\)/, 'stable, so the dialog never refetches')
  assert.match(tab, /<PreceptorFeedbackDialog/)
  assert.equal((tab.match(/chipOpens\(feedback\.byStudent\[[^\]]+\], feedback\)/g) || []).length, 2, 'both chips open it, under one rule')
})

test('a staff open checks the candidate and writes no view event', () => {
  const api = read('api/ngrp-preceptor-feedback.js')
  const staff = api.slice(api.indexOf('if (!isTA) {\n      if (!isAdminLevel'), api.indexOf("if (body.candidate_id !== undefined"))
  assert.match(staff, /if \(!isAdminLevel\(caller\.profile\)\) return res\.status\(403\)/, 'Owner and Admin, as in Evaluation')
  assert.match(staff, /from\('ngrp_candidates'\)\.select\('id, student_id'\)\.eq\('id', candidateId\)/)
  assert.match(staff, /return res\.status\(404\)\.json\(\{ error: 'candidate_not_found' \}\)/)
  assert.match(staff, /shapePreceptorFeedback\(fb\.data \|\| \[\]\)/)
  assert.doesNotMatch(staff, /insert\(/)
})
