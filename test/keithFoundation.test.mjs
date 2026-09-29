// test/keithFoundation.test.mjs
//
// KEITH-FOUNDATION-1 (2026-09-28): the Skill runner, provenance, shadow mode and the Program Budget
// retrofit, on real Postgres (PGlite) with the real migrations, the same world as
// test/budgetReceipts.test.mjs plus supabase/migrations/20261016000000_keith_foundation.sql.
//
//   - the pure rules: states, transitions, the diff merge, the agreement figure, who is staff
//   - the schema validator, and every Skill's schema uses only what it checks
//   - a SAMPLE skill end to end: off refuses, undeclared input throws, invalid output is dropped
//     (metered, no provenance), a good run is metered and writes one drafted provenance row, shadow
//     mode records without acting, the agreement helper counts, the Owner switches modes with the
//     figure logged
//   - receipts: a reading writes provenance; edit, accept, reject and undo move it; the Sheet's rows
//     carry it for the Owner only; the export never does
//   - the card: only what a caller may see, and nothing for a portal user
//   - the migration: output is immutable, nothing is deleted, the backfill tells edited from accepted

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const P = await import('../src/lib/keith/provenanceModel.js')
const S = await import('../lib/server/keith/outputSchema.js')
const K = await import('../lib/server/keith/runKeithSkill.js')
const D = await import('../lib/server/keith/skillDefs.js')
const C = await import('../lib/server/keith/provenanceCards.js')
const R = await import('../lib/server/budget/receipts.js')
const E = await import('../lib/server/budget/engine.js')
const { createKeithProvenanceHandler } = await import('../api/keith-provenance.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-27'
const FOUNDATION = runnable(read('supabase/migrations/20261016000000_keith_foundation.sql'))

const AMAZON = {
  document_type: 'order_confirmation', vendor: 'Amazon', order_number: '112-7730158-4402217', date: '2026-09-03', date_confidence: 'high',
  card_last4: '4417', subtotal: 53.49, tax: 5.08, shipping: 0, tip: 0, total: 58.57,
  lines: [
    { item: 'Copy Paper, 5-Ream Case', quantity: 1, amount: 38.99, category: 'Printing & Copying', confidence: 'high', reason: 'Paper for printed orientation packets.' },
    { item: 'Name Badge Labels', quantity: 2, amount: 14.50, category: 'Supplies & Materials', confidence: 'medium', reason: 'Badges for orientation.' },
  ],
  unreadable_fields: [], has_shipping_address: true,
}

// ── The pure rules ──────────────────────────────────────────────────────────────

test('states move only the way a person can move them', () => {
  const t = (s, a, prior) => P.nextState(s, a, { prior })
  assert.equal(t('drafted', 'edit'), 'edited')
  assert.equal(t('drafted', 'accept'), 'accepted')
  assert.equal(t('edited', 'accept'), 'edited', 'accepted with changes still reads Edited')
  assert.equal(t('accepted', 'edit'), null, 'an accepted output is not edited in place')
  assert.equal(t('accepted', 'undo', 'drafted'), 'drafted')
  assert.equal(t('edited', 'undo', 'edited'), 'edited')
  assert.equal(t('rejected', 'undo', 'drafted'), 'drafted')
  assert.equal(t('drafted', 'reject'), 'rejected')
  assert.equal(t('accepted', 'revert'), 'reverted')
  assert.equal(t('drafted', 'observe'), 'drafted')
  assert.equal(t('drafted', 'nonsense'), null)
  assert.deepEqual(P.STATES.map(P.markFor), ['drafted', 'edited', 'accepted', null, null], 'rejected and reverted draw nothing')
})

test('the mark’s accessible names are the three the brief names', () => {
  assert.equal(P.accessibleName('drafted'), 'Drafted by Keith. Show details')
  assert.equal(P.accessibleName('edited'), 'Edited after Keith drafted it. Show details')
  assert.equal(P.accessibleName('accepted'), 'Suggested by Keith, accepted. Show details')
  assert.equal(P.accessibleName('rejected'), '')
})

test('edits merge per field and line: Keith’s value stays the from, a change back drops out', () => {
  const a = P.mergeDiff([], [{ field: 'line.category', line: 'l1', item: 'Paper', from: 'Printing', to: 'Supplies' }])
  const b = P.mergeDiff(a, [{ field: 'line.category', line: 'l1', item: 'Paper', from: 'Supplies', to: 'Misc' }])
  assert.deepEqual(b, [{ field: 'line.category', line: 'l1', item: 'Paper', from: 'Printing', to: 'Misc' }])
  assert.deepEqual(P.mergeDiff(b, [{ field: 'line.category', line: 'l1', from: 'Misc', to: 'Printing' }]), [], 'back to Keith’s own value')
  assert.deepEqual(P.mergeDiff([{ field: 'line', line: 'n1', added: 'Pens' }], [{ field: 'line', line: 'n1', removed: 'Pens' }]), [], 'added then removed')
})

test('the agreement figure: total, agreed, and each of Keith’s labels', () => {
  const a = P.computeAgreement([
    { keith: 'thanks', human: 'thanks' }, { keith: 'thanks', human: 'thanks' }, { keith: 'thanks', human: 'needs_look' },
    { keith: 'request', human: 'request' }, { keith: 'request', human: null }, { keith: null, human: 'request' },
  ])
  assert.deepEqual(a, { total: 4, agreed: 3, rate: 0.75, byLabel: { thanks: { total: 3, agreed: 2 }, request: { total: 1, agreed: 1 } } })
  assert.equal(P.agreementPercent(a), '75%')
  assert.equal(P.agreementPercent(P.computeAgreement([])), '–')
})

test('staff see the mark; students, schools, preceptors and leadership never do', () => {
  for (const role of ['admin', 'co-lead', 'co_lead', 'interviewer', 'viewer']) assert.equal(P.isStaffViewer({ role }), true, role)
  assert.equal(P.isStaffViewer({ role: 'owner', is_owner: true }), true)
  for (const role of ['student', 'academic_partner', 'school', 'preceptor', 'unit_leader', 'nursing_academic', 'resident', '', undefined]) {
    assert.equal(P.isStaffViewer({ role }), false, String(role))
  }
  assert.equal(P.isStaffViewer(null), false)
})

test('a skill is off unless active and enabled, and on unless its run_mode says shadow', () => {
  assert.equal(P.skillMode(null), 'off')
  assert.equal(P.skillMode({ status: 'draft', enabled: true }), 'off')
  assert.equal(P.skillMode({ status: 'active', enabled: false, run_mode: 'shadow' }), 'off')
  assert.equal(P.skillMode({ status: 'active', enabled: true }), 'on', 'before the migration there is no run_mode')
  assert.equal(P.skillMode({ status: 'active', enabled: true, run_mode: 'shadow' }), 'shadow')
})

// ── The schema validator ────────────────────────────────────────────────────────

test('the validator checks what a Skill’s schema says, and every Skill’s schema uses only that', () => {
  const schema = { type: 'object', required: ['label'], additionalProperties: false, properties: { label: { type: 'string', enum: ['a', 'b'] }, n: { type: 'integer', minimum: 0 } } }
  assert.deepEqual(S.validate(schema, { label: 'a', n: 2 }), [])
  assert.deepEqual(S.validate(schema, { label: 'c' }), ['$.label: not one of a, b'])
  assert.deepEqual(S.validate(schema, { n: -1, x: 1 }), ['$.label: required', '$.n: below 0', '$.x: not allowed'])
  assert.deepEqual(S.validate(schema, []), ['$: expected object, got array'])
  assert.deepEqual(S.jsonFromText('```json\n{"a":1}\n```'), { a: 1 })
  assert.throws(() => S.jsonFromText('no json here'), (e) => e.code === 'no_json')
  assert.throws(() => S.jsonFromText('{"a": }'), (e) => e.code === 'bad_json')
  for (const [key, def] of Object.entries(D.SKILL_DEFS)) {
    assert.deepEqual(S.unsupportedKeywords(def.schema), [], `${key} uses a keyword the validator does not check`)
    assert.equal(def.key, key)
    assert.ok(Array.isArray(def.inputs) && def.inputs.length, `${key} declares its inputs`)
    assert.ok(Number.isInteger(def.outputVersion), `${key} has an output version`)
  }
})

test('nothing but the runner calls the model for a Skill: receipts go through runKeithSkill', () => {
  const src = read('lib/server/budget/receipts.js')
  assert.match(src, /runKeithSkill\(db, READ_SKILL,/)
  assert.doesNotMatch(src, /complete\(\{/, 'receipts no longer call the model itself')
  assert.doesNotMatch(src, /resolveRoute|recordSkillInvocation/, 'routing and the invocation audit are the runner’s')
})

// ── The world ───────────────────────────────────────────────────────────────────

const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts']
async function world({ foundation = true } = {}) {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  await pg.exec(`ALTER TABLE keith_skills ADD COLUMN IF NOT EXISTS updated_by uuid; INSERT INTO organizations (id) VALUES ('a5f1e000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;`)
  const person = async (name, role, owner = false) => (await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ($1, $2, $3, $4) RETURNING *`, [name, `${role}@x.org`, role, owner])).rows[0]
  const owner = await person('Jester Lloyd Bautista', 'owner', true)
  const admin = await person('An Admin', 'admin')
  const student = await person('A Student', 'student')
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  await pg.exec(runnable(read('db/migrations/seed_program_budget_fy26.sql')))
  if (foundation) await pg.exec(FOUNDATION)
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 3 WHERE slug = 'read-receipt'`)
  return { pg, db, owner, admin, student }
}
const stub = (reading) => async () => ({ ok: true, text: typeof reading === 'string' ? reading : JSON.stringify(reading), model: 'claude-test', usage: { inputTokens: 1200, outputTokens: 300 } })
async function uploaded(db, owner, name = 'IMG_4471.jpg') {
  const bytes = Buffer.from(`fake image bytes ${name}`)
  const { receipt, upload } = await R.startUpload(db, owner, { fileName: name, contentType: 'image/jpeg', size: bytes.length })
  await db.storage.from(R.RECEIPT_BUCKET).upload(upload.path, bytes)
  return receipt
}
const provOf = async (pg, entityId) => (await pg.query(`SELECT * FROM keith_provenance WHERE entity_id = $1 ORDER BY created_at DESC`, [entityId])).rows[0]

// ── A sample skill, end to end ─────────────────────────────────────────────────

const SAMPLE = Object.freeze({
  'sample-classify': {
    key: 'sample-classify', outputVersion: 2, intent: 'sample', entityType: 'sample_reply', field: 'label',
    inputs: ['reply'],
    schema: { type: 'object', required: ['label', 'confidence'], additionalProperties: false, properties: { label: { type: 'string', enum: ['thanks', 'request', 'needs_look'] }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, reason: { type: 'string', maxLength: 200 } } },
    request: ({ skill, input }) => ({ system: skill.instruction_body, messages: [{ role: 'user', content: input.reply.value }] }),
    provenance: (o) => ({ confidence: o.confidence, reason: o.reason || null }),
    labelOf: (o) => o?.label ?? null,
  },
})
const E1 = '11111111-1111-4111-8111-111111111111'
const E2 = '22222222-2222-4222-8222-222222222222'
const E3 = '33333333-3333-4333-8333-333333333333'

test('a sample skill proves the path: off, undeclared input, invalid output, a good run, shadow, agreement, the mode switch', async () => {
  const { pg, db, owner, admin } = await world()
  await pg.query(`INSERT INTO keith_skills (slug, display_name, status, enabled, version, allowed_roles, instruction_body) VALUES ('sample-classify', 'Sample Classify', 'active', false, 1, '{admin}', 'Label the reply.')`)
  const run = (text, id = E1, extra = {}) => K.runKeithSkill(db, 'sample-classify', { reply: { value: 'Thank you so much!', refs: [{ type: 'checkin_reply', id }] }, ...extra }, { actor: owner, entity: { id }, complete: stub(text), defs: SAMPLE })

  // Off: disabled refuses, and nothing is metered or written.
  assert.deepEqual((await run({ label: 'thanks', confidence: 'high' })).reason, 'off')
  await pg.query(`UPDATE keith_skills SET enabled = true WHERE slug = 'sample-classify'`)

  // Only the declared inputs.
  await assert.rejects(run({ label: 'thanks', confidence: 'high' }, E1, { student_record: { value: 'x' } }), /undeclared input: student_record/)
  await assert.rejects(K.runKeithSkill(db, 'sample-classify', {}, { actor: owner, entity: { id: E1 }, complete: stub('{}'), defs: SAMPLE }), /missing input: reply/)

  // Invalid output is dropped: metered as an error, no provenance, nothing returned to show.
  const bad = await run({ label: 'maybe', confidence: 'high' })
  assert.deepEqual([bad.ok, bad.reason, bad.stage], [false, 'invalid_output', 'schema'])
  assert.equal((await pg.query(`SELECT count(*)::int n FROM keith_provenance`)).rows[0].n, 0)
  assert.equal((await pg.query(`SELECT outcome FROM keith_requests ORDER BY created_at DESC LIMIT 1`)).rows[0].outcome, 'error')

  // A good run: metered under the skill, one drafted provenance row, the id returned with the output.
  const good = await run({ label: 'thanks', confidence: 'high', reason: 'A thank-you with no question.' })
  assert.deepEqual([good.ok, good.mode, good.output.label], [true, 'on', 'thanks'])
  const row = await provOf(pg, E1)
  assert.equal(row.id, good.provenanceId)
  assert.deepEqual([row.skill_key, row.skill_version, row.entity_type, row.field, row.state, row.mode, row.confidence, row.reason],
    ['sample-classify', '1.2', 'sample_reply', 'label', 'drafted', 'on', 'high', 'A thank-you with no question.'])
  assert.deepEqual(row.input_refs, [{ type: 'checkin_reply', id: E1 }], 'the IDs of what Keith read, never the reply')
  assert.doesNotMatch(JSON.stringify(row), /Thank you so much/, 'the input text is stored nowhere')
  const [usage] = (await pg.query(`SELECT r.intent, r.outcome, s.slug FROM keith_requests r JOIN keith_skills s ON s.id = r.skill_id ORDER BY r.created_at DESC LIMIT 1`)).rows
  assert.deepEqual(usage, { intent: 'sample', outcome: 'completed', slug: 'sample-classify' }, 'Usage & Cost lists it by the skill')

  // Shadow: the same run, recorded, and the result says to take no action.
  await pg.query(`UPDATE keith_skills SET run_mode = 'shadow' WHERE slug = 'sample-classify'`)
  const s2 = await run({ label: 'thanks', confidence: 'high' }, E2)
  const s3 = await run({ label: 'request', confidence: 'medium' }, E3)
  assert.equal(s2.mode, 'shadow')
  assert.equal((await provOf(pg, E2)).mode, 'shadow')
  // The person's own decisions on the same replies.
  assert.equal(await K.recordKeithOutcome(db, s2.provenanceId, 'observe', { label: 'thanks' }, owner), 'drafted')
  assert.equal(await K.recordKeithOutcome(db, s3.provenanceId, 'observe', { label: 'needs_look' }, owner), 'drafted')
  const agreement = await K.shadowAgreement(db, 'sample-classify', { defs: SAMPLE })
  assert.deepEqual(agreement, { total: 2, agreed: 1, rate: 0.5, byLabel: { thanks: { total: 1, agreed: 1 }, request: { total: 1, agreed: 0 } } })

  // Shadow to On is the Owner's, logged with the figure at that moment.
  await assert.rejects(K.setSkillMode(db, 'sample-classify', 'on', admin, { defs: SAMPLE }), /Only the Owner/)
  const sw = await K.setSkillMode(db, 'sample-classify', 'on', owner, { defs: SAMPLE })
  assert.deepEqual([sw.from, sw.to, sw.agreement.agreed, sw.agreement.total], ['shadow', 'on', 1, 2])
  const [log] = (await pg.query(`SELECT from_mode, to_mode, agreement, changed_by FROM keith_skill_mode_changes`)).rows
  assert.deepEqual([log.from_mode, log.to_mode, log.agreement.agreed, log.agreement.total, log.changed_by], ['shadow', 'on', 1, 2, owner.id])
  await assert.rejects(pg.query(`DELETE FROM keith_skill_mode_changes`), /append-only/)
})

// ── Receipts on the foundation ──────────────────────────────────────────────────

test('a reading writes provenance; the Owner’s edits, accept, reject and undo move it; the card says what Keith read', async () => {
  const { pg, db, owner, admin, student } = await world()
  const rec = await uploaded(db, owner)
  const out = await R.readReceipt(db, owner, { id: rec.id, complete: stub(AMAZON), today: TODAY })
  assert.ok(out.receipt.keith_provenance_id, 'the slip carries its provenance id')
  let p = await provOf(pg, rec.id)
  assert.deepEqual([p.skill_key, p.skill_version, p.entity_type, p.field, p.state, p.mode, p.confidence], ['read-receipt', '3.1', 'budget_receipt', 'reading', 'drafted', 'on', 'medium'])
  assert.equal(p.reason, 'Copy Paper, 5-Ream Case: Paper for printed orientation packets.\nName Badge Labels: Badges for orientation.')
  assert.deepEqual(p.input_refs, [{ type: 'budget_receipt_file', id: rec.id }])
  assert.equal(p.output.card_last4, '4417', 'the stored output is the cleaned reading: four digits, never more')
  assert.equal((await R.intake(db, { today: TODAY })).waiting[0].keith_provenance_id, p.id)

  // The card: the Owner sees the file Keith read; an Admin and a student see nothing.
  const cards = await C.provenanceCards(db, owner, [p.id])
  assert.deepEqual([cards[p.id].state, cards[p.id].skill_name, cards[p.id].read, cards[p.id].confidence], ['drafted', 'Read Receipt', 'IMG_4471.jpg', 'medium'])
  assert.deepEqual(Object.keys(cards[p.id]).sort(), ['confidence', 'created_at', 'human_action_at', 'human_action_by_name', 'id', 'mode', 'read', 'reason', 'skill_name', 'state'], 'no output, no input ids')
  assert.deepEqual(await C.provenanceCards(db, admin, [p.id]), {}, 'receipts are the Owner’s')
  assert.deepEqual(await C.provenanceCards(db, student, [p.id]), {}, 'never a portal user')

  // Saving the draft unchanged is not an edit; changing a line is; changing it back is Keith's again.
  const draft = out.receipt.draft
  assert.equal((await R.saveDraft(db, owner, { id: rec.id, draft })).keith_state, undefined)
  assert.equal((await provOf(pg, rec.id)).state, 'drafted')
  const moved = { ...draft, lines: draft.lines.map((l, i) => (i === 0 ? { ...l, category: 'Supplies & Materials' } : l)) }
  assert.equal((await R.saveDraft(db, owner, { id: rec.id, draft: moved })).keith_state, 'edited')
  p = await provOf(pg, rec.id)
  assert.deepEqual([p.state, p.human_action_by], ['edited', owner.id])
  assert.deepEqual(p.human_diff.edits.map(e => [e.field, e.from, e.to]), [['line.category', 'Printing & Copying', 'Supplies & Materials']])
  await R.saveDraft(db, owner, { id: rec.id, draft })
  assert.equal((await provOf(pg, rec.id)).state, 'drafted', 'changed back to Keith’s reading')

  // A business purpose is the Owner's addition, not a change to what Keith read.
  await R.saveDraft(db, owner, { id: rec.id, draft: { ...draft, business_purpose: 'Orientation supplies' } })
  assert.equal((await provOf(pg, rec.id)).state, 'drafted')

  // Accept unchanged: accepted. Undo: drafted again. Reject, undo: drafted.
  await R.acceptReceipt(db, owner, { id: rec.id, draft: { ...draft, payment_method: null }, today: TODAY })
  assert.equal((await provOf(pg, rec.id)).state, 'accepted')
  await R.undoReceipt(db, owner, { id: rec.id })
  assert.equal((await provOf(pg, rec.id)).state, 'drafted')
  await R.rejectReceipt(db, owner, { id: rec.id })
  assert.equal((await provOf(pg, rec.id)).state, 'rejected')
  assert.deepEqual(await C.provenanceCards(db, owner, [p.id]), {}, 'a rejected output has no mark')
  await R.undoReceipt(db, owner, { id: rec.id })
  assert.equal((await provOf(pg, rec.id)).state, 'drafted')

  // Accept with a last change in the accepted draft: it stays Edited, accepted by the Owner.
  await R.acceptReceipt(db, owner, { id: rec.id, draft: { ...draft, payment_method: 'personal_concur' }, today: TODAY })
  p = await provOf(pg, rec.id)
  assert.deepEqual([p.state, p.human_diff.edits.map(e => e.field)], ['edited', ['payment_method']])
})

test('the Sheet’s receipt rows carry the mark for the Owner only, and the export never does', async () => {
  const { pg, db, owner } = await world()
  const rec = await uploaded(db, owner)
  const out = await R.readReceipt(db, owner, { id: rec.id, complete: stub(AMAZON), today: TODAY })
  const acc = await R.acceptReceipt(db, owner, { id: rec.id, draft: { ...out.receipt.draft, payment_method: 'personal_concur' }, today: TODAY })
  const pid = (await provOf(pg, rec.id)).id
  const mine = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  const rows = mine.expenses.filter(e => acc.expense_ids.includes(e.id))
  assert.equal(rows.length, 2)
  assert.ok(rows.every(e => e.keith_provenance_id === pid), 'each row the receipt created')
  assert.ok(mine.expenses.filter(e => !acc.expense_ids.includes(e.id)).every(e => !e.keith_provenance_id), 'and no other row')
  const theirs = await E.loadYear(db, { fy: 2027, viewer: 'reader', today: TODAY })
  assert.ok(theirs.expenses.every(e => !('keith_provenance_id' in e)), 'a reader’s payload never holds it')
  for (const viewer of ['owner', 'reader']) {
    const { bytes } = await E.exportYear(db, { fy: 2027, viewer, today: TODAY })
    const text = Buffer.from(bytes).toString('latin1')
    assert.doesNotMatch(text, new RegExp(pid), `${viewer} export carries no provenance`)
    assert.doesNotMatch(text, /Keith|provenance/i, `${viewer} export names no Keith`)
  }
})

test('the receipt path runs before the foundation migration: no provenance, no mark, nothing breaks', async () => {
  const { db, owner } = await world({ foundation: false })
  const rec = await uploaded(db, owner)
  const out = await R.readReceipt(db, owner, { id: rec.id, complete: stub(AMAZON), today: TODAY })
  assert.equal(out.receipt.status, 'review')
  assert.equal(out.receipt.keith_provenance_id, null)
  assert.equal((await R.saveDraft(db, owner, { id: rec.id, draft: { ...out.receipt.draft, vendor: 'Amazon.com' } })).keith_state, undefined)
  await R.acceptReceipt(db, owner, { id: rec.id, draft: { ...out.receipt.draft, payment_method: 'personal_concur' }, today: TODAY })
  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.ok(y.expenses.every(e => !e.keith_provenance_id))
})

test('a reading in shadow mode is kept for comparison and not used', async () => {
  const { pg, db, owner } = await world()
  await pg.query(`UPDATE keith_skills SET run_mode = 'shadow' WHERE slug = 'read-receipt'`)
  const rec = await uploaded(db, owner)
  const out = await R.readReceipt(db, owner, { id: rec.id, complete: stub(AMAZON), today: TODAY })
  assert.equal(out.receipt.status, 'failed')
  assert.match(out.receipt.read_error, /shadow mode/)
  assert.equal((await provOf(pg, rec.id)).mode, 'shadow')
  assert.equal((await pg.query(`SELECT proposal FROM budget_receipts WHERE id = $1`, [rec.id])).rows[0].proposal, null, 'the slip took nothing from it')
})

// ── The migration ───────────────────────────────────────────────────────────────

test('provenance output is immutable, only the outcome moves, and nothing is deleted', async () => {
  const { pg, db, owner } = await world()
  const rec = await uploaded(db, owner)
  await R.readReceipt(db, owner, { id: rec.id, complete: stub(AMAZON), today: TODAY })
  const p = await provOf(pg, rec.id)
  await assert.rejects(pg.query(`UPDATE keith_provenance SET output = '{}'::jsonb WHERE id = $1`, [p.id]), /only the outcome may change/)
  await assert.rejects(pg.query(`UPDATE keith_provenance SET input_refs = '[]'::jsonb WHERE id = $1`, [p.id]), /only the outcome may change/)
  await assert.rejects(pg.query(`DELETE FROM keith_provenance WHERE id = $1`, [p.id]), /DELETE refused/)
  await assert.rejects(pg.query(`TRUNCATE keith_provenance`), /append-only/)
  await pg.query(`UPDATE keith_provenance SET state = 'accepted' WHERE id = $1`, [p.id])
  await assert.rejects(pg.query(`UPDATE keith_provenance SET state = 'maybe' WHERE id = $1`, [p.id]), /chk_keith_provenance_state/)
  await pg.exec(FOUNDATION)   // safe to re-run
  assert.equal((await pg.query(`SELECT count(*)::int n FROM keith_provenance`)).rows[0].n, 1, 're-running adds nothing')
})

test('the backfill tells an edited receipt from an accepted one, and marks waiting and rejected ones', async () => {
  const { pg, db, owner } = await world({ foundation: false })
  const make = async (name) => { const r = await uploaded(db, owner, name); return (await R.readReceipt(db, owner, { id: r.id, complete: stub(AMAZON), today: TODAY })).receipt }
  const plain = await make('plain.jpg')
  await R.acceptReceipt(db, owner, { id: plain.id, draft: plain.draft, today: TODAY })
  const edited = await make('edited.jpg')
  await R.acceptReceipt(db, owner, { id: edited.id, draft: { ...edited.draft, payment_method: 'personal_concur' }, today: TODAY })
  const meal = await make('meal.jpg')
  await R.acceptReceipt(db, owner, { id: meal.id, draft: { ...meal.draft, business_purpose: 'Preceptor lunch' }, today: TODAY })
  const waiting = await make('waiting.jpg')
  const waitingEdited = await make('waiting-edited.jpg')
  await R.saveDraft(db, owner, { id: waitingEdited.id, draft: { ...waitingEdited.draft, lines: waitingEdited.draft.lines.map((l, i) => (i === 1 ? { ...l, quantity: 3 } : l)) } })
  const rejected = await make('rejected.jpg')
  await R.rejectReceipt(db, owner, { id: rejected.id })
  const before = await uploaded(db, owner, 'unread.jpg')

  await pg.exec(FOUNDATION)
  const state = async (id) => (await provOf(pg, id))?.state
  assert.equal(await state(plain.id), 'accepted')
  assert.equal(await state(edited.id), 'edited', 'the accept log lists the payment change')
  assert.equal(await state(meal.id), 'accepted', 'a business purpose is not an edit')
  assert.equal(await state(waiting.id), 'drafted')
  assert.equal(await state(waitingEdited.id), 'edited')
  assert.equal(await state(rejected.id), 'rejected')
  assert.equal(await state(before.id), undefined, 'nothing Keith has not read')
  const legacy = await provOf(pg, plain.id)
  const [upload] = (await pg.query(`SELECT created_at FROM budget_receipts WHERE id = $1`, [plain.id])).rows
  assert.deepEqual([legacy.skill_version, legacy.mode, legacy.human_action_by, String(legacy.created_at)], ['legacy', 'on', owner.id, String(upload.created_at)])
  const y = await E.loadYear(db, { fy: 2027, viewer: 'owner', today: TODAY })
  assert.ok(y.expenses.some(e => e.keith_provenance_id === legacy.id), 'past receipts’ rows show the mark too')
})

// ── The endpoint ────────────────────────────────────────────────────────────────

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method: 'POST', headers: {}, body }, res)
  })
}

test('/api/keith-provenance: cards only for who may see them, a strict body, agreement for Owner and Admin', async () => {
  const { db, owner, admin, student } = await world()
  const rec = await uploaded(db, owner)
  const out = await R.readReceipt(db, owner, { id: rec.id, complete: stub(AMAZON), today: TODAY })
  const as = (profile) => createKeithProvenanceHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => db })
  const pid = out.receipt.keith_provenance_id
  assert.deepEqual(Object.keys((await call(as(owner), { action: 'cards', ids: [pid] })).body.records), [pid])
  assert.deepEqual((await call(as(admin), { action: 'cards', ids: [pid] })).body.records, {})
  assert.deepEqual((await call(as(student), { action: 'cards', ids: [pid] })).body.records, {})
  assert.equal((await call(as(owner), { action: 'cards', ids: [pid], state: 'accepted' })).status, 400, 'a client never sends a state')
  assert.equal((await call(as(owner), { action: 'cards', ids: Array(201).fill(pid) })).status, 400)
  assert.equal((await call(as(owner), { action: 'agreement', skill: 'read-receipt' })).status, 200)
  assert.equal((await call(as(admin), { action: 'agreement', skill: 'read-receipt' })).status, 200)
  assert.equal((await call(as(student), { action: 'agreement', skill: 'read-receipt' })).status, 403)
  const anon = createKeithProvenanceHandler({ verifyCaller: async () => ({ authenticated: false, status: 401, reason: 'missing_token' }), makeDb: () => db })
  assert.equal((await call(anon, { action: 'cards', ids: [pid] })).status, 401)
})
