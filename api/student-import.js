// api/student-import.js
//
// STUDENT-IMPORT-KEITH-1 (Owner, 2026-11-03): Keith's spreadsheet import, for Student Profiles
// (into a cohort) and Residency > Profiles & Interest (alumni onto a residency cohort's roster).
// Its own file because Keith on Opus can take most of a minute (vercel.json gives it 60 s).
//
//   POST { action: 'analyze', target, cohort_id | cycle_id, file_name, file_base64 }
//        -> { file, shown, mapping, keith, questions, cohortNames }
//   POST { action: 'plan',    ...the same, mapping, answers }           -> { rows, counts, status }
//   POST { action: 'commit',  ...the same, mapping, answers, decisions } -> { created, updated, added, skipped, failed }
//   POST { action: 'hires_analyze' | 'hires_commit', file_name, file_base64, mapping, cohorts, decisions, dates }
//        -> HIRE-HISTORY-1: Record past hires (lib/server/hireImport.js)
//
// Who: an active Owner or Admin of the staff app (verifyOwnerAdmin). Keith's Skill then applies its
// own switch and roles, and runs on Opus for the Owner only (the rule lives in
// lib/server/keith/modelRouting.js). Nothing of the file is stored; reads and writes stay in the caller's
// population (demo or real).
import { getServiceDb } from './lib/portalAuth.js'
import { verifyOwnerAdmin } from './lib/catalogAuth.js'
import { serviceDbForRequest, demoScopeFromRequest } from '../lib/server/demoScope.js'
import { analyzeImport, planImport, commitImport, ImportError } from '../lib/server/studentImport.js'
import { analyzeHires, commitHires } from '../lib/server/hireImport.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const service = getServiceDb()
  const caller = await verifyOwnerAdmin(req, service)
  if (!caller.ok) return res.status(caller.status).json(caller.body)
  const actor = { id: caller.profileId, role: caller.role, is_owner: caller.isOwner }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const db = serviceDbForRequest(service, req)
  try {
    if (body.action === 'analyze') return res.status(200).json({ ok: true, ...(await analyzeImport(db, body, { actor })) })
    if (body.action === 'plan') return res.status(200).json({ ok: true, ...(await planImport(db, body)) })
    if (body.action === 'commit') {
      const r = await commitImport(db, body, { actorId: caller.profileId, isDemo: demoScopeFromRequest(req) === true })
      return res.status(200).json({ ok: true, ...r })
    }
    // HIRE-HISTORY-1: Record past hires (Residency > Residents), the same caller gate.
    if (body.action === 'hires_analyze') return res.status(200).json({ ok: true, ...(await analyzeHires(db, body)) })
    if (body.action === 'hires_commit') return res.status(200).json({ ok: true, ...(await commitHires(db, body, { actorId: caller.profileId })) })
    return res.status(400).json({ error: 'invalid_action' })
  } catch (err) {
    if (err instanceof ImportError) return res.status(err.status).json({ ok: false, error: err.error, message: err.message })
    console.error('[student-import] failed:', err?.message || err)
    return res.status(500).json({ ok: false, error: 'internal_error' })
  }
}
