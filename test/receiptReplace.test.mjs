// test/receiptReplace.test.mjs
//
// RECEIPT-REPLACE-1 (Owner, 2026-10-01): "I attached an invoice instead of a receipt and there is no
// way for me to replace it." On real Postgres (PGlite) with the real migrations and an in-memory
// bucket: a filed receipt's file is replaced IN PLACE (rows, amounts and the filed record's identity
// stay; the old bytes are deleted; Keith re-reads for the drawing only), and a filed receipt is
// deleted for good (bytes, filed record and receipt go; the rows stay and read Missing).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const R = await import('../lib/server/budget/receipts.js')
const E = await import('../lib/server/budget/engine.js')
const { createBudgetStaffHandler } = await import('../api/budget-staff.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')
const TODAY = '2026-09-27'
const MIGRATIONS = ['20261009000000_program_budget_phase_a', '20261010000000_budget_subscription_approval', '20261011000000_budget_subscription_cells', '20261012000000_budget_expense_zero_quantity', '20261013000000_budget_receipts']
const AMAZON = {
  document_type: 'invoice', vendor: 'Amazon', order_number: '112-7730158-4402217', date: '2026-09-03', date_confidence: 'high',
  card_last4: '4417', subtotal: 53.49, tax: 5.08, shipping: 0, tip: 0, total: 58.57,
  lines: [
    { item: 'Copy Paper, 5-Ream Case', quantity: 1, amount: 38.99, category: 'Printing & Copying', confidence: 'high', reason: 'Paper.' },
    { item: 'Name Badge Labels', quantity: 2, amount: 14.50, category: 'Supplies & Materials', confidence: 'medium', reason: 'Badges.' },
  ],
  unreadable_fields: [], has_shipping_address: true,
}

async function world() {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  const db = pgliteRest(pg)
  await E.startYear(db, owner, { fy: 2027, total: 40000, cost_center: 'Nursing Education', plan: 'none', today: TODAY })
  await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'read-receipt'`)
  return { pg, db, owner }
}
const stub = (reading) => async () => ({ ok: true, text: JSON.stringify(reading), model: 'claude-test', usage: { inputTokens: 10, outputTokens: 10 } })
const bucket = (db) => db.storage.from(R.RECEIPT_BUCKET)

/** An invoice, read and accepted as two rows. */
async function filed(db, owner) {
  const { receipt, upload } = await R.startUpload(db, owner, { fileName: 'invoice.pdf', contentType: 'application/pdf', size: 12 })
  await bucket(db).upload(upload.path, Buffer.from('%PDF invoice'))
  const out = await R.readReceipt(db, owner, { id: receipt.id, complete: stub(AMAZON), today: TODAY })
  const acc = await R.acceptReceipt(db, owner, { id: receipt.id, draft: { ...out.receipt.draft, payment_method: 'personal_concur' }, today: TODAY })
  return { id: receipt.id, path: upload.path, acc }
}

test('Replace file swaps the file in place: the rows, the filed record and the receipt stay, the old bytes go', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  assert.equal(f.acc.expense_ids.length, 2)
  const before = (await pg.query(`SELECT id, amount::text, receipt_file_id FROM budget_expenses WHERE id = ANY($1) ORDER BY id`, [f.acc.expense_ids])).rows

  const { upload } = await R.startReplace(db, owner, { id: f.id, fileName: 'real receipt.jpg', contentType: 'image/jpeg', size: 9 })
  assert.match(upload.path, new RegExp(`^budget/receipts/${f.id}/replace-[0-9a-f]{8}-real-receipt\\.jpg$`))
  await bucket(db).upload(upload.path, Buffer.from('jpg bytes'))
  const out = await R.finishReplace(db, owner, { id: f.id, path: upload.path, fileName: 'real receipt.jpg', contentType: 'image/jpeg', complete: stub({ ...AMAZON, document_type: 'receipt' }), today: TODAY })
  assert.equal(out.replaced, true)
  assert.equal(out.reread, true)
  assert.equal(out.differs, null)
  assert.equal(out.filed_name, 'FY27_2026-09-03_Amazon_112-7730158_$58.57.jpg', 'the same filed name, the new file type')
  assert.equal(out.message, 'The file was replaced. The old one is deleted.')

  const [rec] = (await pg.query(`SELECT status, file_name, storage_path, content_type, filed_name, proposal->>'document_type' AS kind, expense_ids, record_document_id FROM budget_receipts WHERE id = $1`, [f.id])).rows
  assert.deepEqual([rec.status, rec.file_name, rec.storage_path, rec.content_type, rec.kind], ['accepted', 'real receipt.jpg', upload.path, 'image/jpeg', 'receipt'])
  assert.deepEqual([...rec.expense_ids].sort(), [...f.acc.expense_ids].sort())
  const [doc] = (await pg.query(`SELECT id, storage_path, content_type, file_name FROM record_documents`)).rows
  assert.deepEqual(doc, { id: f.acc.record_document_id, storage_path: upload.path, content_type: 'image/jpeg', file_name: out.filed_name })
  const after = (await pg.query(`SELECT id, amount::text, receipt_file_id FROM budget_expenses WHERE id = ANY($1) ORDER BY id`, [f.acc.expense_ids])).rows
  assert.deepEqual(after, before, 'no row changed')
  // The old file is gone from storage; the row opens the new one.
  assert.ok((await bucket(db).download(f.path)).error, 'the invoice is deleted')
  assert.match((await R.expenseReceiptUrl(db, { expenseId: f.acc.expense_ids[0] })).url, /real-receipt\.jpg$/)
  const log = (await pg.query(`SELECT action, new_value FROM budget_changes WHERE entity = 'receipt' ORDER BY created_at`)).rows
  assert.deepEqual(log.map(x => x.action), ['upload', 'read', 'accept', 'update'])
  assert.deepEqual(log[3].new_value.replaced_file, { from: 'invoice.pdf', to: 'real receipt.jpg' })
})

test('a new file with a different total is reported and changes nothing; with Keith off the file is still replaced', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  const a = await R.startReplace(db, owner, { id: f.id, fileName: 'r.pdf', contentType: 'application/pdf', size: 5 })
  await bucket(db).upload(a.upload.path, Buffer.from('%PDF2'))
  const out = await R.finishReplace(db, owner, { id: f.id, path: a.upload.path, fileName: 'r.pdf', contentType: 'application/pdf', complete: stub({ ...AMAZON, total: 60 }), today: TODAY })
  assert.deepEqual(out.differs, { receipt: 60, rows: 58.57 })
  assert.match(out.message, /The new file totals \$60\.00 and the Sheet has \$58\.57; nothing in the Sheet was changed\. Keith reads the new file as an invoice too\./)
  assert.equal((await pg.query(`SELECT sum(amount)::text AS s FROM budget_expenses WHERE id = ANY($1)`, [f.acc.expense_ids])).rows[0].s, '58.57')

  await pg.query(`UPDATE keith_skills SET enabled = false WHERE slug = 'read-receipt'`)
  const b = await R.startReplace(db, owner, { id: f.id, fileName: 'r3.pdf', contentType: 'application/pdf', size: 5 })
  await bucket(db).upload(b.upload.path, Buffer.from('%PDF3'))
  const off = await R.finishReplace(db, owner, { id: f.id, path: b.upload.path, fileName: 'r3.pdf', contentType: 'application/pdf', complete: async () => { throw new Error('never called') }, today: TODAY })
  assert.deepEqual([off.replaced, off.reread], [true, false])
  assert.match(off.message, /Keith did not re-read it/)
  assert.equal((await pg.query(`SELECT storage_path FROM budget_receipts WHERE id = $1`, [f.id])).rows[0].storage_path, b.upload.path)
})

test('Replace refuses a path it did not issue, a file that never arrived, a wrong type and a receipt not yet filed', async () => {
  const { db, owner } = await world()
  const f = await filed(db, owner)
  await assert.rejects(R.finishReplace(db, owner, { id: f.id, path: 'budget/receipts/someone-else/replace-aaaaaaaa-x.pdf', fileName: 'x.pdf', contentType: 'application/pdf' }), /does not belong to this receipt/)
  await assert.rejects(R.finishReplace(db, owner, { id: f.id, path: f.path, fileName: 'x.pdf', contentType: 'application/pdf' }), /does not belong to this receipt/)
  await assert.rejects(R.finishReplace(db, owner, { id: f.id, path: `budget/receipts/${f.id}/replace-aaaaaaaa-x.pdf`, fileName: 'x.pdf', contentType: 'application/pdf' }), /could not be found/)
  await assert.rejects(R.startReplace(db, owner, { id: f.id, fileName: 'x.docx', contentType: 'application/msword', size: 5 }), /Add a photo/)
  const { receipt } = await R.startUpload(db, owner, { fileName: 'new.pdf', contentType: 'application/pdf', size: 5 })
  await assert.rejects(R.startReplace(db, owner, { id: receipt.id, fileName: 'x.pdf', contentType: 'application/pdf', size: 5 }), /Only a filed receipt/)
  await assert.rejects(R.deleteReceipt(db, owner, { id: receipt.id }), /Only a filed receipt/)
})

test('Delete receipt removes the file, the filed record and the receipt for good; its rows stay and read Missing', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  const out = await R.deleteReceipt(db, owner, { id: f.id })
  assert.deepEqual(out, { deleted: true, rows: 2 })
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM budget_receipts`)).rows[0].n, 0)
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM record_documents`)).rows[0].n, 0)
  assert.ok((await bucket(db).download(f.path)).error, 'the bytes are gone')
  const rows = (await pg.query(`SELECT amount::text, receipt_file_id, deleted_at FROM budget_expenses WHERE id = ANY($1)`, [f.acc.expense_ids])).rows
  assert.equal(rows.length, 2)
  assert.ok(rows.every(x => x.receipt_file_id === null && x.deleted_at === null), 'the rows stay, with no receipt')
  assert.deepEqual((await R.filedReceipts(db, { fy: 2027, today: TODAY })), [])
  await assert.rejects(R.expenseReceiptUrl(db, { expenseId: f.acc.expense_ids[0] }), /No receipt is filed on this row/)
  // The log outlives the receipt: who deleted what, and each row's own line.
  const [gone] = (await pg.query(`SELECT new_value FROM budget_changes WHERE entity = 'receipt' AND action = 'delete'`)).rows
  assert.equal(gone.new_value.file_name, 'invoice.pdf')
  assert.equal(gone.new_value.deleted_by, 'Jester Lloyd Bautista')
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM budget_changes WHERE entity = 'expense' AND field = 'receipt' AND new_value IS NULL`)).rows[0].n, 2)
  await assert.rejects(R.deleteReceipt(db, owner, { id: f.id }), /no longer exists/)
})

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method: 'POST', body, headers: {} }, res)
  })
}

test('both are the Owner’s through the endpoint: an Admin is refused, and an unknown field is refused', async () => {
  const { pg, db, owner } = await world()
  const { rows: [admin] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('An Admin', 'a@x.org', 'admin', false) RETURNING *`)
  const f = await filed(db, owner)
  const as = (profile) => createBudgetStaffHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => db, today: () => TODAY, complete: stub({ ...AMAZON, document_type: 'receipt' }) })
  for (const body of [{ action: 'receipt_replace_start', id: f.id, file_name: 'a.pdf', content_type: 'application/pdf', size: 4 }, { action: 'receipt_replace_finish', id: f.id, path: 'x', file_name: 'a.pdf', content_type: 'application/pdf' }, { action: 'receipt_delete', id: f.id }]) {
    assert.equal((await call(as(admin), body)).status, 403, `${body.action} is Owner-only`)
  }
  const st = await call(as(owner), { action: 'receipt_replace_start', id: f.id, file_name: 'a.pdf', content_type: 'application/pdf', size: 4 })
  assert.equal(st.status, 200)
  await bucket(db).upload(st.body.upload.path, Buffer.from('%PDF'))
  const fin = await call(as(owner), { action: 'receipt_replace_finish', id: f.id, path: st.body.upload.path, file_name: 'a.pdf', content_type: 'application/pdf' })
  assert.deepEqual([fin.status, fin.body.replaced, fin.body.reread], [200, true, true])
  assert.equal((await call(as(owner), { action: 'receipt_delete', id: f.id, rows: 'too' })).status, 400)
  assert.deepEqual((await call(as(owner), { action: 'receipt_delete', id: f.id })).body, { deleted: true, rows: 2 })
})

test('the panel offers both, with a confirmation for Delete', () => {
  // RECEIPTS-REDESIGN-1 (2 of 3) changed this: both live in the receipt modal's Details now.
  const ui = read('src/components/budget/ReceiptModal.jsx')
  assert.match(ui, /Replace file/)
  assert.match(ui, /Delete for good/)
  assert.match(ui, /role="alertdialog"/)
  assert.match(ui, /receipt_replace_start[\s\S]*uploadReceiptFile[\s\S]*receipt_replace_finish/)
})
