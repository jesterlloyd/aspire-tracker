// api/portal/academics-budget-review.js
//
// BUDGET-V2 Phase 3 (2026-09-29): Margo's review, in the Nursing Education & Leadership portal. The
// Program Budget tab's reads stay in academics-budget.js, which has no write path; this is the one
// write path leadership has, and it is narrow on purpose:
//
//   plan_decide       approve a submitted plan (her approved total per category), or send it back
//   amendment_decide  approve or decline the owner's request to raise a category
//   proposal_request  ask the owner for next year's proposal
//   plan_pdf          the request as a PDF for Finance (any budget grant; never a draft)
//
// AUTHORIZATION. A verified nursing_academic grant, re-read on every request. Every decision needs
// budget_access = 'approve' (Owner decision, 2026-09-29: a new level, granted in Accounts & Access);
// the PDF needs 'view' or 'approve'. Owner and Admin previewing the portal are refused every write:
// the owner never approves their own plan.

import { Buffer } from 'node:buffer'
import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'
import { getServiceDb } from '../lib/portalAuth.js'
import * as E from '../../lib/server/budget/engine.js'
import * as P from '../../lib/server/budget/plan.js'
import * as R from '../../lib/server/budget/receipts.js'
import { grantBudgetLevel } from './academics-budget.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = Object.freeze({
  plan_decide: ['action', 'plan_id', 'decision', 'approved', 'comment'],
  amendment_decide: ['action', 'id', 'decision', 'comment'],
  proposal_request: ['action'],
  plan_pdf: ['action', 'plan_id'],
})
const invalid = (res, field, message) => res.status(400).json({ error: 'invalid_request', field, message })

export function createAcademicsBudgetReviewHandler({ verifyCaller = verifyPortalNursingAcademicCaller, makeDb = getServiceDb, budgetLevel = grantBudgetLevel, today } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }) }

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
    if (auth.staffPreview) return res.status(403).json({ error: 'forbidden', message: 'Previewing the portal is read-only. Decisions belong to the leadership grant.' })

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const allowed = ACTIONS[body.action]
    if (!allowed) return invalid(res, 'action', 'Unknown action.')
    const extra = Object.keys(body).find(k => !allowed.includes(k))
    if (extra) return invalid(res, extra, 'Unexpected field. The deciding user is taken from your session, never from the request.')
    if ('plan_id' in body && !UUID.test(String(body.plan_id || ''))) return invalid(res, 'plan_id', 'Missing plan.')
    if ('id' in body && !UUID.test(String(body.id || ''))) return invalid(res, 'id', 'Missing request.')

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }
    let level
    try { level = await budgetLevel(db, auth.grant?.id) } catch { return res.status(500).json({ error: 'grant_lookup_failed' }) }
    if (level === 'none') return res.status(403).json({ error: 'budget_access_required' })
    if (body.action !== 'plan_pdf' && level !== 'approve') return res.status(403).json({ error: 'approve_required', message: 'Approving the Program Budget needs the Approve level. Ask the program owner.' })

    const day = today ? { today: today() } : {}
    const actor = auth.profile
    try {
      switch (body.action) {
        case 'plan_decide': return res.status(200).json(await P.decidePlan(db, actor, {
          planId: body.plan_id, decision: body.decision,
          approved: body.approved && typeof body.approved === 'object' && !Array.isArray(body.approved) ? body.approved : {},
          comment: typeof body.comment === 'string' ? body.comment : '',
        }))
        case 'amendment_decide': {
          const out = await P.decideAmendment(db, actor, { id: body.id, decision: body.decision, comment: typeof body.comment === 'string' ? body.comment : '' })
          // A receipt the owner held for this amendment posts now, or goes back to review.
          const rel = await R.releaseAmendment(db, actor, { amendmentId: body.id, approved: out.amendment.status === 'approved', ...day })
          return res.status(200).json({ ...out, released: rel })
        }
        case 'proposal_request': return res.status(200).json(await P.requestProposal(db, actor, day))
        case 'plan_pdf': { const out = await P.planPdf(db, { planId: body.plan_id, reader: true }); return res.status(200).json({ fileName: out.fileName, pdf: Buffer.from(out.bytes).toString('base64') }) }
      }
    } catch (err) {
      if (err instanceof E.BudgetError) return res.status(err.status).json({ error: err.code, message: err.message })
      return res.status(500).json({ error: 'internal_error' })
    }
    return invalid(res, 'action', 'Unknown action.')
  }
}

export default createAcademicsBudgetReviewHandler()
