// lib/server/budget/receipts.js
//
// PROGRAM-BUDGET Phase B (BUDGET-B2, 2026-09-27): receipt intake, the server side. Owner only;
// /api/budget-staff calls these after checking the caller holds budget_admin.
//
//   startUpload     a receipt row and a signed upload URL into the private 'record-documents'
//                   bucket (budget/receipts/<id>/...). The browser uploads straight to storage, so a
//                   10 MB PDF never passes through a function body.
//   readReceipt     Keith reads it: the governed 'read-receipt' skill through runKeithSkill (the
//                   Keith foundation, KEITH-FOUNDATION-1), with the file as an image or document
//                   block, metered in Usage & Cost, with one provenance record per reading.
//   intake          everything the Receipts tab shows, and the context its checks run on.
//   saveDraft       the slip's edits, kept as they are made.
//   acceptReceipt   post the rows (or attach to the matched row), file the original privately,
//                   record the owner's category corrections and the whole chain (B6).
//   snooze, reject, undo, fileUrl, rules, settings.
//
// "One transaction" (B6) over PostgREST is a sequence with compensation: if a later step fails,
// the rows already written are soft-deleted and the filed record removed, and the receipt stays
// in review. Undo is the same reversal, on request, for 10 minutes.

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { BudgetError, notEnabled, createExpense, postDueCharges, internals as I } from './engine.js'
import {
  PROGRAM, fiscalYearOfDate, fyShort, yearState, defaultStatus, counts, usd, dateText, pacificToday, paymentLabel, statusLabel,
} from '../../../src/lib/budget/budgetModel.js'
import { addDays } from '../../../src/lib/rotationCalendarDates.js'
import { parseReading, draftFrom, rowsFrom, filedName, cleanAttendees, draftTotal, ReadingError, RECEIPT_TYPES, RECEIPT_MAX_BYTES, LINE_FLAGS, CONFIDENCE } from '../../../src/lib/budget/receiptModel.js'
import { receiptChecks } from '../../../src/lib/budget/receiptChecks.js'
import { GUARDED } from '../../../src/lib/budget/chargeMatch.js'
import { completeWithoutTools } from '../keith/anthropicClient.js'
import { recordKeithUsage, OUTCOMES } from '../keith/usageLog.js'
import { runKeithSkill, recordKeithOutcome, provenanceIdFor, provenanceIdsFor, loadSkill } from '../keith/runKeithSkill.js'
import { authorizeSkillForCaller } from '../keith/skillAuthorization.js'
import { skillMode } from '../../../src/lib/keith/provenanceModel.js'
import { parseEml } from './eml.js'

export const RECEIPT_BUCKET = 'record-documents'
export const READ_SKILL = 'read-receipt'
export const UNDO_WINDOW_MS = 10 * 60 * 1000
export const SNOOZE_DAYS = 7
const IMAGE_LIMIT = 5 * 1024 * 1024            // the model's own limit for one image
const CORRECTION_EXAMPLES = 20
const WAITING = ['uploading', 'reading', 'review', 'failed']
const OPEN = ['review', 'snoozed', 'held']          // a slip the owner can still decide
const PHASE1 = 'This needs the Program Budget v2 database update (20261021000000_budget_v2_phase1.sql).'
const NOT_ENABLED = 'Receipts are not enabled yet. Their database update (20261013000000_budget_receipts.sql) has not been applied.'

const { q, num, expIn, logChanges, categoriesOf, allocationsOf, monthsOf, closedSetOf } = I
const actorName = (a) => a?.full_name || a?.email || ''
const ymd = (v) => (v ? String(v).slice(0, 10) : null)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function r(query, code = 'db_failed', message = 'The receipts could not be read.') {
  const { data, error } = await query
  if (error) {
    if (notEnabled(error)) throw new BudgetError('not_enabled', NOT_ENABLED, 409)
    throw new BudgetError(code, message, 500)
  }
  return data
}
const receiptOf = async (db, id) => {
  if (!UUID.test(String(id || ''))) throw new BudgetError('not_found', 'That receipt no longer exists.', 404)
  const row = (await r(db.from('budget_receipts').select('*').eq('id', id).limit(1)))[0]
  if (!row) throw new BudgetError('not_found', 'That receipt no longer exists.', 404)
  return { ...row, snoozed_until: ymd(row.snoozed_until) }
}
const logReceipt = (db, id, action, value, actor) => logChanges(db, 'receipt', id, null, action, [{ new: value }], actor)
const storage = (db) => db.storage.from(RECEIPT_BUCKET)

// ── Status ──────────────────────────────────────────────────────────────────────

export async function receiptsStatus(db) {
  const { error } = await db.from('budget_receipts').select('id').limit(1)
  if (notEnabled(error)) return { enabled: false }
  if (error) throw new BudgetError('db_failed', 'The receipts could not be read.', 500)
  const skill = (await r(db.from('keith_skills').select('id, status, enabled').eq('slug', READ_SKILL).limit(1)))[0]
  return { enabled: true, keith: skill ? (skill.status === 'active' && skill.enabled ? 'on' : 'off') : 'missing' }
}

// ── Upload ──────────────────────────────────────────────────────────────────────

const safeName = (s) => String(s || 'receipt').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-120) || 'receipt'

export async function startUpload(db, actor, { fileName, contentType, size }) {
  const type = String(contentType || '').toLowerCase()
  if (!RECEIPT_TYPES[type]) throw new BudgetError('invalid_type', 'Add a photo (JPEG, PNG, WebP or GIF), a PDF or a saved order email (.eml).')
  const bytes = Number(size)
  if (!Number.isFinite(bytes) || bytes <= 0) throw new BudgetError('invalid_size', 'That file is empty.')
  if (bytes > RECEIPT_MAX_BYTES) throw new BudgetError('too_large', 'That file is over 10 MB. Save a smaller copy and add it again.')
  const id = randomUUID()
  const path = `budget/receipts/${id}/${safeName(fileName)}`
  const [row] = await r(db.from('budget_receipts').insert({
    id, status: 'uploading', file_name: String(fileName || 'receipt').slice(0, 200), storage_path: path, content_type: type, size_bytes: bytes, uploaded_by: actor?.id || null,
  }).select(), 'save_failed', 'The receipt could not be added.')
  const { data, error } = await storage(db).createSignedUploadUrl(path)
  if (error || !data) {
    await db.from('budget_receipts').delete().eq('id', id)
    throw new BudgetError('upload_failed', 'The receipt could not be uploaded. Try again.', 502)
  }
  await logReceipt(db, id, 'upload', { file_name: row.file_name, content_type: type, size_bytes: bytes }, actor)
  return { receipt: slipView(row), upload: { path, token: data.token, signedUrl: data.signedUrl } }
}

/** Remove a receipt that never finished uploading, or one the owner removes while Keith reads. */
export async function discardUpload(db, actor, { id }) {
  const rec = await receiptOf(db, id)
  if (!['uploading', 'failed', 'reading'].includes(rec.status)) throw new BudgetError('invalid_state', 'Only a receipt that has not been read can be removed. Reject it instead.', 409)
  await storage(db).remove([rec.storage_path]).catch(() => {})
  await r(db.from('budget_receipts').delete().eq('id', id), 'save_failed', 'The receipt could not be removed.')
  return { removed: true }
}

// ── Reading (Keith) ─────────────────────────────────────────────────────────────

async function bytesOf(db, path) {
  const { data, error } = await storage(db).download(path)
  if (error || !data) throw new BudgetError('file_missing', 'The uploaded file could not be found. Add it again.', 404)
  return Buffer.from(await data.arrayBuffer())
}

/** The file as content blocks Keith can read. An email becomes its text plus its first attachment. */
function contentOf(rec, bytes) {
  const block = (type, buf) => {
    if (type === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
    if (buf.length > IMAGE_LIMIT) throw new BudgetError('image_too_large', 'That photo is over 5 MB, too large for Keith to read. Save a smaller copy or a PDF and add it again.')
    return { type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } }
  }
  if (rec.content_type !== 'message/rfc822') return [block(rec.content_type, bytes)]
  const mail = parseEml(bytes)
  const out = [{ type: 'text', text: `SAVED ORDER EMAIL\nFrom: ${mail.from}\nDate: ${mail.date}\nSubject: ${mail.subject}\n\n${mail.text || '(no readable text)'}` }]
  const att = mail.attachments[0]
  if (att) out.push(block(att.contentType, att.bytes))
  if (!mail.text && !att) throw new BudgetError('eml_empty', 'That email has no text or attachment Keith can read.')
  return out
}

async function corrections(db) {
  const { data, error } = await db.from('budget_category_corrections').select('id, vendor, item, from_category, to_category').order('created_at', { ascending: false }).limit(CORRECTION_EXAMPLES)
  return error ? [] : data || []
}

/** The P-card and the remembered cards. Before the v2 update there are no remembered cards. */
async function settingsOf(db) {
  const { data, error } = await db.from('budget_settings').select('pcard_last4, remembered_cards').eq('program', PROGRAM).limit(1)
  if (error) {                                       // before the v2 update: the P-card alone
    const old = await db.from('budget_settings').select('pcard_last4').eq('program', PROGRAM).limit(1)
    return { pcardLast4: old.error ? '' : old.data?.[0]?.pcard_last4 || '', rememberedCards: [], cardsEnabled: false }
  }
  const row = data?.[0]
  return { pcardLast4: row?.pcard_last4 || '', rememberedCards: Array.isArray(row?.remembered_cards) ? row.remembered_cards : [], cardsEnabled: true }
}

/**
 * Keith reads one receipt. `complete` is the model call (a test passes a stub). The receipt ends
 * in 'review' with a proposal and a draft, or in 'failed' with the reason in words.
 */
export async function readReceipt(db, actor, { id, complete = completeWithoutTools, today = pacificToday() }) {
  const rec = await receiptOf(db, id)
  if (!['uploading', 'failed', 'review', 'reading'].includes(rec.status)) throw new BudgetError('invalid_state', 'This receipt has already been decided.', 409)
  const OFF = 'Keith’s Read Receipt skill is off. Turn it on in Settings > Keith > Skills, then read this receipt again.'
  // The runner refuses an OFF or unauthorized skill too; asking first keeps the receipt's status as it was.
  const skill = await loadSkill(db, READ_SKILL).catch(() => null)
  if (!skill || skillMode(skill) === 'off' || !authorizeSkillForCaller(skill, { profileId: actor?.id, role: actor?.role, isOwner: actor?.is_owner === true }).ok) {
    throw new BudgetError('keith_off', OFF, 409)
  }
  await r(db.from('budget_receipts').update({ status: 'reading', read_error: null, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be updated.')

  const started = Date.now()
  const fail = async (message, outcome = null) => {
    await db.from('budget_receipts').update({ status: 'failed', read_error: message, updated_at: new Date().toISOString() }).eq('id', id)
    // A failure before the model call is metered here; the runner meters its own.
    if (outcome) await recordKeithUsage(db, { requestId: randomUUID(), profileId: actor?.id, role: 'owner', intent: 'receipt_reading', skillId: skill.id, skillVersion: skill.version, rounds: 0, durationMs: Date.now() - started, outcome })
    return { receipt: slipView({ ...rec, status: 'failed', read_error: message }) }
  }

  let bytes, content
  try {
    bytes = await bytesOf(db, rec.storage_path)
    content = contentOf(rec, bytes)
  } catch (e) { return fail(e.message, OUTCOMES.MISSING_DATA) }
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  const categories = (await categoriesOf(db)).filter(c => c.is_active).map(c => c.name)
  const examples = await corrections(db)
  const run = await runKeithSkill(db, READ_SKILL, {
    receipt_file: { value: content, refs: [{ type: 'budget_receipt_file', id }] },
    categories: { value: categories },
    corrections: { value: examples, refs: examples.filter(x => x.id).map(x => ({ type: 'budget_category_correction', id: x.id })) },
    today: { value: today },
  }, { actor, entity: { id, field: 'reading' }, complete, dataSources: { receipt: { id, content_type: rec.content_type, bytes: bytes.length } } })

  if (!run.ok) {
    if (run.reason === 'off' || run.reason === 'denied') {
      await db.from('budget_receipts').update({ status: rec.status, updated_at: new Date().toISOString() }).eq('id', id)
      throw new BudgetError('keith_off', OFF, 409)
    }
    if (run.reason === 'invalid_output') {
      // The same words the reading gave before the foundation (receiptModel.jsonOf and parseReading).
      const why = run.error instanceof ReadingError ? run.error.message
        : run.error?.code === 'no_json' ? 'Keith did not return a reading.'
          : run.error?.code === 'bad_json' ? 'Keith’s reading was not valid JSON.'
            : 'Keith’s reading was not in the expected form.'
      return fail(`${why} Check that the file is a receipt, then read it again.`)
    }
    return fail(run.reason === 'timeout' ? 'Keith took too long to read this receipt. Read it again.'
      : run.reason === 'missing_api_key' ? 'Keith is not set up on this server (no API key).'
        : 'Keith could not read this receipt just now. Read it again in a moment.')
  }
  // Shadow mode: the reading is kept in provenance for comparison, and nothing acts on it.
  if (run.mode === 'shadow') return fail('Keith’s Read Receipt skill is in shadow mode, so its reading is kept for comparison and not used. Set it to On in Settings > Keith > Skills to read receipts.')

  const proposal = run.output
  const cards = await settingsOf(db)
  const draft = draftFrom(proposal, { pcardLast4: cards.pcardLast4, rememberedCards: cards.rememberedCards })
  const [saved] = await r(db.from('budget_receipts').update({
    status: 'review', proposal, draft, sha256, read_model: run.model, read_at: new Date().toISOString(), read_error: null, updated_at: new Date().toISOString(),
  }).eq('id', id).select(), 'save_failed', 'Keith’s reading could not be saved.')
  await logReceipt(db, id, 'read', { vendor: proposal.vendor, total: proposal.total, lines: proposal.lines.length, model: run.model }, actor)
  return { receipt: slipView({ ...saved, snoozed_until: ymd(saved.snoozed_until), keith_provenance_id: run.provenanceId }) }
}

// ── What the tab shows ──────────────────────────────────────────────────────────

function slipView(rec) {
  return {
    id: rec.id, status: rec.status, file_name: rec.file_name, content_type: rec.content_type, size_bytes: num(rec.size_bytes),
    proposal: rec.proposal || null, draft: rec.draft || null, read_error: rec.read_error || null, read_model: rec.read_model || null,
    read_at: rec.read_at || null, snoozed_until: rec.snoozed_until || null, decided_at: rec.decided_at || null, filed_name: rec.filed_name || null,
    record_document_id: rec.record_document_id || null, expense_ids: rec.expense_ids || [], attached: rec.attached === true,
    held_subscription_id: rec.held_subscription_id || null, held_charge_date: ymd(rec.held_charge_date),
    sha256: rec.sha256 || null, created_at: rec.created_at, keith_provenance_id: rec.keith_provenance_id || null, canUndo: !!rec.undo && !!rec.decided_at && Date.now() - Date.parse(rec.decided_at) < UNDO_WINDOW_MS,
  }
}

/** The facts every slip's checks read: every live expense, each year's state, spend and plan. */
export async function checksContext(db, today = pacificToday()) {
  const categories = await categoriesOf(db)
  const catName = new Map(categories.map(c => [c.id, c.name]))
  const budgets = await q(db.from('budgets').select('*').eq('program', PROGRAM))
  const years = new Map()
  const expenses = []
  for (const b of budgets.sort((a, c) => a.fiscal_year - c.fiscal_year)) {
    const rows = (await q(db.from('budget_expenses').select('*').eq('budget_id', b.id).is('deleted_at', null).order('expense_date').order('created_at'))).map(expIn)
    rows.forEach((e, i) => expenses.push({
      id: e.id, expense_date: e.expense_date, date_precision: e.date_precision, vendor: e.vendor, amount: e.amount, order_number: e.order_number,
      item: e.item, payment_method: e.payment_method, status: e.status, receipt_file_id: e.receipt_file_id || null, fy: b.fiscal_year,
      subscription_id: e.subscription_id || null, charge_date: e.charge_date || null, state: e.state || 'posted', notes: e.notes || '',
      row_label: `${fyShort(b.fiscal_year)} row ${i + 1}`,
    }))
    const spent = {}
    for (const e of rows.filter(counts)) { const n = catName.get(e.category_id) || 'Uncategorized'; spent[n] = Math.round(((spent[n] || 0) + e.amount) * 100) / 100 }
    const alloc = await allocationsOf(db, b.id)
    const plan = {}
    for (const a of alloc) if (a.amount) plan[catName.get(a.category_id)] = a.amount
    // BUDGET-V2 item 13: a receipt dated in a closed month waits until the owner reopens it.
    const closedMonths = [...closedSetOf((await monthsOf(db, b.id)).rows)]
    years.set(b.fiscal_year, { state: yearState(b, b.fiscal_year, today), total: num(b.total), spent, plan: Object.keys(plan).length ? plan : null, closedMonths })
  }
  const { data: rules } = await db.from('budget_policy_rules').select('*').order('sort_order')
  const cards = await settingsOf(db)
  // BUDGET-V2 item 1: every plan, for the charge match. Only what the match reads.
  const subscriptions = (await q(db.from('budget_subscriptions').select('id, name, vendor, billing, amount, anchor_date, start_date, end_date, approval_state, post_from, deleted_at').eq('program', PROGRAM).is('deleted_at', null)))
    .map(x => ({ ...x, amount: num(x.amount), anchor_date: ymd(x.anchor_date), start_date: ymd(x.start_date), end_date: ymd(x.end_date), post_from: ymd(x.post_from) }))
  return {
    expenses, years, rules: rules || [], pcardLast4: cards.pcardLast4, rememberedCards: cards.rememberedCards, cardsEnabled: cards.cardsEnabled,
    subscriptions, today, categories: categories.filter(c => c.is_active).map(c => ({ id: c.id, name: c.name })),
  }
}

/** The Receipts tab: waiting slips (oldest first), snoozed ones, the last decided, and the check context. */
export async function intake(db, { today = pacificToday() } = {}) {
  const rows = (await r(db.from('budget_receipts').select('*').order('created_at'))).map(x => ({ ...x, snoozed_until: ymd(x.snoozed_until) }))
  const due = (x) => x.status === 'snoozed' && x.snoozed_until && x.snoozed_until <= today
  const ctx = await checksContext(db, today)
  const acceptedBySha = new Map(rows.filter(x => x.status === 'accepted' && x.sha256).map(x => [x.sha256, x]))
  const prov = await provenanceIdsFor(db, 'budget_receipt', rows.filter(x => x.proposal).map(x => x.id))
  const view = (x) => {
    const v = slipView({ ...x, keith_provenance_id: prov.get(x.id) || null })
    const dupFile = x.sha256 ? acceptedBySha.get(x.sha256) : null
    return { ...v, duplicateFile: dupFile && dupFile.id !== x.id ? { id: dupFile.id, decided_at: dupFile.decided_at } : null }
  }
  return {
    waiting: rows.filter(x => WAITING.includes(x.status) || due(x)).map(view),
    snoozed: rows.filter(x => x.status === 'snoozed' && !due(x)).map(view),
    held: rows.filter(x => x.status === 'held').map(view),
    recent: rows.filter(x => ['accepted', 'rejected'].includes(x.status)).sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at))).slice(0, 12).map(view),
    filedCount: rows.filter(x => x.status === 'accepted').length,
    context: { ...ctx, years: Object.fromEntries(ctx.years) },
  }
}

/**
 * RECEIPT-ORGANIZER-1: every accepted receipt of a fiscal year (by its date), for Filed, with the Sheet
 * rows it posted or attached to, as the Sheet numbers them. Items feed the search; the rows' own
 * categories, amounts and statuses are read live, so a row edited in the Sheet shows its edit here.
 */
export async function filedReceipts(db, { fy, today = pacificToday() } = {}) {
  const rows = (await r(db.from('budget_receipts').select('*').eq('status', 'accepted').order('decided_at', { ascending: false })))
  const ctx = await checksContext(db, today)
  const byId = new Map(ctx.expenses.map(e => [e.id, e]))
  const cats = new Map(ctx.categories.map(c => [c.id, c.name]))
  const ids = [...new Set(rows.flatMap(x => x.expense_ids || []))]
  const live = ids.length ? (await q(db.from('budget_expenses').select('id, item, category_id, amount, status, payment_method, business_purpose, attendees, deleted_at').in('id', ids))).map(expIn) : []
  const liveById = new Map(live.map(e => [e.id, e]))
  const deciders = [...new Set(rows.map(x => x.decided_by).filter(Boolean))]
  const names = new Map(deciders.length ? (await q(db.from('user_profiles').select('id, full_name').in('id', deciders))).map(p => [p.id, p.full_name]) : [])
  const out = []
  for (const x of rows) {
    const d = x.draft || {}
    const p = x.proposal || {}
    const date = d.date || p.date || ''
    if (fy && (!date || fiscalYearOfDate(date) !== fy)) continue
    const posted = (x.expense_ids || []).map(id => {
      const e = liveById.get(id)
      if (!e || e.deleted_at) return null
      return {
        id, row_label: byId.get(id)?.row_label || null, item: e.item, category: cats.get(e.category_id) || null, amount: e.amount,
        status: e.status, statusLabel: statusLabel(e.status) || 'Not recorded', payment: paymentLabel(e.payment_method) || 'Not recorded',
        business_purpose: e.business_purpose || '', attendees: Array.isArray(e.attendees) ? e.attendees : [],
      }
    }).filter(Boolean)
    out.push({
      id: x.id, date, vendor: d.vendor || p.vendor || x.file_name, order_number: d.order_number || p.order_number || '',
      total: x.attached ? (p.total ?? draftTotal(d)) : draftTotal(d), attached: x.attached === true,
      proposal: p, items: (d.lines || []).map(l => l.item), rows: posted,
      filed_name: x.filed_name, content_type: x.content_type, decided_at: x.decided_at, decided_by: names.get(x.decided_by) || '',
    })
  }
  return out
}

/** For the Action Center (B7): receipts waiting for review, oldest first. */
export async function reviewQueue(db, { today = pacificToday() } = {}) {
  const rows = (await r(db.from('budget_receipts').select('id, status, file_name, proposal, draft, snoozed_until, created_at').order('created_at'))).map(x => ({ ...x, snoozed_until: ymd(x.snoozed_until) }))
  return rows.filter(x => x.status === 'review' || (x.status === 'snoozed' && x.snoozed_until && x.snoozed_until <= today)).map(x => {
    const rows = x.draft ? rowsFrom(x.draft) : []
    return { id: x.id, file_name: x.file_name, vendor: x.draft?.vendor || x.proposal?.vendor || x.file_name, total: x.draft ? draftTotal(x.draft) : x.proposal?.total || 0, rows: rows.length, categories: [...new Set(rows.map(y => y.category).filter(Boolean))], created_at: x.created_at }
  })
}

// ── The slip's edits ────────────────────────────────────────────────────────────

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const moneyOf = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : 0 }

/** A draft from the browser, cleaned to what a draft may hold. Categories must be on the list. */
export function cleanDraft(d, categoryNames = []) {
  const names = new Set(categoryNames)
  const src = d && typeof d === 'object' ? d : {}
  const method = ['p_card', 'personal_concur', 'po_invoice'].includes(src.payment_method) ? src.payment_method : null
  return {
    vendor: clip(src.vendor, 120), order_number: clip(src.order_number, 80),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(src.date || '')) ? String(src.date) : '',
    total: moneyOf(src.total),
    lines: (Array.isArray(src.lines) ? src.lines : []).slice(0, 40).map((l, i) => ({
      id: clip(l?.id, 40) || `l${i}`, item: clip(l?.item, 200), category: names.has(l?.category) ? l.category : null,
      quantity: (() => { const n = Number(l?.quantity); return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : 1 })(),
      amount: moneyOf(l?.amount), base: moneyOf(l?.base), confidence: CONFIDENCE.includes(l?.confidence) ? l.confidence : 'low',
      reason: clip(l?.reason, 200), flags: (Array.isArray(l?.flags) ? l.flags : []).filter(f => LINE_FLAGS.includes(f)), set_by_owner: l?.set_by_owner === true,
    })),
    payment_method: method,
    cohort_id: UUID.test(String(src.cohort_id || '')) ? src.cohort_id : null,
    business_purpose: String(src.business_purpose ?? '').trim().slice(0, 1000),
    attendees: cleanAttendees(src.attendees),
  }
}

export async function saveDraft(db, actor, { id, draft }) {
  const rec = await receiptOf(db, id)
  if (rec.status !== 'review' && rec.status !== 'snoozed') throw new BudgetError('invalid_state', 'This receipt is not waiting for review.', 409)
  const names = (await categoriesOf(db)).filter(c => c.is_active).map(c => c.name)
  const clean = cleanDraft(draft, names)
  await r(db.from('budget_receipts').update({ draft: clean, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The slip could not be saved.')
  const keith = await noteKeithEdits(db, id, rec.draft, clean, actor)
  return { draft: clean, ...(keith ? { keith_state: keith } : {}) }
}

/**
 * KEITH-FOUNDATION-1: what the owner changed of Keith's reading, for the Keith mark. Changing a line,
 * the vendor, date or order number, the payment method or the cohort is an edit; a business meal's
 * purpose and attendees are the owner's own additions, not a change to what Keith read. Keyed by the
 * line's id, so a line renamed twice is one change.
 */
export function keithEdits(before, after) {
  if (!before || !after) return []
  const out = []
  for (const k of ['vendor', 'order_number', 'date', 'payment_method', 'cohort_id']) {
    if (String(before[k] ?? '') !== String(after[k] ?? '')) out.push({ field: k, from: before[k] ?? null, to: after[k] ?? null })
  }
  const was = new Map((before.lines || []).map(l => [l.id, l]))
  for (const l of after.lines || []) {
    const b = was.get(l.id)
    if (!b) { out.push({ field: 'line', line: l.id, added: l.item }); continue }
    for (const k of ['item', 'category', 'quantity', 'amount']) {
      if (String(b[k] ?? '') !== String(l[k] ?? '')) out.push({ field: `line.${k}`, line: l.id, item: l.item, from: b[k] ?? null, to: l[k] ?? null })
    }
  }
  for (const b of before.lines || []) if (!(after.lines || []).some(l => l.id === b.id)) out.push({ field: 'line', line: b.id, removed: b.item })
  return out
}

/** Record the owner's edits on the receipt's Keith provenance. Never blocks the save. */
async function noteKeithEdits(db, id, before, after, actor) {
  const edits = keithEdits(before, after)
  if (!edits.length) return null
  return recordKeithOutcome(db, await provenanceIdFor(db, 'budget_receipt', id), 'edit', edits, actor)
}

const keithOutcome = async (db, id, action, actor) => recordKeithOutcome(db, await provenanceIdFor(db, 'budget_receipt', id), action, null, actor)

// ── Accept and file (B6) ────────────────────────────────────────────────────────

/**
 * Accept a slip. With `attachTo` (the duplicate's row, or any row the owner names) the receipt is
 * filed on that row and nothing new is posted. Returns the rows written and the filed name.
 */
export async function acceptReceipt(db, actor, { id, draft, attachTo = null, attachCharge = false, asOneTime = false, today = pacificToday() }) {
  const rec = await receiptOf(db, id)
  if (!OPEN.includes(rec.status)) throw new BudgetError('invalid_state', 'This receipt is not waiting for review.', 409)
  const categories = (await categoriesOf(db)).filter(c => c.is_active)
  const catId = new Map(categories.map(c => [c.name, c.id]))
  const d = cleanDraft(draft || rec.draft, categories.map(c => c.name))
  let ctx = await checksContext(db, today)
  let result = receiptChecks(d, { ...ctx, proposal: rec.proposal || {} })
  // BUDGET-V2 item 1: a receipt for a subscription charge attaches to that charge, or waits for it.
  // A new row for it needs the owner to say so (Post as one-time instead).
  const m = result.subMatch
  if (attachCharge) {
    if (m?.kind !== 'attach') throw new BudgetError('no_charge', m?.kind === 'hold' ? `${m.subscription.name} is awaiting approval. Hold this receipt until you approve it.` : 'This receipt does not match a subscription charge that counts.', 409)
    if (!m.expense) {                        // the charge is due but the daily run has not posted it yet
      await postDueCharges(db, { today })
      ctx = await checksContext(db, today)
      result = receiptChecks(d, { ...ctx, proposal: rec.proposal || {} })
    }
    if (!result.subMatch?.expense) throw new BudgetError('no_charge', `The ${m.subscription.name} charge on ${dateText(m.charge_date)} has not posted yet. Hold on to this receipt and attach it once it posts.`, 409)
    attachTo = result.subMatch.expense.id
  } else if (!attachTo && m && GUARDED.has(m.kind) && !asOneTime) {
    throw new BudgetError('matches_charge', `${result.checks.find(c => c.key === 'sub_match').text} Attach or hold it, or post it as one-time instead.`, 409)
  }
  const target = attachTo || null
  if (!target && result.blocked) throw new BudgetError('blocked', result.blockers.join(' '), 409)
  if (target && result.attachBlocked) throw new BudgetError('blocked', result.attachBlockers.join(' '), 409)

  const total = draftTotal(d)
  const filed = filedName({ date: d.date, vendor: d.vendor, order_number: d.order_number, total: target ? (rec.proposal?.total || total) : total, contentType: rec.content_type })
  const created = []
  let doc = null
  let attachedPrev = null
  try {
    // 1. The rows, or the row it attaches to.
    if (target) {
      const row = ctx.expenses.find(e => e.id === target)
      if (!row) throw new BudgetError('not_found', 'The row to attach to no longer exists.', 404)
      attachedPrev = row.receipt_file_id
    } else {
      for (const row of rowsFrom(d)) {
        const method = d.payment_method
        const exp = await createExpense(db, actor, {
          source: 'receipt', today,
          fields: {
            expense_date: d.date, item: row.item, category_id: catId.get(row.category) || null, description: row.description, vendor: d.vendor,
            order_number: d.order_number, payment_method: method, status: defaultStatus(method), quantity: row.quantity, amount: row.amount,
            ...(d.cohort_id ? { cohort_id: d.cohort_id } : {}),
          },
        })
        created.push(exp.id)
      }
    }
    // 2. File the original, privately. The bytes are already in the private bucket; the record is
    //    what makes them the expense's receipt. Nothing is blurred (Owner, 2026-09-27).
    ;[doc] = await r(db.from('record_documents').insert({
      subject_type: 'budget_receipt', budget_receipt_id: id, title: `Receipt: ${d.vendor || 'vendor'} ${usd(total)}`, file_name: filed,
      storage_path: rec.storage_path, content_type: rec.content_type, size_bytes: num(rec.size_bytes), source: 'budget_receipt', created_by: actor?.id || null,
    }).select(), 'file_failed', 'The receipt could not be filed.')
    // 3. The rows point at their receipt, and a meal keeps its documentation on the row.
    const ids = target ? [target] : created
    const meal = { business_purpose: d.business_purpose, attendees: d.attendees }
    for (const eid of ids) {
      await q(db.from('budget_expenses').update({ receipt_file_id: doc.id, ...(d.business_purpose || d.attendees.length ? meal : {}), updated_at: new Date().toISOString() }).eq('id', eid), 'save_failed', 'The receipt could not be attached.')
    }
    // 4. The owner's category corrections, for Keith next time (B5).
    const before = new Map((rec.draft?.lines || []).map(l => [l.id, l.category]))
    const fixes = d.lines.filter(l => l.set_by_owner && l.category && before.get(l.id) !== l.category)
      .map(l => ({ receipt_id: id, vendor: d.vendor, item: l.item, from_category: (rec.proposal?.lines || []).find(p => p.item === l.item)?.category || before.get(l.id) || null, to_category: l.category, created_by: actor?.id || null }))
    if (fixes.length) await db.from('budget_category_corrections').insert(fixes)
    // 5. The receipt, decided, with what Undo reverses.
    await r(db.from('budget_receipts').update({
      status: 'accepted', draft: d, decided_at: new Date().toISOString(), decided_by: actor?.id || null, expense_ids: ids, attached: !!target,
      ...(rec.status === 'held' ? { held_subscription_id: null, held_charge_date: null } : {}),   // columns exist only after the v2 update
      record_document_id: doc.id, filed_name: filed, undo: { kind: 'accept', created, attached: target, attached_prev: attachedPrev, doc: doc.id, from: rec.status, held: rec.status === 'held' ? { sub: rec.held_subscription_id, date: rec.held_charge_date } : null },
      updated_at: new Date().toISOString(),
    }).eq('id', id), 'save_failed', 'The receipt could not be marked accepted.')
    // The chain (B6.5): uploaded by and Keith's proposal are logged already; this is the owner's part.
    await logChanges(db, 'receipt', id, null, target ? 'attach' : 'accept', [{ new: {
      rows: ids, attached: !!target, filed_name: filed, total, payment: paymentLabel(d.payment_method) || 'Not recorded',
      ...(attachCharge ? { subscription_charge: { subscription: m.subscription.name, charge_date: m.charge_date } } : {}), ...(asOneTime && m ? { posted_despite_match: m.subscription.name } : {}),
      edits: editsOf(rec.draft, d), accepted_by: actorName(actor),
    } }], actor)
    // The Keith mark: any last change in the accepted draft is an edit, then the accept.
    await noteKeithEdits(db, id, rec.draft, d, actor)
    await keithOutcome(db, id, 'accept', actor)
    return { accepted: true, attached: !!target, expense_ids: ids, filed_name: filed, record_document_id: doc.id, checks: result.checks }
  } catch (e) {
    // Put back what was written, so a failure leaves the receipt waiting and the ledger unchanged.
    for (const eid of created) await db.from('budget_expenses').update({ deleted_at: new Date().toISOString() }).eq('id', eid)
    if (target && doc) await db.from('budget_expenses').update({ receipt_file_id: attachedPrev }).eq('id', target)
    if (doc) await db.from('record_documents').delete().eq('id', doc.id)
    throw e
  }
}

/** What the owner changed from Keith's draft, field by field, for the audit chain. */
function editsOf(before, after) {
  if (!before) return []
  const out = []
  for (const k of ['vendor', 'order_number', 'date', 'payment_method', 'cohort_id']) if (String(before[k] ?? '') !== String(after[k] ?? '')) out.push({ field: k, from: before[k] ?? null, to: after[k] ?? null })
  const was = new Map((before.lines || []).map(l => [l.id, l]))
  for (const l of after.lines) {
    const b = was.get(l.id)
    if (!b) { out.push({ field: 'line', added: l.item }); continue }
    for (const k of ['item', 'category', 'quantity', 'amount']) if (String(b[k] ?? '') !== String(l[k] ?? '')) out.push({ field: `line.${k}`, item: l.item, from: b[k] ?? null, to: l[k] ?? null })
  }
  for (const b of before.lines || []) if (!after.lines.some(l => l.id === b.id)) out.push({ field: 'line', removed: b.item })
  if (after.business_purpose) out.push({ field: 'business_purpose', set: true })
  if (after.attendees.length) out.push({ field: 'attendees', count: after.attendees.length })
  return out
}

// ── Snooze, reject, undo ────────────────────────────────────────────────────────

export async function snoozeReceipt(db, actor, { id, days = SNOOZE_DAYS, today = pacificToday() }) {
  const rec = await receiptOf(db, id)
  if (!['review', 'snoozed', 'failed', 'held'].includes(rec.status)) throw new BudgetError('invalid_state', 'This receipt is not waiting for review.', 409)
  const until = addDays(today, Math.max(1, Math.min(60, Number(days) || SNOOZE_DAYS)))
  await r(db.from('budget_receipts').update({ status: 'snoozed', snoozed_until: until, decided_at: new Date().toISOString(), undo: { kind: 'snooze', from: rec.status, until: rec.snoozed_until }, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be snoozed.')
  await logReceipt(db, id, 'snooze', { until }, actor)
  return { snoozed_until: until, message: `Snoozed until ${dateText(until)}.` }
}

export async function rejectReceipt(db, actor, { id }) {
  const rec = await receiptOf(db, id)
  if (!['review', 'snoozed', 'failed', 'held'].includes(rec.status)) throw new BudgetError('invalid_state', 'This receipt is not waiting for review.', 409)
  await r(db.from('budget_receipts').update({ status: 'rejected', ...(rec.status === 'held' ? { held_subscription_id: null, held_charge_date: null } : {}), decided_at: new Date().toISOString(), decided_by: actor?.id || null, undo: { kind: 'reject', from: rec.status }, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be rejected.')
  await logReceipt(db, id, 'reject', { file_name: rec.file_name }, actor)
  await keithOutcome(db, id, 'reject', actor)
  return { rejected: true }
}

// ── Held for a subscription (BUDGET-V2 item 1) ──────────────────────────────────

/** Hold one receipt until the subscription its charge belongs to is approved. */
export async function holdReceipt(db, actor, { id, draft = null, today = pacificToday(), ctx = null }) {
  const rec = await receiptOf(db, id)
  if (!['review', 'snoozed'].includes(rec.status)) throw new BudgetError('invalid_state', 'This receipt is not waiting for review.', 409)
  const names = (await categoriesOf(db)).filter(c => c.is_active).map(c => c.name)
  const d = cleanDraft(draft || rec.draft, names)
  const context = ctx || await checksContext(db, today)
  const m = receiptChecks(d, { ...context, proposal: rec.proposal || {} }).subMatch
  if (m?.kind !== 'hold') throw new BudgetError('no_hold', 'This receipt does not match a subscription awaiting approval.', 409)
  const { error } = await db.from('budget_receipts').update({
    status: 'held', draft: d, held_subscription_id: m.subscription.id, held_charge_date: m.charge_date,
    decided_at: new Date().toISOString(), undo: { kind: 'hold', from: rec.status }, updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) { if (notEnabled(error) || error.code === '23514') throw new BudgetError('not_enabled', PHASE1, 409); throw new BudgetError('save_failed', 'The receipt could not be held.', 500) }
  await logReceipt(db, id, 'hold', { subscription: m.subscription.name, charge_date: m.charge_date }, actor)
  return { held: true, subscription: m.subscription.name, charge_date: m.charge_date, message: `Held until ${m.subscription.name} is approved.` }
}

/** Take a receipt out of Held, back to To Review (to post it as one-time, or reject it). */
export async function unholdReceipt(db, actor, { id }) {
  const rec = await receiptOf(db, id)
  if (rec.status !== 'held') throw new BudgetError('invalid_state', 'This receipt is not held.', 409)
  await r(db.from('budget_receipts').update({ status: 'review', held_subscription_id: null, held_charge_date: null, decided_at: null, undo: null, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be moved.')
  await logReceipt(db, id, 'release', { back_to_review: 'by the owner' }, actor)
  return { released: true }
}

/** Hold every waiting receipt that matches a subscription awaiting approval ("Hold all 11"). */
export async function holdAll(db, actor, { today = pacificToday() } = {}) {
  const ctx = await checksContext(db, today)
  const rows = (await r(db.from('budget_receipts').select('*').in('status', ['review', 'snoozed']).order('created_at')))
  let held = 0
  for (const x of rows) {
    if (!x.draft) continue
    if (receiptChecks(x.draft, { ...ctx, proposal: x.proposal || {} }).subMatch?.kind !== 'hold') continue
    await holdReceipt(db, actor, { id: x.id, today, ctx })
    held++
  }
  return { held, message: held ? `${held} ${held === 1 ? 'receipt' : 'receipts'} held until their subscriptions are approved.` : 'No receipts to hold.' }
}

/**
 * The owner decided a subscription: its held receipts leave Held. Approved, each attaches to its
 * charge (the approval has just posted it); a charge the approval does not count (approved from a
 * later day), or one that cannot be attached, goes back to review with the reason in the log.
 * Declined, they all go back to review, where Post as one-time is still available.
 */
export async function releaseHeld(db, actor, { subscriptionId, today = pacificToday() }) {
  const { data, error } = await db.from('budget_receipts').select('*').eq('status', 'held').eq('held_subscription_id', subscriptionId)
  if (error) return { attached: 0, returned: 0 }       // before the v2 update nothing can be held
  let attached = 0, returned = 0
  for (const x of data || []) {
    try {
      await acceptReceipt(db, actor, { id: x.id, draft: x.draft, attachCharge: true, today })
      // What Undo would reverse is the release, and the receipt was never the owner's single decision.
      await r(db.from('budget_receipts').update({ undo: null }).eq('id', x.id))
      attached++
    } catch (e) {
      await r(db.from('budget_receipts').update({ status: 'review', held_subscription_id: null, held_charge_date: null, decided_at: null, undo: null, updated_at: new Date().toISOString() }).eq('id', x.id))
      await logReceipt(db, x.id, 'release', { back_to_review: e.message }, actor)
      returned++
    }
  }
  return { attached, returned }
}

// ── Remembered cards (BUDGET-V2 item 5) ─────────────────────────────────────────

/**
 * Remember a card's last four digits as a payment method, and set that method on every open receipt
 * paid with it. `remember: false` forgets the card; receipts already set keep their method.
 */
export async function rememberCard(db, actor, { last4, method, remember = true }) {
  const l4 = String(last4 || '').replace(/\D/g, '')
  if (!/^\d{4}$/.test(l4)) throw new BudgetError('invalid_last4', 'Only the last four digits of a card are remembered.')
  if (remember && !['p_card', 'personal_concur', 'po_invoice'].includes(method)) throw new BudgetError('invalid_method', 'Choose the payment method to remember.')
  const cur = await settingsOf(db)
  const cards = cur.rememberedCards.filter(c => c.last4 !== l4)
  if (remember) cards.push({ last4: l4, method })
  const { error } = await db.from('budget_settings').upsert({ program: PROGRAM, pcard_last4: cur.pcardLast4 || null, remembered_cards: cards, updated_by: actor?.id || null, updated_at: new Date().toISOString() }, { onConflict: 'program' })
  if (error) { if (notEnabled(error)) throw new BudgetError('not_enabled', PHASE1, 409); throw new BudgetError('save_failed', 'The card could not be remembered.', 500) }
  await logChanges(db, 'settings', randomUUID(), null, 'update', [{ field: 'remembered_card', new: remember ? { last4: l4, method } : { last4: l4, forgotten: true } }], actor)
  let applied = 0
  if (remember) {
    const open = await r(db.from('budget_receipts').select('id, draft, proposal').in('status', OPEN))
    for (const x of open) {
      if (x.proposal?.card_last4 !== l4 || !x.draft || x.draft.payment_method === method) continue
      await r(db.from('budget_receipts').update({ draft: { ...x.draft, payment_method: method }, updated_at: new Date().toISOString() }).eq('id', x.id), 'save_failed', 'A receipt could not be updated.')
      applied++
    }
  }
  return { remembered_cards: cards, applied, message: remember ? `Card ending ${l4} remembered as ${paymentLabel(method)}.${applied ? ` ${applied} other ${applied === 1 ? 'receipt' : 'receipts'} updated.` : ''}` : `Card ending ${l4} forgotten.` }
}

/** Undo the last decision on a receipt, within the window, on the server (B6). */
export async function undoReceipt(db, actor, { id }) {
  const rec = await receiptOf(db, id)
  const u = rec.undo
  if (!u || !rec.decided_at || Date.now() - Date.parse(rec.decided_at) > UNDO_WINDOW_MS) throw new BudgetError('undo_expired', 'This can no longer be undone here. Change the rows in the Sheet instead.', 409)
  const back = u.from === 'snoozed' || u.from === 'failed' ? u.from : 'review'
  // A receipt taken out of Held goes back to Held, still waiting for its plan.
  const heldBack = u.held?.sub ? { status: 'held', held_subscription_id: u.held.sub, held_charge_date: u.held.date } : null
  if (u.kind === 'hold') {
    await r(db.from('budget_receipts').update({ status: back, held_subscription_id: null, held_charge_date: null, decided_at: null, decided_by: null, undo: null, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be restored.')
    await logReceipt(db, id, 'undo', { undid: 'hold' }, actor)
    return { undone: 'hold' }
  }
  if (u.kind === 'accept') {
    for (const eid of u.created || []) await q(db.from('budget_expenses').update({ deleted_at: new Date().toISOString() }).eq('id', eid), 'save_failed', 'The rows could not be removed.')
    if (u.attached) await q(db.from('budget_expenses').update({ receipt_file_id: u.attached_prev || null }).eq('id', u.attached), 'save_failed', 'The row could not be restored.')
    if (u.doc) await r(db.from('record_documents').delete().eq('id', u.doc), 'save_failed', 'The filed copy could not be removed.')
    await r(db.from('budget_receipts').update({ status: back, ...(heldBack || {}), decided_at: null, decided_by: null, expense_ids: [], attached: false, record_document_id: null, filed_name: null, undo: null, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be restored.')
  } else {
    await r(db.from('budget_receipts').update({ status: back, ...(heldBack || {}), snoozed_until: u.until || null, decided_at: null, decided_by: null, undo: null, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be restored.')
  }
  await logReceipt(db, id, 'undo', { undid: u.kind }, actor)
  if (u.kind === 'accept' || u.kind === 'reject') await keithOutcome(db, id, 'undo', actor)
  return { undone: u.kind }
}

// ── The original ────────────────────────────────────────────────────────────────

/** A short-lived link to the uploaded file itself (View original). */
export async function fileUrl(db, { id, download = false }) {
  const rec = await receiptOf(db, id)
  const { data, error } = await storage(db).createSignedUrl(rec.storage_path, 120, download ? { download: rec.filed_name || rec.file_name } : undefined)
  if (error || !data?.signedUrl) throw new BudgetError('file_missing', 'The original could not be opened.', 502)
  return { url: data.signedUrl, content_type: rec.content_type, file_name: rec.filed_name || rec.file_name }
}

/** The original filed on an expense row (from the Sheet's Receipt column). */
export async function expenseReceiptUrl(db, { expenseId }) {
  if (!UUID.test(String(expenseId || ''))) throw new BudgetError('not_found', 'That expense no longer exists.', 404)
  const e = (await q(db.from('budget_expenses').select('receipt_file_id').eq('id', expenseId).limit(1)))[0]
  if (!e?.receipt_file_id) throw new BudgetError('not_found', 'No receipt is filed on this row.', 404)
  const doc = (await r(db.from('record_documents').select('storage_path, file_name, content_type, subject_type').eq('id', e.receipt_file_id).limit(1)))[0]
  if (!doc || doc.subject_type !== 'budget_receipt') throw new BudgetError('not_found', 'No receipt is filed on this row.', 404)
  const { data, error } = await storage(db).createSignedUrl(doc.storage_path, 120)
  if (error || !data?.signedUrl) throw new BudgetError('file_missing', 'The receipt could not be opened.', 502)
  return { url: data.signedUrl, content_type: doc.content_type, file_name: doc.file_name }
}

// ── Rules and settings (owner-editable) ─────────────────────────────────────────

const RULE_EDITABLE = ['enabled', 'tone', 'applies_to', 'message', 'label', 'params']
export async function saveRule(db, actor, { key, patch = {} }) {
  const cur = (await r(db.from('budget_policy_rules').select('*').eq('key', String(key || '')).limit(1)))[0]
  if (!cur) throw new BudgetError('not_found', 'That rule no longer exists.', 404)
  const next = {}
  for (const [k, v] of Object.entries(patch || {})) {
    if (!RULE_EDITABLE.includes(k)) throw new BudgetError('invalid_field', `${k} cannot be changed.`)
    if (k === 'enabled') next.enabled = v === true
    else if (k === 'tone') { if (!['block', 'warn', 'info'].includes(v)) throw new BudgetError('invalid_rule', 'Choose Blocks Accept, Warning or Note.'); next.tone = v }
    else if (k === 'applies_to') { if (!['all', 'personal_concur'].includes(v)) throw new BudgetError('invalid_rule', 'Choose every payment method or Personal (Concur) only.'); next.applies_to = v }
    else if (k === 'message') { const t = String(v || '').trim(); if (!t || t.length > 400) throw new BudgetError('invalid_rule', 'The rule’s words must be 1 to 400 characters.'); next.message = t }
    else if (k === 'label') { const t = String(v || '').trim(); if (!t || t.length > 80) throw new BudgetError('invalid_rule', 'The rule’s name must be 1 to 80 characters.'); next.label = t }
    else if (k === 'params') {
      const p = { ...(cur.params || {}) }
      for (const [pk, pv] of Object.entries(v || {})) {
        if (!(pk in p)) continue                                  // only a threshold the rule already has
        if (Array.isArray(p[pk])) continue                        // category lists are not edited here
        const n = Number(pv); if (!Number.isFinite(n) || n < 0 || n > 100000) throw new BudgetError('invalid_rule', 'Enter a number.'); p[pk] = n
      }
      next.params = p
    }
  }
  await r(db.from('budget_policy_rules').update({ ...next, updated_by: actor?.id || null, updated_at: new Date().toISOString() }).eq('key', cur.key), 'save_failed', 'The rule could not be saved.')
  await logChanges(db, 'policy', randomUUID(), null, 'update', Object.keys(next).map(k => ({ field: `${cur.key}.${k}`, old: cur[k] ?? null, new: next[k] })), actor)
  return { rule: { ...cur, ...next } }
}

export async function saveSettings(db, actor, { pcard_last4 }) {
  const v = pcard_last4 == null || pcard_last4 === '' ? null : String(pcard_last4).replace(/\D/g, '')
  if (v !== null && !/^\d{4}$/.test(v)) throw new BudgetError('invalid_last4', 'Enter only the last four digits of the P-card.')
  await r(db.from('budget_settings').upsert({ program: PROGRAM, pcard_last4: v, updated_by: actor?.id || null, updated_at: new Date().toISOString() }, { onConflict: 'program' }), 'save_failed', 'The setting could not be saved.')
  await logChanges(db, 'settings', randomUUID(), null, 'update', [{ field: 'pcard_last4', new: v ? 'set' : 'cleared' }], actor)
  return { pcard_last4: v }
}
