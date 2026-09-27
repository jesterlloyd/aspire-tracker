// lib/server/budget/receipts.js
//
// PROGRAM-BUDGET Phase B (BUDGET-B2, 2026-09-27): receipt intake, the server side. Owner only;
// /api/budget-staff calls these after checking the caller holds budget_admin.
//
//   startUpload     a receipt row and a signed upload URL into the private 'record-documents'
//                   bucket (budget/receipts/<id>/...). The browser uploads straight to storage, so a
//                   10 MB PDF never passes through a function body.
//   readReceipt     Keith reads it: the governed 'read-receipt' skill, one tool-free completion
//                   with the file as an image or document block, metered in Usage & Cost (B2).
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
import { BudgetError, notEnabled, createExpense, internals as I } from './engine.js'
import {
  PROGRAM, fyShort, yearState, defaultStatus, counts, usd, dateText, pacificToday, paymentLabel,
} from '../../../src/lib/budget/budgetModel.js'
import { addDays } from '../../../src/lib/rotationCalendarDates.js'
import { parseReading, draftFrom, rowsFrom, filedName, cleanAttendees, draftTotal, ReadingError, RECEIPT_TYPES, RECEIPT_MAX_BYTES, LINE_FLAGS, CONFIDENCE } from '../../../src/lib/budget/receiptModel.js'
import { receiptChecks } from '../../../src/lib/budget/receiptChecks.js'
import { resolveRoute } from '../keith/modelRouting.js'
import { completeWithoutTools } from '../keith/anthropicClient.js'
import { recordKeithUsage, recordSkillInvocation, OUTCOMES } from '../keith/usageLog.js'
import { authorizeSkillForCaller } from '../keith/skillAuthorization.js'
import { parseEml } from './eml.js'

export const RECEIPT_BUCKET = 'record-documents'
export const READ_SKILL = 'read-receipt'
export const UNDO_WINDOW_MS = 10 * 60 * 1000
export const SNOOZE_DAYS = 7
const IMAGE_LIMIT = 5 * 1024 * 1024            // the model's own limit for one image
const CORRECTION_EXAMPLES = 20
const WAITING = ['uploading', 'reading', 'review', 'failed']
const NOT_ENABLED = 'Receipts are not enabled yet. Their database update (20261013000000_budget_receipts.sql) has not been applied.'

const { q, num, expIn, logChanges, categoriesOf, allocationsOf } = I
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
  const { data, error } = await db.from('budget_category_corrections').select('vendor, item, from_category, to_category').order('created_at', { ascending: false }).limit(CORRECTION_EXAMPLES)
  return error ? [] : data || []
}

async function pcardOf(db) {
  const { data, error } = await db.from('budget_settings').select('pcard_last4').eq('program', PROGRAM).limit(1)
  return error ? '' : data?.[0]?.pcard_last4 || ''
}

/**
 * Keith reads one receipt. `complete` is the model call (a test passes a stub). The receipt ends
 * in 'review' with a proposal and a draft, or in 'failed' with the reason in words.
 */
export async function readReceipt(db, actor, { id, complete = completeWithoutTools, today = pacificToday() }) {
  const rec = await receiptOf(db, id)
  if (!['uploading', 'failed', 'review', 'reading'].includes(rec.status)) throw new BudgetError('invalid_state', 'This receipt has already been decided.', 409)
  const skill = (await r(db.from('keith_skills').select('id, slug, version, status, enabled, allowed_roles, model_route, instruction_body').eq('slug', READ_SKILL).limit(1)))[0]
  const caller = { profileId: actor?.id, role: actor?.role, isOwner: actor?.is_owner === true }
  if (!skill || !authorizeSkillForCaller(skill, caller).ok) {
    throw new BudgetError('keith_off', 'Keith’s Read Receipt skill is off. Turn it on in Settings > Keith > Skills, then read this receipt again.', 409)
  }
  await r(db.from('budget_receipts').update({ status: 'reading', read_error: null, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be updated.')

  const started = Date.now()
  const requestId = randomUUID()
  const route = resolveRoute(skill.model_route)
  const fail = async (message, outcome = OUTCOMES.ERROR, usage = {}, model = route.model) => {
    await db.from('budget_receipts').update({ status: 'failed', read_error: message, updated_at: new Date().toISOString() }).eq('id', id)
    await recordKeithUsage(db, { requestId, profileId: actor?.id, role: 'owner', intent: 'receipt_reading', skillId: skill.id, skillVersion: skill.version, model, modelRoute: route.route, rounds: 1, inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0, durationMs: Date.now() - started, outcome })
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
  const intro = [
    `CATEGORIES (use exactly one of these for each line): ${categories.join('; ')}.`,
    examples.length ? `THE OWNER'S PAST CORRECTIONS (use them for items like these):\n${examples.map(x => `- "${x.item}"${x.vendor ? ` from ${x.vendor}` : ''}: ${x.to_category}${x.from_category ? ` (not ${x.from_category})` : ''}`).join('\n')}` : '',
    `Today is ${today}. Read the receipt below and return the JSON object.`,
  ].filter(Boolean).join('\n\n')

  const out = await complete({ route: { ...route, maxTokens: Math.max(route.maxTokens, 3000), temperature: 0 }, system: skill.instruction_body, messages: [{ role: 'user', content: [{ type: 'text', text: intro }, ...content] }], timeoutMs: 50000 })
  if (!out?.ok) {
    const why = out?.reason === 'timeout' ? 'Keith took too long to read this receipt. Read it again.'
      : out?.reason === 'missing_api_key' ? 'Keith is not set up on this server (no API key).'
        : 'Keith could not read this receipt just now. Read it again in a moment.'
    return fail(why, out?.reason === 'upstream_rate_limited' ? OUTCOMES.RATE_LIMITED : OUTCOMES.ERROR)
  }
  let proposal
  try { proposal = parseReading(out.text, categories) } catch (e) {
    if (e instanceof ReadingError) return fail(`${e.message} Check that the file is a receipt, then read it again.`, OUTCOMES.ERROR, out.usage, out.model)
    throw e
  }
  const draft = draftFrom(proposal, { pcardLast4: await pcardOf(db) })
  const [saved] = await r(db.from('budget_receipts').update({
    status: 'review', proposal, draft, sha256, read_model: out.model, read_at: new Date().toISOString(), read_error: null, updated_at: new Date().toISOString(),
  }).eq('id', id).select(), 'save_failed', 'Keith’s reading could not be saved.')

  const usage = { requestId, profileId: actor?.id, role: 'owner', model: out.model, inputTokens: out.usage?.inputTokens || 0, outputTokens: out.usage?.outputTokens || 0, durationMs: Date.now() - started }
  await recordKeithUsage(db, { ...usage, intent: 'receipt_reading', skillId: skill.id, skillVersion: skill.version, modelRoute: route.route, rounds: 1, outcome: OUTCOMES.COMPLETED })
  // Metadata only: which file, its type and size. Never what the receipt says.
  await recordSkillInvocation(db, { ...usage, skillId: skill.id, skillSlug: skill.slug, skillVersion: skill.version, invocationMode: 'picker', dataSources: { receipt: { id, content_type: rec.content_type, bytes: bytes.length } }, outcome: OUTCOMES.COMPLETED })
  await logReceipt(db, id, 'read', { vendor: proposal.vendor, total: proposal.total, lines: proposal.lines.length, model: out.model }, actor)
  return { receipt: slipView({ ...saved, snoozed_until: ymd(saved.snoozed_until) }) }
}

// ── What the tab shows ──────────────────────────────────────────────────────────

function slipView(rec) {
  return {
    id: rec.id, status: rec.status, file_name: rec.file_name, content_type: rec.content_type, size_bytes: num(rec.size_bytes),
    proposal: rec.proposal || null, draft: rec.draft || null, read_error: rec.read_error || null, read_model: rec.read_model || null,
    read_at: rec.read_at || null, snoozed_until: rec.snoozed_until || null, decided_at: rec.decided_at || null, filed_name: rec.filed_name || null,
    record_document_id: rec.record_document_id || null, expense_ids: rec.expense_ids || [], attached: rec.attached === true,
    sha256: rec.sha256 || null, created_at: rec.created_at, canUndo: !!rec.undo && !!rec.decided_at && Date.now() - Date.parse(rec.decided_at) < UNDO_WINDOW_MS,
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
      row_label: `${fyShort(b.fiscal_year)} row ${i + 1}`,
    }))
    const spent = {}
    for (const e of rows.filter(counts)) { const n = catName.get(e.category_id) || 'Uncategorized'; spent[n] = Math.round(((spent[n] || 0) + e.amount) * 100) / 100 }
    const alloc = await allocationsOf(db, b.id)
    const plan = {}
    for (const a of alloc) if (a.amount) plan[catName.get(a.category_id)] = a.amount
    years.set(b.fiscal_year, { state: yearState(b, b.fiscal_year, today), total: num(b.total), spent, plan: Object.keys(plan).length ? plan : null })
  }
  const { data: rules } = await db.from('budget_policy_rules').select('*').order('sort_order')
  return { expenses, years, rules: rules || [], pcardLast4: await pcardOf(db), today, categories: categories.filter(c => c.is_active).map(c => ({ id: c.id, name: c.name })) }
}

/** The Receipts tab: waiting slips (oldest first), snoozed ones, the last decided, and the check context. */
export async function intake(db, { today = pacificToday() } = {}) {
  const rows = (await r(db.from('budget_receipts').select('*').order('created_at'))).map(x => ({ ...x, snoozed_until: ymd(x.snoozed_until) }))
  const due = (x) => x.status === 'snoozed' && x.snoozed_until && x.snoozed_until <= today
  const ctx = await checksContext(db, today)
  const acceptedBySha = new Map(rows.filter(x => x.status === 'accepted' && x.sha256).map(x => [x.sha256, x]))
  const view = (x) => {
    const v = slipView(x)
    const dupFile = x.sha256 ? acceptedBySha.get(x.sha256) : null
    return { ...v, duplicateFile: dupFile && dupFile.id !== x.id ? { id: dupFile.id, decided_at: dupFile.decided_at } : null }
  }
  return {
    waiting: rows.filter(x => WAITING.includes(x.status) || due(x)).map(view),
    snoozed: rows.filter(x => x.status === 'snoozed' && !due(x)).map(view),
    recent: rows.filter(x => ['accepted', 'rejected'].includes(x.status)).sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at))).slice(0, 12).map(view),
    filedCount: rows.filter(x => x.status === 'accepted').length,
    context: { ...ctx, years: Object.fromEntries(ctx.years) },
  }
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
  return { draft: clean }
}

// ── Accept and file (B6) ────────────────────────────────────────────────────────

/**
 * Accept a slip. With `attachTo` (the duplicate's row, or any row the owner names) the receipt is
 * filed on that row and nothing new is posted. Returns the rows written and the filed name.
 */
export async function acceptReceipt(db, actor, { id, draft, attachTo = null, today = pacificToday() }) {
  const rec = await receiptOf(db, id)
  if (rec.status !== 'review' && rec.status !== 'snoozed') throw new BudgetError('invalid_state', 'This receipt is not waiting for review.', 409)
  const categories = (await categoriesOf(db)).filter(c => c.is_active)
  const catId = new Map(categories.map(c => [c.name, c.id]))
  const d = cleanDraft(draft || rec.draft, categories.map(c => c.name))
  const ctx = await checksContext(db, today)
  const result = receiptChecks(d, { ...ctx, proposal: rec.proposal || {} })
  const target = attachTo || null
  if (!target && result.blocked) throw new BudgetError('blocked', result.blockers.join(' '), 409)
  if (target && !d.date) throw new BudgetError('blocked', 'Enter the receipt’s date.', 409)

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
      record_document_id: doc.id, filed_name: filed, undo: { kind: 'accept', created, attached: target, attached_prev: attachedPrev, doc: doc.id, from: rec.status },
      updated_at: new Date().toISOString(),
    }).eq('id', id), 'save_failed', 'The receipt could not be marked accepted.')
    // The chain (B6.5): uploaded by and Keith's proposal are logged already; this is the owner's part.
    await logChanges(db, 'receipt', id, null, target ? 'attach' : 'accept', [{ new: {
      rows: ids, attached: !!target, filed_name: filed, total, payment: paymentLabel(d.payment_method) || 'Not recorded',
      edits: editsOf(rec.draft, d), accepted_by: actorName(actor),
    } }], actor)
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
  if (!['review', 'snoozed', 'failed'].includes(rec.status)) throw new BudgetError('invalid_state', 'This receipt is not waiting for review.', 409)
  const until = addDays(today, Math.max(1, Math.min(60, Number(days) || SNOOZE_DAYS)))
  await r(db.from('budget_receipts').update({ status: 'snoozed', snoozed_until: until, decided_at: new Date().toISOString(), undo: { kind: 'snooze', from: rec.status, until: rec.snoozed_until }, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be snoozed.')
  await logReceipt(db, id, 'snooze', { until }, actor)
  return { snoozed_until: until, message: `Snoozed until ${dateText(until)}.` }
}

export async function rejectReceipt(db, actor, { id }) {
  const rec = await receiptOf(db, id)
  if (!['review', 'snoozed', 'failed'].includes(rec.status)) throw new BudgetError('invalid_state', 'This receipt is not waiting for review.', 409)
  await r(db.from('budget_receipts').update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: actor?.id || null, undo: { kind: 'reject', from: rec.status }, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be rejected.')
  await logReceipt(db, id, 'reject', { file_name: rec.file_name }, actor)
  return { rejected: true }
}

/** Undo the last decision on a receipt, within the window, on the server (B6). */
export async function undoReceipt(db, actor, { id }) {
  const rec = await receiptOf(db, id)
  const u = rec.undo
  if (!u || !rec.decided_at || Date.now() - Date.parse(rec.decided_at) > UNDO_WINDOW_MS) throw new BudgetError('undo_expired', 'This can no longer be undone here. Change the rows in the Sheet instead.', 409)
  const back = u.from === 'snoozed' || u.from === 'failed' ? u.from : 'review'
  if (u.kind === 'accept') {
    for (const eid of u.created || []) await q(db.from('budget_expenses').update({ deleted_at: new Date().toISOString() }).eq('id', eid), 'save_failed', 'The rows could not be removed.')
    if (u.attached) await q(db.from('budget_expenses').update({ receipt_file_id: u.attached_prev || null }).eq('id', u.attached), 'save_failed', 'The row could not be restored.')
    if (u.doc) await r(db.from('record_documents').delete().eq('id', u.doc), 'save_failed', 'The filed copy could not be removed.')
    await r(db.from('budget_receipts').update({ status: back, decided_at: null, decided_by: null, expense_ids: [], attached: false, record_document_id: null, filed_name: null, undo: null, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be restored.')
  } else {
    await r(db.from('budget_receipts').update({ status: back, snoozed_until: u.until || null, decided_at: null, decided_by: null, undo: null, updated_at: new Date().toISOString() }).eq('id', id), 'save_failed', 'The receipt could not be restored.')
  }
  await logReceipt(db, id, 'undo', { undid: u.kind }, actor)
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
