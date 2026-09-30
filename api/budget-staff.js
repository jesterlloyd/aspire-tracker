// api/budget-staff.js
//
// PROGRAM-BUDGET Phase A (BUDGET-A2, 2026-09-27): Settings > Program Budget's one endpoint, in
// the house governance pattern (one POST, an { action, ...params } body, an action allow-list
// with exact key schemas). The rules are src/lib/budget/budgetModel.js and the reads and writes
// lib/server/budget/engine.js; this file decides who may do what.
//
// AUTHORIZATION. The caller is taken from the verified JWT, never the body.
//   - Every action needs an active staff profile (S-05, through verifyPortalCaller).
//   - Reads (status, load, export) need budget_view: the Owner, or an Admin, who gets the
//     READER payload (Owner decision, 2026-09-27: Admin sees what leadership sees).
//   - Every write needs budget_admin, whose allow-list is EMPTY: Owner-only by construction
//     (the is_owner capability, never a role string), enforced HERE, not in the UI.
//
// Budget data is real money, not a population: a demo session sees the same budget, and the
// roster behind cost per student counts real students only (the engine reads is_demo).

import { Buffer } from 'node:buffer'
import { verifyPortalCaller, getServiceDb } from './lib/portalAuth.js'
import { can } from '../lib/server/access.js'
import * as E from '../lib/server/budget/engine.js'
import * as R from '../lib/server/budget/receipts.js'
import * as P from '../lib/server/budget/plan.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const READS = new Set(['status', 'load', 'export', 'renewals'])
const ACTION_SCHEMAS = Object.freeze({
  status: ['action'],
  load: ['action', 'fiscal_year'],
  export: ['action', 'fiscal_year'],
  start_year: ['action', 'fiscal_year', 'total', 'cost_center', 'plan'],
  set_total: ['action', 'fiscal_year', 'total'],
  set_note: ['action', 'fiscal_year', 'note'],
  set_cost_center: ['action', 'fiscal_year', 'cost_center', 'apply_to_rows'],
  mark_reconciled: ['action', 'fiscal_year'],
  expense_create: ['action', 'fields'],
  expense_update: ['action', 'id', 'patch'],
  expense_delete: ['action', 'ids'],
  sheet_cells: ['action', 'updates', 'sheet'],
  sheet_layout: ['action', 'layout', 'sheet'],
  allocations_save: ['action', 'fiscal_year', 'amounts', 'publish'],
  subscription_create: ['action', 'fields'],
  subscription_update: ['action', 'id', 'patch'],
  subscription_delete: ['action', 'id'],
  renewal_decide: ['action', 'id', 'decision'],
  subscription_approve: ['action', 'id', 'decision', 'into_closed'],
  post_charges: ['action'],
  renewals: ['action'],
  // PROGRAM-BUDGET Phase B: receipts. None is in READS, so every one is Owner-only (budget_admin):
  // nobody but the Owner sees receipt files, the review queue or the rules (decision 5).
  receipts_status: ['action'],
  receipts_intake: ['action'],
  receipts_queue: ['action'],
  receipts_filed: ['action', 'fiscal_year'],
  receipt_upload: ['action', 'file_name', 'content_type', 'size'],
  receipt_discard: ['action', 'id'],
  receipt_read: ['action', 'id'],
  receipt_draft: ['action', 'id', 'draft'],
  receipt_accept: ['action', 'id', 'draft', 'attach_to', 'attach_charge', 'as_one_time', 'move_from'],
  receipt_amend: ['action', 'id', 'draft', 'reason'],
  // BUDGET-V2 Phase 1: hold for a subscription, remember a card, answer the overlap check.
  receipt_hold: ['action', 'id', 'draft'],
  receipts_hold_all: ['action'],
  receipt_unhold: ['action', 'id'],
  card_remember: ['action', 'last4', 'method', 'remember'],
  subscription_overlap: ['action', 'id', 'decision', 'end_on'],
  // BUDGET-V2 Phase 2: close the month (Owner only; not in READS).
  month_close: ['action', 'fiscal_year', 'month', 'note'],
  month_reopen: ['action', 'fiscal_year', 'month'],
  concur_mark_submitted: ['action', 'fiscal_year', 'month'],
  // BUDGET-V2 Phase 3: the plan (Owner only; Margo decides through /api/portal/academics-budget-review).
  plan_start: ['action', 'fiscal_year'],
  plan_save: ['action', 'id', 'note', 'items'],
  plan_submit: ['action', 'id'],
  plan_revise: ['action', 'id'],
  plan_pdf: ['action', 'id'],
  plan_move: ['action', 'fiscal_year', 'from', 'to', 'amount', 'reason', 'expense_id'],
  plan_amend: ['action', 'fiscal_year', 'category_id', 'amount', 'reason', 'expense_id'],
  plan_limits: ['action', 'pct', 'cap'],
  receipt_snooze: ['action', 'id', 'days'],
  receipt_reject: ['action', 'id'],
  receipt_undo: ['action', 'id'],
  receipt_file: ['action', 'id', 'download'],
  expense_receipt: ['action', 'expense_id'],
  policy_rule_save: ['action', 'key', 'patch'],
  budget_settings_save: ['action', 'pcard_last4'],
})

const invalid = (res, field, message) => res.status(400).json({ error: 'invalid_request', field, message })
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

// `complete` is Keith's model call for receipt_read; a test passes a stub, production the real one.
export function createBudgetStaffHandler({ verifyCaller = verifyPortalCaller, makeDb = getServiceDb, today, complete } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }) }

    const caller = await verifyCaller(req)
    if (!caller.authenticated) return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })

    const body = obj(req.body)
    const allowed = ACTION_SCHEMAS[body.action]
    if (!allowed) return invalid(res, 'action', 'Unknown action.')
    const extra = Object.keys(body).find(k => !allowed.includes(k))
    if (extra) return invalid(res, extra, 'Unexpected field. The acting user is taken from your session, never from the request.')

    const isRead = READS.has(body.action)
    if (!can(caller.profile, isRead ? 'budget_view' : 'budget_admin')) {
      return res.status(403).json({ error: 'forbidden', message: isRead ? 'You do not have access to the Program Budget.' : 'Only the Owner may change the Program Budget.' })
    }
    const viewer = can(caller.profile, 'budget_admin') ? 'owner' : 'reader'
    const fy = body.fiscal_year == null ? null : Number(body.fiscal_year)
    if ('fiscal_year' in body && !(Number.isInteger(fy) && fy >= 2020 && fy <= 2100)) return invalid(res, 'fiscal_year', 'Choose a fiscal year.')
    if ('id' in body && !UUID.test(String(body.id || ''))) return invalid(res, 'id', 'Missing id.')
    if ('month' in body && !/^\d{4}-\d{2}$/.test(String(body.month || ''))) return invalid(res, 'month', 'Choose a month.')
    if (['month_close', 'month_reopen', 'concur_mark_submitted'].includes(body.action) && fy == null) return invalid(res, 'fiscal_year', 'Choose a fiscal year.')

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }
    const day = today ? { today: today() } : {}
    const actor = caller.profile

    try {
      switch (body.action) {
        case 'status': return res.status(200).json({ ...(await E.status(db)), can_edit: viewer === 'owner' })
        case 'load': return res.status(200).json({ ...(await P.withPlan(db, await E.loadYear(db, { fy: fy ?? E.currentFiscalYear(), viewer, ...day }), { viewer, ...day })), can_edit: viewer === 'owner' })
        case 'export': {
          const { bytes, fileName } = await E.exportYear(db, { fy: fy ?? E.currentFiscalYear(), viewer, ...day })
          return res.status(200).json({ fileName, xlsx: Buffer.from(bytes).toString('base64') })
        }
        case 'start_year': return res.status(200).json(await E.startYear(db, actor, { fy, total: body.total, cost_center: body.cost_center, plan: body.plan === 'even' ? 'even' : 'none', ...day }))
        case 'set_total': return res.status(200).json(await E.setTotal(db, actor, { fy, total: body.total, ...day }))
        case 'set_cost_center': return res.status(200).json(await E.setCostCenter(db, actor, { fy: fy ?? E.currentFiscalYear(), cost_center: body.cost_center, applyToRows: body.apply_to_rows !== false, ...day }))
        case 'set_note': return res.status(200).json(await E.setNote(db, actor, { fy, note: body.note, ...day }))
        case 'mark_reconciled': return res.status(200).json(await E.markReconciled(db, actor, { fy, ...day }))
        case 'expense_create': return res.status(200).json({ expense: await E.createExpense(db, actor, { fields: obj(body.fields), ...day }) })
        case 'expense_update': return res.status(200).json({ expense: await E.updateExpense(db, actor, { id: body.id, patch: obj(body.patch), ...day }) })
        case 'expense_delete': return res.status(200).json(await E.deleteExpenses(db, actor, { ids: (Array.isArray(body.ids) ? body.ids : []).filter(x => UUID.test(String(x))).slice(0, 500), ...day }))
        case 'sheet_cells': return res.status(200).json(await E.saveSheetCells(db, { updates: (Array.isArray(body.updates) ? body.updates : []).filter(u => u && UUID.test(String(u.rowId)) && typeof u.key === 'string').slice(0, 2000), sheet: body.sheet === 'subscriptions' ? 'subscriptions' : 'expenses' }))
        case 'sheet_layout': return res.status(200).json(await E.saveSheetLayout(db, actor, { layout: obj(body.layout), sheet: body.sheet === 'subscriptions' ? 'subscriptions' : 'expenses' }))
        case 'allocations_save': return res.status(200).json(await E.saveAllocations(db, actor, { fy, amounts: obj(body.amounts), publish: body.publish === true, ...day }))
        case 'subscription_create': return res.status(200).json({ subscription: await E.createSubscription(db, actor, { fields: obj(body.fields), ...day }) })
        case 'subscription_update': return res.status(200).json({ subscription: await E.updateSubscription(db, actor, { id: body.id, patch: obj(body.patch), ...day }) })
        case 'subscription_delete': return res.status(200).json(await E.deleteSubscription(db, actor, { id: body.id }))
        case 'subscription_approve': {
          // BUDGET-V2 item 1: the plan's held receipts attach to their charges (or go back to review).
          const out = await E.decideProposal(db, actor, { id: body.id, decision: body.decision, intoClosed: body.into_closed === true, ...day })
          const rel = await R.releaseHeld(db, actor, { subscriptionId: body.id, ...day })
          const extra = [rel.attached ? `${rel.attached} held ${rel.attached === 1 ? 'receipt' : 'receipts'} attached to ${rel.attached === 1 ? 'its charge' : 'their charges'}.` : '', rel.returned ? `${rel.returned} held ${rel.returned === 1 ? 'receipt is' : 'receipts are'} back in To Review.` : ''].filter(Boolean).join(' ')
          return res.status(200).json({ ...out, released: rel, message: [out.message, extra].filter(Boolean).join(' ') })
        }
        case 'renewal_decide': return res.status(200).json(await E.decideRenewal(db, actor, { id: body.id, decision: body.decision, ...day }))
        // AC-RENEW-1: the renewals are the Owner's to decide, so anyone else is given none (not refused:
        // the Action Center asks for every source it may show and an Admin simply has nothing here).
        case 'renewals': return res.status(200).json({ renewals: viewer === 'owner' ? await E.listRenewals(db, day) : [] })
        case 'post_charges': return res.status(200).json(await E.postDueCharges(db, day))
        case 'receipts_status': return res.status(200).json(await R.receiptsStatus(db))
        case 'receipts_intake': return res.status(200).json(await R.intake(db, day))
        case 'receipts_filed': return res.status(200).json({ receipts: await R.filedReceipts(db, { fy: fy ?? E.currentFiscalYear(), ...day }) })
        case 'receipts_queue': return res.status(200).json({ receipts: await R.reviewQueue(db, day), concur: await E.concurQueue(db, day), missing: await E.missingReceiptQueue(db), close: await E.closeQueue(db, day) })
        case 'month_close': return res.status(200).json(await E.closeMonth(db, actor, { fy, month: body.month, note: typeof body.note === 'string' ? body.note : '', ...day }))
        case 'month_reopen': return res.status(200).json(await E.reopenMonth(db, actor, { fy, month: body.month, ...day }))
        case 'concur_mark_submitted': return res.status(200).json(await E.markConcurSubmitted(db, actor, { fy, month: body.month, ...day }))
        case 'receipt_upload': return res.status(200).json(await R.startUpload(db, actor, { fileName: body.file_name, contentType: body.content_type, size: body.size }))
        case 'receipt_discard': return res.status(200).json(await R.discardUpload(db, actor, { id: body.id }))
        case 'receipt_read': return res.status(200).json(await R.readReceipt(db, actor, { id: body.id, ...(complete ? { complete } : {}), ...day }))
        case 'receipt_draft': return res.status(200).json(await R.saveDraft(db, actor, { id: body.id, draft: obj(body.draft) }))
        case 'receipt_accept': {
          if (body.attach_to != null && !UUID.test(String(body.attach_to))) return invalid(res, 'attach_to', 'Choose the row to attach to.')
          return res.status(200).json(await R.acceptReceipt(db, actor, { id: body.id, draft: obj(body.draft), attachTo: body.attach_to || null, attachCharge: body.attach_charge === true, asOneTime: body.as_one_time === true, move: typeof body.move_from === 'string' && body.move_from ? { from: body.move_from } : null, ...day }))
        }
        case 'receipt_amend': return res.status(200).json(await R.holdForAmendment(db, actor, { id: body.id, draft: body.draft ? obj(body.draft) : null, reason: typeof body.reason === 'string' ? body.reason : '', ...day }))
        case 'plan_start': {
          if (fy == null) return invalid(res, 'fiscal_year', 'Choose a fiscal year.')
          return res.status(200).json(await P.startProposal(db, actor, { fy, ...day }))
        }
        case 'plan_save': return res.status(200).json(await P.savePlanDraft(db, actor, { planId: body.id, note: typeof body.note === 'string' ? body.note : null, items: Array.isArray(body.items) ? body.items : null }))
        case 'plan_submit': return res.status(200).json(await P.submitPlan(db, actor, { planId: body.id }))
        case 'plan_revise': return res.status(200).json(await P.revisePlan(db, actor, { planId: body.id }))
        case 'plan_pdf': { const out = await P.planPdf(db, { planId: body.id }); return res.status(200).json({ fileName: out.fileName, pdf: Buffer.from(out.bytes).toString('base64') }) }
        case 'plan_move': {
          if (fy == null || !UUID.test(String(body.from || '')) || !UUID.test(String(body.to || ''))) return invalid(res, 'from', 'Choose the two categories.')
          return res.status(200).json(await P.movePlan(db, actor, { fy, from: body.from, to: body.to, amount: Number(body.amount), reason: typeof body.reason === 'string' ? body.reason : '', expenseId: UUID.test(String(body.expense_id || '')) ? body.expense_id : null }))
        }
        case 'plan_amend': {
          if (fy == null || !UUID.test(String(body.category_id || ''))) return invalid(res, 'category_id', 'Choose the category.')
          return res.status(200).json(await P.requestAmendment(db, actor, { fy, category_id: body.category_id, amount: Number(body.amount), reason: typeof body.reason === 'string' ? body.reason : '', expenseId: UUID.test(String(body.expense_id || '')) ? body.expense_id : null }))
        }
        case 'plan_limits': return res.status(200).json(await P.saveLimits(db, actor, { pct: body.pct, cap: body.cap }))
        case 'receipt_hold': return res.status(200).json(await R.holdReceipt(db, actor, { id: body.id, draft: body.draft ? obj(body.draft) : null, ...day }))
        case 'receipt_unhold': return res.status(200).json(await R.unholdReceipt(db, actor, { id: body.id }))
        case 'receipts_hold_all': return res.status(200).json(await R.holdAll(db, actor, day))
        case 'card_remember': return res.status(200).json(await R.rememberCard(db, actor, { last4: body.last4, method: body.method, remember: body.remember !== false }))
        case 'subscription_overlap': return res.status(200).json(await E.decideOverlap(db, actor, { id: body.id, decision: body.decision, end_on: body.end_on || null, ...day }))
        case 'receipt_snooze': return res.status(200).json(await R.snoozeReceipt(db, actor, { id: body.id, days: body.days, ...day }))
        case 'receipt_reject': return res.status(200).json(await R.rejectReceipt(db, actor, { id: body.id }))
        case 'receipt_undo': return res.status(200).json(await R.undoReceipt(db, actor, { id: body.id }))
        case 'receipt_file': return res.status(200).json(await R.fileUrl(db, { id: body.id, download: body.download === true }))
        case 'expense_receipt': return res.status(200).json(await R.expenseReceiptUrl(db, { expenseId: body.expense_id }))
        case 'policy_rule_save': return res.status(200).json(await R.saveRule(db, actor, { key: body.key, patch: obj(body.patch) }))
        case 'budget_settings_save': return res.status(200).json(await R.saveSettings(db, actor, { pcard_last4: body.pcard_last4 }))
        default: return invalid(res, 'action', 'Unknown action.')
      }
    } catch (err) {
      if (err instanceof E.BudgetError) return res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) })
      console.error('[budget-staff] unhandled:', err?.message || err)
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createBudgetStaffHandler()
