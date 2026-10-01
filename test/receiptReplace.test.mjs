// test/receiptReplace.test.mjs
//
// RECEIPT-REPLACE-1 (Owner, 2026-10-01): "I attached an invoice instead of a receipt and there is no
// way for me to replace it." On real Postgres (PGlite) with the real migrations and an in-memory
// bucket. REPLACE-REVIEW-1 (Owner, 2026-10-01: "it should still go through Keith review and not bypass
// that") changed how: the new file is a slip in To Review, read by Keith like any upload, and the filed
// receipt keeps its file and says a replacement is pending until the slip is accepted there. Accepting
// swaps the file IN PLACE (rows, amounts and the filed record's identity stay; the old bytes are
// deleted); rejecting leaves the filed receipt as it was. A filed or a rejected receipt can be deleted
// for good, and a rejected one can go back to To Review.

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
const REVIEW = '20261102000000_receipt_replace_review'
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

async function world({ review = true } = {}) {
  const pg = new PGlite()
  await pg.exec(read('test/fixtures/budgetReceiptsPrelude.sql'))
  const { rows: [owner] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('Jester Lloyd Bautista', 'j@x.org', 'owner', true) RETURNING *`)
  for (const m of [...MIGRATIONS, ...(review ? [REVIEW, REVIEW] : [])]) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
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

/** A replacement uploaded for a filed receipt and read by Keith: a slip in To Review. */
async function replacement(db, owner, id, { name = 'real receipt.jpg', type = 'image/jpeg', reading = { ...AMAZON, document_type: 'receipt' }, bytes = 'jpg bytes' } = {}) {
  const { receipt, upload } = await R.startReplace(db, owner, { id, fileName: name, contentType: type, size: bytes.length })
  await bucket(db).upload(upload.path, Buffer.from(bytes))
  const out = await R.readReceipt(db, owner, { id: receipt.id, complete: stub(reading), today: TODAY })
  return { id: receipt.id, path: upload.path, slip: out.receipt }
}
const filedOne = async (db, id) => (await R.filedReceipts(db, { fy: 2027, today: TODAY })).find(x => x.id === id)

test('Replace file sends the new file to To Review; the filed receipt keeps its file and says a replacement is pending', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  const rep = await replacement(db, owner, f.id)
  assert.equal(rep.slip.status, 'review', 'Keith read it like any upload')
  assert.equal(rep.slip.replaces_receipt_id, f.id)
  // Nothing about the filed receipt has changed.
  const [rec] = (await pg.query(`SELECT file_name, storage_path, content_type FROM budget_receipts WHERE id = $1`, [f.id])).rows
  assert.deepEqual(rec, { file_name: 'invoice.pdf', storage_path: f.path, content_type: 'application/pdf' })
  assert.match((await R.expenseReceiptUrl(db, { expenseId: f.acc.expense_ids[0] })).url, /invoice\.pdf$/)
  assert.deepEqual((await filedOne(db, f.id)).replacement, { id: rep.id, status: 'review', file_name: 'real receipt.jpg' })
  // It waits in To Review, named for the receipt it would replace, and is not offered as a duplicate.
  const tab = await R.intake(db, { today: TODAY })
  const slip = tab.waiting.find(x => x.id === rep.id)
  assert.deepEqual(slip.replaces, { id: f.id, vendor: 'Amazon', date: '2026-09-03', total: 58.57, filed_name: 'FY27_2026-09-03_Amazon_112-7730158_$58.57.pdf', document_type: 'invoice' })
  assert.equal(slip.duplicateFile, null)
  assert.equal(tab.filedCount, 1, 'a replacement is not a filed receipt')
  // It can never post rows of its own, and only one replacement waits at a time.
  await assert.rejects(R.acceptReceipt(db, owner, { id: rep.id, draft: slip.draft, today: TODAY }), (e) => e.code === 'is_replacement')
  await assert.rejects(R.startReplace(db, owner, { id: f.id, fileName: 'again.pdf', contentType: 'application/pdf', size: 4 }), (e) => e.code === 'replacement_pending')
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM budget_expenses WHERE deleted_at IS NULL AND source = 'receipt'`)).rows[0].n, 2)
})

test('accepting the replacement swaps the file in place: the rows and the filed record stay, the old bytes go', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  const before = (await pg.query(`SELECT id, amount::text, receipt_file_id FROM budget_expenses WHERE id = ANY($1) ORDER BY id`, [f.acc.expense_ids])).rows
  const rep = await replacement(db, owner, f.id)
  const out = await R.acceptReplacement(db, owner, { id: rep.id })
  assert.deepEqual([out.replaced, out.receipt_id, out.differs], [true, f.id, null])
  assert.equal(out.filed_name, 'FY27_2026-09-03_Amazon_112-7730158_$58.57.jpg', 'the same filed name, the new file type')
  assert.equal(out.message, 'The filed receipt now has the new file. The old one is deleted.')

  const all = (await pg.query(`SELECT id, status, file_name, storage_path, content_type, proposal->>'document_type' AS kind, expense_ids FROM budget_receipts`)).rows
  assert.equal(all.length, 1, 'the slip is gone: its file is the filed receipt’s now')
  assert.deepEqual([all[0].id, all[0].status, all[0].file_name, all[0].storage_path, all[0].content_type, all[0].kind], [f.id, 'accepted', 'real receipt.jpg', rep.path, 'image/jpeg', 'receipt'])
  assert.deepEqual([...all[0].expense_ids].sort(), [...f.acc.expense_ids].sort())
  const [doc] = (await pg.query(`SELECT id, storage_path, content_type, file_name FROM record_documents`)).rows
  assert.deepEqual(doc, { id: f.acc.record_document_id, storage_path: rep.path, content_type: 'image/jpeg', file_name: out.filed_name })
  assert.deepEqual((await pg.query(`SELECT id, amount::text, receipt_file_id FROM budget_expenses WHERE id = ANY($1) ORDER BY id`, [f.acc.expense_ids])).rows, before, 'no row changed')
  assert.ok((await bucket(db).download(f.path)).error, 'the invoice is deleted')
  assert.match((await R.expenseReceiptUrl(db, { expenseId: f.acc.expense_ids[0] })).url, /real-receipt\.jpg$/)
  assert.equal((await filedOne(db, f.id)).replacement, null)
  const log = (await pg.query(`SELECT new_value FROM budget_changes WHERE entity = 'receipt' AND entity_id = $1 AND action = 'update'`, [f.id])).rows
  assert.deepEqual(log[0].new_value.replaced_file, { from: 'invoice.pdf', to: 'real receipt.jpg' })
  await assert.rejects(R.acceptReplacement(db, owner, { id: rep.id }), /no longer exists/)
})

test('a different total is reported and changes nothing; rejecting a replacement leaves the filed receipt as it was', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  const a = await replacement(db, owner, f.id, { name: 'wrong.pdf', type: 'application/pdf', reading: { ...AMAZON, total: 60 } })
  await R.rejectReceipt(db, owner, { id: a.id })
  assert.equal((await filedOne(db, f.id)).replacement, null, 'a rejected replacement is no longer pending')
  assert.match((await R.expenseReceiptUrl(db, { expenseId: f.acc.expense_ids[0] })).url, /invoice\.pdf$/)
  await assert.rejects(R.acceptReplacement(db, owner, { id: a.id }), /not waiting for review/)
  // Another can be sent now, and its different total is said in words.
  const b = await replacement(db, owner, f.id, { name: 'r2.pdf', type: 'application/pdf', reading: { ...AMAZON, total: 60 } })
  const out = await R.acceptReplacement(db, owner, { id: b.id })
  assert.deepEqual(out.differs, { receipt: 60, rows: 58.57 })
  assert.match(out.message, /The new file totals \$60\.00 and the Sheet has \$58\.57; nothing in the Sheet was changed\./)
  assert.equal((await pg.query(`SELECT sum(amount)::text AS s FROM budget_expenses WHERE id = ANY($1)`, [f.acc.expense_ids])).rows[0].s, '58.57')
})

test('rejected receipts are listed, and each can be viewed, put back in To Review, or deleted for good', async () => {
  const { pg, db, owner } = await world()
  const { receipt, upload } = await R.startUpload(db, owner, { fileName: 'oops.pdf', contentType: 'application/pdf', size: 5 })
  await bucket(db).upload(upload.path, Buffer.from('%PDF!'))
  await R.readReceipt(db, owner, { id: receipt.id, complete: stub(AMAZON), today: TODAY })
  await R.rejectReceipt(db, owner, { id: receipt.id })
  let tab = await R.intake(db, { today: TODAY })
  assert.deepEqual(tab.rejected.map(x => [x.id, x.status]), [[receipt.id, 'rejected']])
  assert.match((await R.fileUrl(db, { id: receipt.id })).url, /oops\.pdf$/, 'View original still opens it')
  assert.deepEqual(await R.restoreReceipt(db, owner, { id: receipt.id }), { restored: true, status: 'review' })
  tab = await R.intake(db, { today: TODAY })
  assert.deepEqual([tab.rejected.length, tab.waiting.map(x => x.id)], [0, [receipt.id]])
  await assert.rejects(R.restoreReceipt(db, owner, { id: receipt.id }), /Only a rejected receipt/)
  await R.rejectReceipt(db, owner, { id: receipt.id })
  assert.deepEqual(await R.deleteReceipt(db, owner, { id: receipt.id }), { deleted: true, rows: 0 })
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM budget_receipts`)).rows[0].n, 0)
  assert.ok((await bucket(db).download(upload.path)).error, 'the bytes are gone')
  assert.equal((await pg.query(`SELECT new_value->>'file_name' AS f FROM budget_changes WHERE entity = 'receipt' AND action = 'delete'`)).rows[0].f, 'oops.pdf')
})

test('Replace refuses a wrong type and a receipt that is not filed; deleting the filed receipt frees its pending replacement', async () => {
  const { pg, db, owner } = await world()
  const f = await filed(db, owner)
  await assert.rejects(R.startReplace(db, owner, { id: f.id, fileName: 'x.docx', contentType: 'application/msword', size: 5 }), /Add a photo/)
  const { receipt } = await R.startUpload(db, owner, { fileName: 'new.pdf', contentType: 'application/pdf', size: 5 })
  await assert.rejects(R.startReplace(db, owner, { id: receipt.id, fileName: 'x.pdf', contentType: 'application/pdf', size: 5 }), /Only a filed receipt/)
  await assert.rejects(R.deleteReceipt(db, owner, { id: receipt.id }), /Only a filed receipt/)
  await assert.rejects(R.acceptReplacement(db, owner, { id: f.id }), /not a replacement/)
  const rep = await replacement(db, owner, f.id)
  await R.deleteReceipt(db, owner, { id: f.id })
  const [left] = (await pg.query(`SELECT id, status, replaces_receipt_id FROM budget_receipts WHERE id = $1`, [rep.id])).rows
  assert.deepEqual(left, { id: rep.id, status: 'review', replaces_receipt_id: null }, 'an ordinary receipt waiting for review now')
  assert.equal((await R.intake(db, { today: TODAY })).waiting.find(x => x.id === rep.id).replaces, null)
})

test('before the update, Replace file says what it needs and nothing else changes', async () => {
  const { db, owner } = await world({ review: false })
  const f = await filed(db, owner)
  await assert.rejects(R.startReplace(db, owner, { id: f.id, fileName: 'a.pdf', contentType: 'application/pdf', size: 4 }), (e) => e.code === 'not_enabled' && /20261102000000_receipt_replace_review\.sql/.test(e.message))
  const r = await filedOne(db, f.id)
  assert.deepEqual([r.replacement, r.replaceEnabled], [null, false])
  assert.deepEqual((await R.intake(db, { today: TODAY })).rejected, [])
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

test('every one of these is the Owner’s through the endpoint: an Admin is refused, and an unknown field is refused', async () => {
  const { pg, db, owner } = await world()
  const { rows: [admin] } = await pg.query(`INSERT INTO user_profiles (full_name, email, role, is_owner) VALUES ('An Admin', 'a@x.org', 'admin', false) RETURNING *`)
  const f = await filed(db, owner)
  const as = (profile) => createBudgetStaffHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => db, today: () => TODAY, complete: stub({ ...AMAZON, document_type: 'receipt' }) })
  for (const body of [{ action: 'receipt_replace_start', id: f.id, file_name: 'a.pdf', content_type: 'application/pdf', size: 4 }, { action: 'receipt_replace_accept', id: f.id }, { action: 'receipt_restore', id: f.id }, { action: 'receipt_delete', id: f.id }]) {
    assert.equal((await call(as(admin), body)).status, 403, `${body.action} is Owner-only`)
  }
  const st = await call(as(owner), { action: 'receipt_replace_start', id: f.id, file_name: 'a.pdf', content_type: 'application/pdf', size: 4 })
  assert.equal(st.status, 200)
  await bucket(db).upload(st.body.upload.path, Buffer.from('%PDF'))
  assert.equal((await call(as(owner), { action: 'receipt_read', id: st.body.receipt.id })).body.receipt.status, 'review')
  const fin = await call(as(owner), { action: 'receipt_replace_accept', id: st.body.receipt.id })
  assert.deepEqual([fin.status, fin.body.replaced, fin.body.receipt_id], [200, true, f.id])
  assert.equal((await call(as(owner), { action: 'receipt_replace_finish', id: f.id })).status, 400, 'the direct swap is gone')
  assert.equal((await call(as(owner), { action: 'receipt_delete', id: f.id, rows: 'too' })).status, 400)
  assert.deepEqual((await call(as(owner), { action: 'receipt_delete', id: f.id })).body, { deleted: true, rows: 2 })
})

test('the screens: the modal sends a replacement to review and says it is pending; To Review reviews it; Rejected can be viewed, restored, deleted', () => {
  const modal = read('src/components/budget/ReceiptModal.jsx')
  assert.match(modal, /receipt_replace_start[\s\S]*uploadReceiptFile[\s\S]*budgetStaff\('receipt_read', \{ id: receipt\.id \}\)/, 'upload, then Keith reads it')
  assert.doesNotMatch(modal, /receipt_replace_finish|receipt_replace_accept/, 'never accepted from the modal')
  assert.match(modal, /<b>Replacement pending review<\/b>/)
  assert.match(modal, /disabled=\{!!busy \|\| !!r\.replacement\}/)
  assert.match(modal, /Delete for good/)
  assert.match(modal, /role="alertdialog"/)
  const tab = read('src/components/budget/BudgetReceipts.jsx')
  assert.match(tab, /s\.replaces && s\.draft\s*\? <ReplacementSlip/)
  assert.match(tab, /budgetStaff\('receipt_replace_accept', \{ id: slip\.id \}\)/)
  assert.match(tab, /<h2>Rejected<\/h2>/)
  for (const a of ['receipt_restore', 'receipt_delete']) assert.match(tab, new RegExp(`budgetStaff\\('${a}', \\{ id: slip\\.id \\}\\)`))
  assert.match(tab, />View original<\/button>\s*<button[^>]*onClick=\{\(\) => onRestore\(s\)\}>Back to review<\/button>\s*<button[^>]*onClick=\{\(\) => setAskDelete\(s\.id\)\}>Delete<\/button>/)
  const slip = read('src/components/budget/ReceiptSlip.jsx')
  assert.match(slip, /Replace the filed receipt/)
  assert.match(slip, /Keith reads this file as \$\{DOC_WORD\[p\.document_type\]\}, not a receipt\./)
  const sql = read(`supabase/migrations/${REVIEW}.sql`)
  assert.match(sql, /OWNER-GATED: do not apply from a session/)
  assert.match(sql, /ON DELETE SET NULL/)
  assert.match(read('docs/security/OWNER_SQL_GATE.md'), /20261102000000_receipt_replace_review\.sql/)
})
