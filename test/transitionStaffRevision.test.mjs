// TRANSITION-STAFF-REVISION-1 (Owner, 2026-11-05): an alumnus's answer changed (Allison Rabanales
// scheduled her NCLEX after submitting "No") and they asked the team to change it. The Owner or
// an Admin saves a NEW revision for them, through the alumnus's own form rules.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runTransitionAction } from '../lib/server/ngrpTransitionActions.js'

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

// A chainable fake: from(table) answers that table's rows; rpc records its call.
function fakeDb(tables, rpcResult = { data: { revision_number: 3 }, error: null }) {
  const calls = { rpc: [], updates: [] }
  const from = table => {
    const q = {
      select: () => q, eq: () => q, order: () => q, in: () => q,
      update: v => { calls.updates.push({ table, v }); return q },
      maybeSingle: async () => ({ data: (tables[table] || [])[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: tables[table] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { from, rpc: async (name, args) => { calls.rpc.push({ name, args }); return rpcResult }, calls }
}

const cycle = { id: 'cy', name: 'Winter 2027', qualification_rules: null, application_checklist: null }
const assignment = { id: 'as', status: 'submitted', revision_count: 2, submitted_at: '2026-10-20T00:00:00Z' }
const candidate = { id: 'ca', student_id: 'st' }
const tables = {
  ngrp_cycle_units: [{ unit_name: '6 NE', is_active: true }],
  students: [{ first_name: 'Allison', last_name: 'R', status: 'Completed', school_email: 'a@school.edu', personal_email: 'a@gmail.com' }],
  ngrp_transition_drafts: [{ payload: { draft: true }, saved_at: '2026-11-01T00:00:00Z' }],
  ngrp_transition_revisions: [{ payload: { submitted: true } }],
}

test('staff load reads the latest SUBMITTED revision, never the draft, and opens even when closed', async () => {
  const db = fakeDb(tables)
  const out = await runTransitionAction(db, { action: 'load', resolved: { closed: true, assignment, candidate, cycle },
    nowIso: '2026-11-05T00:00:00Z', staff: { profileId: 'pr' } })
  assert.equal(out.status, 200)
  assert.equal(out.json.state, 'form')
  assert.deepEqual(out.json.base, { submitted: true })
  assert.equal(out.json.baseKind, 'revision')
  assert.equal(out.json.alumnusDraftAt, '2026-11-01T00:00:00Z')
  assert.equal(db.calls.updates.length, 0, 'no first-open bookkeeping for staff')
})

test('staff never save a draft, and a submit needs a reason', async () => {
  const db = fakeDb(tables)
  const resolved = { closed: false, assignment, candidate, cycle }
  const draft = await runTransitionAction(db, { action: 'save_draft', body: { payload: {} }, resolved, staff: { profileId: 'pr' } })
  assert.equal(draft.status, 400)
  const noReason = await runTransitionAction(db, { action: 'submit', body: { payload: {}, reason: '  ' }, resolved, staff: { profileId: 'pr' } })
  assert.equal(noReason.status, 422)
  assert.equal(db.calls.rpc.length, 0)
})

test('the submit goes through ngrp_staff_revision_tx with who and why, never the alumnus transaction', () => {
  const src = read('lib/server/ngrpTransition.js')
  const fn = src.slice(src.indexOf('export async function staffRevision'), src.indexOf('// Recalculate from the given'))
  assert.match(fn, /rpc\('ngrp_staff_revision_tx'/)
  assert.match(fn, /p_actor_profile_id: actorProfileId/)
  assert.match(fn, /p_reason: reason/)
  assert.match(fn, /computeEligibility\(/)
  assert.doesNotMatch(fn, /ngrp_submit_revision_tx/)
})

test('the migration keeps every earlier revision, skips the window, records staff, and is server-only', () => {
  const m = read('supabase/migrations/20261129000000_transition_staff_revision.sql')
  assert.match(m, /ADD COLUMN IF NOT EXISTS entered_by_profile_id/)
  assert.match(m, /ADD COLUMN IF NOT EXISTS entered_reason/)
  assert.match(m, /v_next := a\.revision_count \+ 1/)
  assert.doesNotMatch(m, /NGRP_CLOSED/)
  assert.doesNotMatch(m, /DELETE FROM public\.ngrp_transition_revisions/)
  assert.doesNotMatch(m, /DELETE FROM public\.ngrp_transition_drafts/)
  assert.match(m, /'form_revised', cand\.cycle_id[^;]+'staff', p_actor_profile_id/)
  assert.match(m, /COALESCE\(a\.revision_count, 0\) < 1 THEN\s+RAISE EXCEPTION 'NGRP_GONE'/)
  assert.match(m, /GRANT EXECUTE ON FUNCTION public\.ngrp_staff_revision_tx\([^)]+\) TO service_role/)
  assert.match(m, /REVOKE ALL ON FUNCTION public\.ngrp_staff_revision_tx\([^)]+\) FROM PUBLIC, anon, authenticated/)
})

test('only the Owner and Admins, and only a submitted form', () => {
  const manage = read('api/ngrp-manage.js')
  assert.match(manage, /'form_staff_load', 'form_staff_submit'/)
  const block = manage.slice(manage.indexOf("if (action === 'form_staff_load' || action === 'form_staff_submit')"))
  assert.match(block.slice(0, 600), /if \(isTalentAcquisition \|\| !ownerOrAdmin\) return res\.status\(403\)/)
  assert.match(block.slice(0, 1200), /revision_count > 0\)\) \{\s+return res\.status\(409\)\.json\(\{ error: 'not_submitted' \}\)/)
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /updateAnswers: staffApp && ownerAdmin \?/)
})

test('the editor is the alumnus form itself, with a required reason and no autosave', () => {
  const page = read('src/pages/NgrpTransitionFormPage.jsx')
  assert.match(page, /if \(initial\.preview \|\| initial\.staff\) return/)
  assert.match(page, /Why are you changing these answers\?/)
  assert.match(page, /Save as a new revision/)
  const editor = read('src/components/ngrp/UpdateAnswersEditor.jsx')
  assert.match(editor, /NgrpTransitionFormPage staff=\{staff\}/)
  assert.match(editor, /'form_staff_load' : 'form_staff_submit'/)
  const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(drawer, /Update Answers/)
  assert.match(drawer, /Entered by/)
})
