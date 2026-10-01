// api/keith-knowledge-check.js
//
// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 2 (2026-10-01): Keith's Knowledge Center self-check, from Settings >
// Keith > Knowledge Center. One POST, an { action } body with a strict key allow-list, server-verified
// identity.
//
//   status {}   Owner and Admin: the last checks (with an estimated cost), how many unanswered
//               questions are waiting, how many of Keith's suggestions are waiting, and whether the
//               skill is on
//   run    {}   Owner only: run a check now (lib/server/keith/knowledgeSelfCheck.js). It takes a
//               minute or two; maxDuration is 300 in vercel.json.
//
// Knowledge tables are not in the demo boundary and the questions table only ever holds real
// sessions' questions, so the plain service client is right here.

import { verifyPortalCaller, getServiceDb, isOwnerAdminProfile } from './lib/portalAuth.js'
import { runKnowledgeSelfCheck, listChecks, SKILL_KEY } from '../lib/server/keith/knowledgeSelfCheck.js'
import { loadSkill } from '../lib/server/keith/runKeithSkill.js'
import { skillMode } from '../src/lib/keith/provenanceModel.js'
import { estimateCostUsd } from '../lib/server/keith/modelPricing.js'

const ACTION_SCHEMAS = Object.freeze({ status: ['action'], run: ['action'] })
const count = async (q) => { const { count: n, data, error } = await q; return error ? null : (n ?? (Array.isArray(data) ? data.length : 0)) }

/** A check as the Knowledge Center shows it. */
export function checkView(c) {
  return {
    id: c.id, started_at: c.started_at, finished_at: c.finished_at, trigger: c.trigger, status: c.status,
    changes_since: c.changes_since, changes_until: c.changes_until,
    changes_read: c.changes_read, questions_read: c.questions_read, entries_read: c.entries_read,
    suggestions: c.suggestions, drafts: c.drafts, findings: c.findings || [], skipped: c.skipped || [],
    input_tokens: c.input_tokens, output_tokens: c.output_tokens, model: c.model,
    cost_usd: c.model ? estimateCostUsd(c.model, c.input_tokens, c.output_tokens) : (c.input_tokens || c.output_tokens ? null : 0),
    error: c.error || null,
  }
}

export function createKnowledgeCheckHandler({ verifyCaller = verifyPortalCaller, makeDb = getServiceDb, complete, fetchChanges } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }) }
    const caller = await verifyCaller(req)
    if (!caller.authenticated) return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
    const profile = caller.profile
    if (!(profile?.is_owner === true || isOwnerAdminProfile(profile))) return res.status(403).json({ error: 'forbidden' })

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const allowed = ACTION_SCHEMAS[body.action]
    if (!allowed) return res.status(400).json({ error: 'invalid_request', field: 'action', message: 'Unknown action.' })
    const extra = Object.keys(body).find(k => !allowed.includes(k))
    if (extra) return res.status(400).json({ error: 'invalid_request', field: extra, message: 'Unexpected field.' })

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }
    try {
      if (body.action === 'status') {
        const checks = await listChecks(db, 5)
        if (!checks.ok) return res.status(200).json({ enabled: false, reason: 'not_enabled' })
        const skill = await loadSkill(db, SKILL_KEY)
        const [questionsWaiting, editsWaiting, draftsWaiting] = await Promise.all([
          count(db.from('keith_knowledge_gaps').select('id', { count: 'exact', head: true }).gte('expires_at', new Date().toISOString())),
          count(db.from('knowledge_revisions').select('id', { count: 'exact', head: true }).eq('proposed_by', 'keith')),
          count(db.from('knowledge_entries').select('id', { count: 'exact', head: true }).eq('proposed_by', 'keith').eq('state', 'draft')),
        ])
        return res.status(200).json({
          enabled: true,
          skill_on: !!skill && skillMode(skill) !== 'off',
          can_run: profile?.is_owner === true,
          questions_waiting: questionsWaiting, edits_waiting: editsWaiting, drafts_waiting: draftsWaiting,
          checks: checks.checks.map(checkView),
        })
      }
      // run
      if (profile?.is_owner !== true) return res.status(403).json({ error: 'owner_required', message: 'Only the Owner runs a Knowledge Center check.' })
      const out = await runKnowledgeSelfCheck(db, { actor: profile, trigger: 'manual', ...(complete ? { complete } : {}), ...(fetchChanges ? { fetchChanges } : {}) })
      if (!out.ok) return res.status(out.status || 409).json({ error: out.reason, message: out.message, ...(out.check ? { check: checkView(out.check) } : {}) })
      return res.status(200).json({ check: checkView(out.check) })
    } catch (e) {
      console.error('[keith-knowledge-check]', { action: body.action, reason: e?.message })
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createKnowledgeCheckHandler()
