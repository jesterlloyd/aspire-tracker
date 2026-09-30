// api/portal/academics-budget.js
//
// PROGRAM-BUDGET Phase A (BUDGET-A2, 2026-09-27): the Program Budget tab in the Nursing
// Education & Leadership portal. GET only, and read-only by construction: this file exposes no
// write path and never will.
//
// AUTHORIZATION. verifyPortalNursingAcademicCaller confirms a verified JWT, an active profile and
// an ACTIVE nursing_academic grant. On top of that, the grant must carry budget_access = 'view'
// (Owner decision, 2026-09-27: only granted leadership see the tab), re-read on every request.
// Owner and Admin previewing the portal get the same READER payload.
//
// OUTPUT. lib/server/budget/engine.js builds the reader payload without the owner-only fields
// (receipt files, renewals to decide, draft allocations), so nothing is filtered after the fact.
// Before the database update, budget_access does not exist and every grant is refused.

import { Buffer } from 'node:buffer'
import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'
import { getServiceDb } from '../lib/portalAuth.js'
import * as E from '../../lib/server/budget/engine.js'
import { withPlan } from '../../lib/server/budget/plan.js'

/** Does this grant carry the Program Budget tab? A missing column means not yet. */
export async function grantHasBudget(db, grantId) {
  const { data, error } = await db.from('user_role_grants').select('budget_access').eq('id', grantId).maybeSingle()
  if (error) { if (E.notEnabled(error)) return false; throw error }
  return data?.budget_access === 'view' || data?.budget_access === 'approve'
}

/** BUDGET-V2 Phase 3: the grant's level, 'none' | 'view' | 'approve'. Approve decides plans and amendments. */
export async function grantBudgetLevel(db, grantId) {
  const { data, error } = await db.from('user_role_grants').select('budget_access').eq('id', grantId).maybeSingle()
  if (error) return 'none'
  return ['view', 'approve'].includes(data?.budget_access) ? data.budget_access : 'none'
}

export function createAcademicsBudgetHandler({ verifyCaller = verifyPortalNursingAcademicCaller, makeDb = getServiceDb, hasBudget = grantHasBudget, budgetLevel = grantBudgetLevel, today } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }) }

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }

    if (!auth.staffPreview) {
      let ok
      try { ok = await hasBudget(db, auth.grant?.id) } catch { return res.status(500).json({ error: 'grant_lookup_failed' }) }
      if (!ok) return res.status(403).json({ error: 'budget_access_required' })
    }

    // The portal asks once whether to show the tab at all.
    if (req.query?.probe === '1') {
      try { return res.status(200).json(await E.status(db)) } catch { return res.status(500).json({ error: 'internal_error' }) }
    }

    const raw = req.query?.fiscal_year
    const fy = raw == null || raw === '' ? E.currentFiscalYear() : Number(raw)
    if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) return res.status(400).json({ error: 'invalid_fiscal_year' })
    const day = today ? { today: today() } : {}

    try {
      if (req.query?.export === '1') {
        const { bytes, fileName } = await E.exportYear(db, { fy, viewer: 'reader', ...day })
        return res.status(200).json({ fileName, xlsx: Buffer.from(bytes).toString('base64') })
      }
      // Staff previewing the portal read; only the grant itself may approve.
      let approver = false
      if (!auth.staffPreview) { try { approver = (await budgetLevel(db, auth.grant?.id)) === 'approve' } catch { approver = false } }
      return res.status(200).json({ ...(await withPlan(db, await E.loadYear(db, { fy, viewer: 'reader', ...day }), { viewer: 'reader', approver, ...day })), can_edit: false })
    } catch (err) {
      if (err instanceof E.BudgetError) return res.status(err.status).json({ error: err.code, message: err.message })
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createAcademicsBudgetHandler()
