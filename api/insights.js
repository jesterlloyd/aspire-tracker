/* global process */
// api/insights.js
//
// ASPIRE-INSIGHTS-1, Phase 1: the one endpoint behind every Insights surface.
//
//   GET /api/insights?surface=staff       staff app, insights_view (Owner, Admin, Co-Lead)
//   GET /api/insights?surface=leadership  NE&L Portal Data tab, an active nursing_academic grant
//   GET /api/insights?surface=partner     Academic Partner At a Glance, the caller's school scopes
//   GET /api/insights?surface=unit        Unit Leader At a Glance, the caller's unit scopes
//   GET /api/insights?surface=residency   Residency Portal At a Glance, program level only
//
// The surface says which door the caller is knocking on; the grant behind that door decides the
// lock. Nothing in the query names a school or a unit the lock does not already cover: a partner
// who asks for another school's figures gets their own school's, because the school filter is
// not offered to a portal viewer at all (sanitizeFilters). Aggregates only, never a student id.

import { verifyPortalCaller, getServiceDb } from './lib/portalAuth.js'
import { verifyPortalAcademicPartnerCaller, matchSchoolCohortScope } from './lib/schoolScope.js'
import { verifyPortalUnitLeaderCaller } from './lib/unitLeaderScope.js'
import { narrowScopes } from './lib/unitLeaderScopeRules.js'
import { verifyPortalNursingAcademicCaller } from './lib/nursingAcademicScope.js'
import { verifyNgrpCaller } from './lib/ngrpAuth.js'
import { can } from '../lib/server/access.js'
import { populationDb, populationOf } from '../lib/server/demoScope.js'
import { getInsights } from '../lib/server/insights/getInsights.js'

export const SURFACES = Object.freeze(['staff', 'leadership', 'partner', 'unit', 'residency'])

/**
 * Who is asking, from their grant. Returns { ok, viewer } or { ok: false, status, reason }.
 * Exported with injectable verifiers so the locks are tested at this boundary.
 */
export async function resolveViewer(req, surface, deps = {}) {
  const v = {
    staff: deps.verifyStaff || verifyPortalCaller,
    leadership: deps.verifyLeadership || verifyPortalNursingAcademicCaller,
    partner: deps.verifyPartner || verifyPortalAcademicPartnerCaller,
    unit: deps.verifyUnit || verifyPortalUnitLeaderCaller,
    residency: deps.verifyResidency || verifyNgrpCaller,
  }
  if (surface === 'staff') {
    const caller = await v.staff(req)
    if (!caller?.authenticated) return { ok: false, status: caller?.status || 401, reason: 'unauthorized' }
    if (!can(caller.profile, 'insights_view')) return { ok: false, status: 403, reason: 'insights_role_required' }
    return { ok: true, viewer: { kind: 'staff' } }
  }
  if (surface === 'leadership') {
    const auth = await v.leadership(req)
    if (!auth?.ok) return { ok: false, status: auth?.status || 401, reason: auth?.reason || 'unauthorized' }
    return { ok: true, viewer: { kind: 'leadership' } }
  }
  if (surface === 'partner') {
    const auth = await v.partner(req)
    if (!auth?.ok) return { ok: false, status: auth?.status || 401, reason: auth?.reason || 'unauthorized' }
    // A partner (or an Owner/Admin preview, whose scope is every school) narrows to the school
    // chosen in the portal header, exactly as the student table does. A school the grant does not
    // hold narrows to nothing, never to that school.
    const requested = String(req.query?.school || '').trim()
    const held = auth.scopes || []
    const scopes = requested ? held.filter(s => s.school_key === requested) : held
    return { ok: true, viewer: { kind: 'partner', inSchoolScope: (school, cohortId) => matchSchoolCohortScope(scopes, school, cohortId) } }
  }
  if (surface === 'unit') {
    const auth = await v.unit(req)
    if (!auth?.ok) return { ok: false, status: auth?.status || 401, reason: auth?.reason || 'unauthorized' }
    // A leader with several units may narrow to one; asking for a unit they do not hold narrows
    // to nothing, never to that unit.
    const requested = String(req.query?.unit || '').trim() || null
    const scopes = narrowScopes(auth.scopes || [], requested) || []
    return { ok: true, viewer: { kind: 'unit', unitKeys: [...new Set(scopes.map(s => s.unit_key))] } }
  }
  if (surface === 'residency') {
    const auth = await v.residency(req)
    if (!auth?.ok) return { ok: false, status: auth?.status || 401, reason: auth?.reason || 'unauthorized' }
    return { ok: true, viewer: { kind: 'residency' } }
  }
  return { ok: false, status: 400, reason: 'unknown_surface' }
}

export function makeHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    if (!deps.dbFor && (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL))) {
      return res.status(500).json({ error: 'internal_error' })
    }
    const surface = String(req.query?.surface || 'staff')
    if (!SURFACES.includes(surface)) return res.status(400).json({ error: 'unknown_surface' })

    const who = await resolveViewer(req, surface, deps)
    if (!who.ok) return res.status(who.status).json({ error: who.reason })

    const population = populationOf(req)
    const dbFor = deps.dbFor || (() => populationDb(getServiceDb(), req))
    try {
      const body = await getInsights(req.query || {}, who.viewer, { dbFor, population, load: deps.load })
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json(body)
    } catch (err) {
      console.log('[insights] failed', { surface, message: err?.message })
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default makeHandler()
