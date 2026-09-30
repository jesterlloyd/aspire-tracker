// BUDGET-CONCUR-1 (Owner, 2026-09-30): help submitting to Concur.
//   - the Sheet's Receipt cell offers Upload, which sends the file to Receipts > To Review;
//   - a Submitted to Concur checkbox column that IS the Stage (ticked = Submitted to Concur or later);
//   - the receipt panel marks Submitted and Reimbursed through the same status, with Undo;
//   - Keith (prepare-concur, seeded DRAFT and off) drafts what to enter in Concur on request, from the
//     receipt and the reimbursement policy in the Knowledge Center, saved on the receipt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const E = await import('../lib/server/budget/engine.js')
const R = await import('../lib/server/budget/receipts.js')
const C = await import('../lib/server/budget/concur.js')
const M = await import('../src/lib/budget/budgetModel.js')
const T = await import('../src/components/budget/budgetSheetTools.js')
const D = await import('../lib/server/keith/skillDefs.js')
const S = await import('../lib/server/keith/outputSchema.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-30'
const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts', '20261016000000_keith_foundation', '20261021000000_budget_v2_phase1', '20261022000000_budget_v2_phase2', '20261023000000_budget_v2_phase3', '20261024000000_budget_v2_phase4', '20261025000000_budget_fixes_s1']
const CONCUR = runnable(read('supabase/migrations/20261026000000_budget_concur.sql'))

async function world({ concur = true } = {}) {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  if (concur) { await pg.exec(CONCUR); await pg.exec(CONCUR) }
  // The Knowledge Center, as far as retrieval reads it, with the policy the Owner uploaded.
  await pg.exec(`CREATE TABLE IF NOT EXISTS knowledge_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, slug text, category text, body text, source_attribution text, precedence_rank int, updated_at timestamptz DEFAULT now(), aliases text[], tags text[], body_format text, expires_at date, review_date date, state text);
    INSERT INTO knowledge_entries (title, slug, category, body, state, precedence_rank) VALUES ('Business Expense Reimbursement Policy', 'business-expense-reimbursement-policy', 'policy', 'Concur reimbursement: submit within 60 days. Receipts required over $25; itemized over $100. Subscriptions need a clear business purpose.', 'active', 1);`)
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'read-receipt'`)
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 3500, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  return { pg, db, owner }
}
async function filed(db, owner, { vendor = 'Staples', total = 86.4, method = 'personal_concur', card = '9999' } = {}) {
  const reading = { vendor, order_number: 'A-1', date: '2026-09-12', card_last4: card, subtotal: total, tax: 0, shipping: 0, tip: 0, total, has_shipping_address: false, unreadable_fields: [],
    lines: [{ item: 'Name badge pouches', quantity: 1, amount: total, category: 'Supplies & Materials', confidence: 'high', reason: 'Badges.' }] }
  const { receipt: rec, upload } = await R.startUpload(db, owner, { fileName: 'r.pdf', contentType: 'application/pdf', size: 3 })
  await db.storage.from(R.RECEIPT_BUCKET).upload(upload.path, Buffer.from('pdf'))
  const r = (await R.readReceipt(db, owner, { id: rec.id, complete: async () => ({ ok: true, text: JSON.stringify(reading), model: 'm', usage: {} }), today: TODAY })).receipt
  await R.acceptReceipt(db, owner, { id: r.id, draft: { ...r.draft, payment_method: method, business_purpose: 'Badge pouches for the Winter 2027 cohort.' }, today: TODAY })
  return r.id
}
const draft = { report_name: 'ASPIRE Program Supplies - September 2026', expense_type: 'Supplies - Student/Program', description: 'Name badge pouches from Staples', business_purpose: 'Pouches protect student ID badges worn on clinical placements for the Winter 2027 cohort.', attendees: [], attach: ['Itemized receipt (PDF)'], checks: [{ tone: 'info', text: 'Receipt required over $25: attached.' }], notes: '' }

test('Keith drafts the Concur entry from the receipt and the policy, and it is saved on the receipt', async () => {
  const { db, owner, pg } = await world()
  const id = await filed(db, owner)
  let sent = null
  const complete = async (req) => { sent = req; return { ok: true, text: JSON.stringify(draft), model: 'm', usage: {} } }
  await assert.rejects(C.prepareConcur(db, owner, { id, complete }), (e) => e.code === 'keith_off' && /Settings > Keith > Skills/.test(e.message), 'seeded off')
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'prepare-concur'`)
  const { guidance } = await C.prepareConcur(db, owner, { id, complete })
  const prompt = sent.messages[0].content
  assert.match(prompt, /Business Expense Reimbursement Policy|within 60 days/, 'the policy from the Knowledge Center reaches Keith')
  assert.match(prompt, /Badge pouches for the Winter 2027 cohort/, 'and the recorded business purpose')
  assert.doesNotMatch(prompt, /9999/, 'never a card number')
  assert.equal(guidance.expense_type, 'Supplies - Student/Program')
  assert.deepEqual([guidance.amount, guidance.date, guidance.due_by], [86.4, '2026-09-12', '2026-11-11'], 'amount, date and deadline are the app’s')
  assert.equal(guidance.policy_found, true)
  assert.ok(guidance.provenance_id, 'a Keith mark')
  const list = await R.filedReceipts(db, { fy: 2027, today: TODAY })
  assert.equal(list.find(x => x.id === id).concur.expense_type, 'Supplies - Student/Program', 'the panel reads it back')
  assert.equal(list.find(x => x.id === id).rows[0].payment_method, 'personal_concur')
})

test('only a Personal (Concur) purchase is prepared, and before the update the panel says so', async () => {
  const { db, owner, pg } = await world()
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'prepare-concur'`)
  const pcard = await filed(db, owner, { method: 'p_card' })
  await assert.rejects(C.prepareConcur(db, owner, { id: pcard, complete: async () => ({ ok: true, text: '{}' }) }), (e) => e.code === 'not_concur')
  const before = await world({ concur: false })
  const id = await filed(before.db, before.owner)
  await assert.rejects(C.prepareConcur(before.db, before.owner, { id, complete: async () => ({ ok: true, text: '{}' }) }), (e) => e.code === 'not_enabled')
  assert.equal((await R.filedReceipts(before.db, { fy: 2027, today: TODAY })).find(x => x.id === id).concurEnabled, false)
})

test('the skill is declared like every other, its output validated, and seeded draft and off', () => {
  const def = D.SKILL_DEFS['prepare-concur']
  assert.deepEqual(S.unsupportedKeywords(def.schema), [])
  assert.deepEqual(S.validate(def.schema, draft), [])
  assert.ok(S.validate(def.schema, { ...draft, checks: [{ tone: 'loud', text: 'x' }] }).length, 'a check is info or warn')
  assert.deepEqual([...def.inputs], ['receipt', 'policy', 'rules'])
  assert.match(CONCUR, /'prepare-concur',\n\s+'Prepare for Concur',[\s\S]*?'draft',\n\s+false,\n\s+'on',/)
  assert.match(read('api/budget-staff.js'), /receipt_concur_prepare: \['action', 'id'\]/)
  assert.doesNotMatch(read('api/budget-staff.js'), /READS = new Set\(\[[^\]]*receipt_concur/, 'Owner only')
})

test('the Submitted to Concur checkbox is the Stage, and the panel moves the same status', () => {
  assert.equal(M.concurStateOf([{ payment_method: 'personal_concur', status: 'recorded' }]), 'open')
  assert.equal(M.concurStateOf([{ payment_method: 'personal_concur', status: 'submitted' }, { payment_method: 'personal_concur', status: 'reimbursed' }]), 'submitted')
  assert.equal(M.concurStateOf([{ payment_method: 'personal_concur', status: 'reimbursed' }]), 'reimbursed')
  assert.equal(M.concurStateOf([{ payment_method: 'p_card', status: 'paid' }]), null)
  const sheet = read('src/components/budget/BudgetSheet.jsx')
  assert.match(sheet, /\{ key: 'concur_done', label: 'Submitted to Concur', type: 'check'/)
  assert.match(sheet, /case 'concur_done': return \{ status: v \? 'submitted' : 'recorded' \}/)
  assert.match(sheet, /col\.key === 'concur_done' && \(!concurApplies\(row\.raw\) \|\| row\.raw\.status === 'reimbursed'\)/, 'locked where it does not apply, and once reimbursed')
  const grid = read('src/components/sheet/EditableSheet.jsx')
  assert.match(grid, /if \(!col\.staff && col\.type === 'check'\) \{ saveHostValue\(row, col, row\.cells\[col\.key\] \? '' : 'Yes'\)/)
  assert.match(grid, /role="checkbox" aria-checked=\{!!row\.cells\[col\.key\]\}/)
  const panel = read('src/components/budget/ReceiptConcur.jsx')
  assert.match(panel, /budgetStaff\('expense_update', \{ id: x\.id, patch: \{ status \} \}\)/, 'the same write as the Sheet')
  assert.match(panel, /label: 'Undo'/)
  assert.match(panel, /Mark submitted to Concur/)
  assert.match(panel, /Mark reimbursed/)
  assert.match(panel, /budgetStaff\('receipt_concur_prepare', \{ id: r\.id \}\)/)
  assert.doesNotMatch(panel, /—/, 'no em dashes')
})

test('a saved layout gets the checkbox after Receipt; Upload goes to Receipts > To Review', () => {
  assert.deepEqual(T.withConcurColumn({ order: ['item', 'stage', 'receipt', 'tag'] }).order, ['item', 'stage', 'receipt', 'concur_done', 'tag'])
  assert.deepEqual(T.withConcurColumn({ order: [] }).order, [], 'no saved order: the natural one')
  assert.deepEqual(T.withConcurColumn({ order: ['receipt', 'concur_done'] }).order, ['receipt', 'concur_done'])
  const sheet = read('src/components/budget/BudgetSheet.jsx')
  assert.match(sheet, /onClick=\{e => \{ e\.stopPropagation\(\); uploadRef\.current\?\.click\(\) \}\}><Upload size=\{12\} aria-hidden="true" \/>Upload<\/button>/)
  assert.match(read('src/components/budget/ProgramBudgetView.jsx'), /onUpload=\{canEdit \? \(files\) => \{ setPendingFiles\(files\); setTab\('receipts'\) \} : undefined\}/)
  assert.match(read('src/components/budget/BudgetReceipts.jsx'), /const withFiles = useRef\(!!pendingFiles\?\.length\)/, 'arriving with files opens To Review')
})
