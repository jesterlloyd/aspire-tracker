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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const READS = new Set(['status', 'load', 'export'])
const ACTION_SCHEMAS = Object.freeze({
  status: ['action'],
  load: ['action', 'fiscal_year'],
  export: ['action', 'fiscal_year'],
  start_year: ['action', 'fiscal_year', 'total', 'cost_center', 'plan'],
  set_total: ['action', 'fiscal_year', 'total'],
  set_note: ['action', 'fiscal_year', 'note'],
  mark_reconciled: ['action', 'fiscal_year'],
  expense_create: ['action', 'fields'],
  expense_update: ['action', 'id', 'patch'],
  expense_delete: ['action', 'ids'],
  sheet_cells: ['action', 'updates'],
  sheet_layout: ['action', 'layout'],
  allocations_save: ['action', 'fiscal_year', 'amounts', 'publish'],
  subscription_create: ['action', 'fields'],
  subscription_update: ['action', 'id', 'patch'],
  subscription_delete: ['action', 'id'],
  renewal_decide: ['action', 'id', 'decision'],
  post_charges: ['action'],
})

const invalid = (res, field, message) => res.status(400).json({ error: 'invalid_request', field, message })
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

export function createBudgetStaffHandler({ verifyCaller = verifyPortalCaller, makeDb = getServiceDb, today } = {}) {
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

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }
    const day = today ? { today: today() } : {}
    const actor = caller.profile

    try {
      switch (body.action) {
        case 'status': return res.status(200).json({ ...(await E.status(db)), can_edit: viewer === 'owner' })
        case 'load': return res.status(200).json({ ...(await E.loadYear(db, { fy: fy ?? E.currentFiscalYear(), viewer, ...day })), can_edit: viewer === 'owner' })
        case 'export': {
          const { bytes, fileName } = await E.exportYear(db, { fy: fy ?? E.currentFiscalYear(), viewer, ...day })
          return res.status(200).json({ fileName, xlsx: Buffer.from(bytes).toString('base64') })
        }
        case 'start_year': return res.status(200).json(await E.startYear(db, actor, { fy, total: body.total, cost_center: body.cost_center, plan: body.plan === 'even' ? 'even' : 'none', ...day }))
        case 'set_total': return res.status(200).json(await E.setTotal(db, actor, { fy, total: body.total, ...day }))
        case 'set_note': return res.status(200).json(await E.setNote(db, actor, { fy, note: body.note, ...day }))
        case 'mark_reconciled': return res.status(200).json(await E.markReconciled(db, actor, { fy, ...day }))
        case 'expense_create': return res.status(200).json({ expense: await E.createExpense(db, actor, { fields: obj(body.fields), ...day }) })
        case 'expense_update': return res.status(200).json({ expense: await E.updateExpense(db, actor, { id: body.id, patch: obj(body.patch), ...day }) })
        case 'expense_delete': return res.status(200).json(await E.deleteExpenses(db, actor, { ids: (Array.isArray(body.ids) ? body.ids : []).filter(x => UUID.test(String(x))).slice(0, 500), ...day }))
        case 'sheet_cells': return res.status(200).json(await E.saveSheetCells(db, { updates: (Array.isArray(body.updates) ? body.updates : []).filter(u => u && UUID.test(String(u.rowId)) && typeof u.key === 'string').slice(0, 2000) }))
        case 'sheet_layout': return res.status(200).json(await E.saveSheetLayout(db, actor, { layout: obj(body.layout) }))
        case 'allocations_save': return res.status(200).json(await E.saveAllocations(db, actor, { fy, amounts: obj(body.amounts), publish: body.publish === true, ...day }))
        case 'subscription_create': return res.status(200).json({ subscription: await E.createSubscription(db, actor, { fields: obj(body.fields), ...day }) })
        case 'subscription_update': return res.status(200).json({ subscription: await E.updateSubscription(db, actor, { id: body.id, patch: obj(body.patch), ...day }) })
        case 'subscription_delete': return res.status(200).json(await E.deleteSubscription(db, actor, { id: body.id }))
        case 'renewal_decide': return res.status(200).json(await E.decideRenewal(db, actor, { id: body.id, decision: body.decision, ...day }))
        case 'post_charges': return res.status(200).json(await E.postDueCharges(db, day))
        default: return invalid(res, 'action', 'Unknown action.')
      }
    } catch (err) {
      if (err instanceof E.BudgetError) return res.status(err.status).json({ error: err.code, message: err.message })
      console.error('[budget-staff] unhandled:', err?.message || err)
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createBudgetStaffHandler()
