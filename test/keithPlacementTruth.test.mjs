// test/keithPlacementTruth.test.mjs
//
// KEITH-PLACEMENT-TRUTH-1 + KEITH-CONTACT-ASK-1 (Owner, 2026-10-03). In one conversation Keith wrote
// a unit PREFERENCE (then a unit from nowhere) into a preceptor email, did not know the student's
// secondary preceptor, and answered a statement and a pasted email template with an unrelated list
// of preceptors. These tests are built from that conversation.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyIntent, INTENTS, isContactLookupAsk } from '../lib/server/keith/queryIntent.js'
import { placementFor } from '../lib/server/keith/studentPlacement.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const TEMPLATE = `Preceptor Assignment & Details  Dear Brett,  Thank you for agreeing to precept one of our senior nursing students through ASPIRE. Your willingness to teach, mentor, and support our students makes a meaningful difference.  Student Assignment Summary  Student: [Student Name]  A Few Quick Reminders  Preceptor pay: You may be eligible, please reach out to Dr. Krystal Rodriguez with any questions.  Coverage: If possible, please avoid being in charge while precepting.`

test('a statement or a pasted draft that mentions a preceptor reaches Keith, not the contact list', () => {
  for (const said of ["brett is Katrina's secondary preceptor", 'Brett is her secondary preceptor', TEMPLATE, 'it should be something like this - ' + TEMPLATE]) {
    assert.notEqual(classifyIntent(said), INTENTS.PERSON_CONTACT_ROLE, said.slice(0, 50))
    assert.equal(isContactLookupAsk(said), false, said.slice(0, 50))
  }
})

test('a real lookup still goes to Contacts', () => {
  for (const asked of [
    'who are the preceptors on PACU?', 'who is the NPD-P for 5 South', 'who is Brett Tramont', 'preceptors for PACU', 'unit leaders 6 South',
    'list the academic partners for CSUN', 'contact for the unit leader of 8 South',
    'Who should I contact for a prelicensure group clinical request that is not an ASPIRE senior bedside preceptorship?',
  ]) {
    assert.equal(classifyIntent(asked), INTENTS.PERSON_CONTACT_ROLE, asked)
  }
  // A drafting request is still drafting.
  assert.equal(classifyIntent('write a draft email to Brett Tramont to thank him for agreeing to precept ASPIRE student Katrina Dang'), INTENTS.EMAIL_DRAFTING)
})

/** A fake client: each table answers with the rows given, through the chain the module uses. */
function fakeDb(tables) {
  const seen = []
  return {
    seen,
    from(t) {
      const rows = tables[t]
      const q = {
        select() { return q }, eq(c, v) { seen.push([t, c, v]); return q }, in(c, v) { seen.push([t, c, v]); return q },
        maybeSingle: async () => ({ data: Array.isArray(rows) ? rows[0] || null : rows || null, error: null }),
        then(res, rej) { return Promise.resolve({ data: rows ?? [], error: null }).then(res, rej) },
      }
      return q
    },
  }
}
const KATRINA = { id: 'stu-1', matched_unit_id: 'unit-9', matched_preceptor: 'Jon Zyvon Ramos', unit_preference_1: '5 SCCT' }

test('the lookup returns the assigned unit BY NAME and every active preceptor with their role', async () => {
  const db = fakeDb({
    units: [{ unit_name: '4 North Tower' }],
    student_unit_assignments: [{ unit_key: '4 North Tower', role: 'primary', status: 'active' }],
    student_preceptor_assignments: [
      { role: 'secondary', status: 'active', preceptors: { full_name: 'Brett Tramont' } },
      { role: 'primary', status: 'active', preceptors: { full_name: 'Jon Zyvon Ramos' } },
    ],
  })
  const p = await placementFor(db, KATRINA)
  assert.equal(p.assigned_unit, '4 North Tower', 'the unit by name, never the first preference')
  assert.notEqual(p.assigned_unit, KATRINA.unit_preference_1)
  assert.deepEqual(p.preceptors, [{ name: 'Jon Zyvon Ramos', role: 'primary' }, { name: 'Brett Tramont', role: 'secondary' }])
  assert.deepEqual(p.unit_assignments, [{ unit: '4 North Tower', role: 'primary', status: 'active' }])
  assert.match(p.note, /NEVER the assignment/)
  // Only this student's rows, and only live ones.
  assert.ok(db.seen.some(([t, c, v]) => t === 'units' && c === 'id' && v === 'unit-9'))
  assert.ok(db.seen.some(([t, c, v]) => t === 'student_preceptor_assignments' && c === 'student_id' && v === 'stu-1'))
  assert.ok(db.seen.some(([t, c, v]) => t === 'student_preceptor_assignments' && c === 'status' && v === 'active'))
  assert.ok(db.seen.some(([t, c, v]) => t === 'student_unit_assignments' && c === 'status' && JSON.stringify(v) === '["planned","active"]'))
})

test('nothing recorded reads "Not recorded" in words, never a guess', async () => {
  const p = await placementFor(fakeDb({ units: [], student_unit_assignments: [], student_preceptor_assignments: [] }), { id: 'stu-2', unit_preference_1: '5 SCCT' })
  assert.deepEqual([p.assigned_unit, p.unit_assignments, p.preceptors], ['Not recorded', 'Not recorded', 'Not recorded'])
  // The legacy single preceptor on the row still counts when no assignment rows exist.
  const legacy = await placementFor(fakeDb({ units: [], student_unit_assignments: [], student_preceptor_assignments: [] }), { id: 'stu-3', matched_preceptor: 'Jon Zyvon Ramos' })
  assert.deepEqual(legacy.preceptors, [{ name: 'Jon Zyvon Ramos', role: 'primary' }])
  // A unit known only from an assignment row is still named.
  const fromRow = await placementFor(fakeDb({ units: [], student_unit_assignments: [{ unit_key: '6 NE', role: 'primary', status: 'planned' }], student_preceptor_assignments: [] }), { id: 'stu-4' })
  assert.equal(fromRow.assigned_unit, '6 NE')
})

test('Keith is told the placement is the source, and a preference never is', () => {
  const k = read('api/keith.js')
  assert.match(k, /import \{ placementFor \} from '\.\.\/lib\/server\/keith\/studentPlacement\.js'/)
  assert.match(k, /const placement = await placementFor\(supabase, student\)/)
  assert.match(k, /student: stripSensitive\(resolvedStudent\),\s+placement,/)
  assert.match(k, /A unit preference \(unit_preference_1\/2\/3\) or an interviewer's suggested_unit is NEVER the assigned unit/)
  assert.match(k, /If the user is told a value is wrong, re-read the record before answering again/)
  // The placement is read AFTER the cohort check, so a refused student reads nothing more.
  assert.ok(k.indexOf('if (!cohortAllowed(scope, student.cohort_id)) return { error: STUDENT_REFUSED }') < k.indexOf('const placement = await placementFor('))
})
