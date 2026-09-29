// api/portal/academics-evaluation-themes.js
//
// KEITH-THEMES-1 (2026-09-29): the Evaluation page of the Nursing Education & Leadership portal. GET only,
// read-only by construction.
//
// AUTHORIZATION. verifyPortalNursingAcademicCaller confirms a verified JWT, an active profile and an
// ACTIVE nursing_academic grant. On top of that, the grant must carry evaluation_themes_access = 'view'
// (Owner decision, 2026-09-29: per person, off by default), re-read on every request. Owner and Admin
// previewing the portal get the same leadership payload.
//
// OUTPUT. Only the de-identified cut (lib/server/evaluation/commentThemes.js themesView, audience
// 'leadership'): the privacy floor applied, quotes only with consent and with names removed, no ids of
// responses or students, and nothing at all until the Owner has turned the skill ON. REAL rows only.

import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'
import { getServiceDb } from '../lib/portalAuth.js'
import { populationDb } from '../../lib/server/demoScope.js'
import { themesView, portalIndex } from '../../lib/server/evaluation/commentThemes.js'
import { INSTRUMENTS } from '../../src/lib/evaluation/commentThemesModel.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Does this grant carry the Evaluation page? A missing column means not yet. */
export async function grantHasThemes(db, grantId) {
  const { data, error } = await db.from('user_role_grants').select('evaluation_themes_access').eq('id', grantId).maybeSingle()
  if (error) return false
  return data?.evaluation_themes_access === 'view'
}

/** The leadership payload, cut down again: nothing that points back to a response or a person. */
export function portalShape(view) {
  if (!view?.available || !view.qualifying || !view.version) return { available: !!view?.available, published: !!view?.published, themes: [], total: 0 }
  return {
    available: true, published: true, total: view.total,
    themes: view.themes.map(t => ({ name: t.name, count: t.count, share: t.share, quotes: t.quotes, quotesWithheld: t.quotesWithheld })),
    other: { count: view.other.count, note: view.other.note }, note: view.note,
    reviewed: view.version.reviewer ? { name: view.version.reviewer.name, at: view.version.reviewer.at } : null,
    generatedAt: view.version.createdAt,
  }
}

export function createAcademicsThemesHandler({ verifyCaller = verifyPortalNursingAcademicCaller, makeDb = getServiceDb, hasThemes = grantHasThemes } = {}) {
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
      try { ok = await hasThemes(db, auth.grant?.id) } catch { return res.status(500).json({ error: 'grant_lookup_failed' }) }
      if (!ok) return res.status(403).json({ error: 'evaluation_themes_access_required' })
    }
    const real = populationDb(db)
    try {
      if (req.query?.probe === '1') return res.status(200).json({ enabled: true })
      const { cohort_id: cohortId, instrument, timepoint } = req.query || {}
      if (!cohortId) return res.status(200).json(await portalIndex(real))
      if (!UUID.test(String(cohortId)) || !INSTRUMENTS.includes(instrument) || !/^[a-z_]{2,40}$/.test(String(timepoint || ''))) return res.status(400).json({ error: 'invalid_request' })
      return res.status(200).json(portalShape(await themesView(real, { cohortId, slug: instrument, timepoint, audience: 'leadership' })))
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createAcademicsThemesHandler()
