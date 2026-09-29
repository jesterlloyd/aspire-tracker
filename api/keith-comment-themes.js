// api/keith-comment-themes.js
//
// KEITH-THEMES-1 (2026-09-29): the Comments section of Evaluation > Responses. One POST, an
// { action, ... } body with a strict per-action key allow-list, server-verified identity. Owner and
// Admin (the Responses tab's own audience); the privacy floor and the mode switch are the Owner's.
//
//   timepoints { cohort_id, instrument }                     the timepoints with a submitted response
//   view       { cohort_id, instrument, timepoint, audience } 'owner' (every quote, with its response)
//                                                             or 'leadership' (the de-identified cut)
//   run        { cohort_id, instrument, timepoint, force }   a new version; force confirms replacing
//                                                             a version a person has edited
//   rename { theme_id, name } · merge { theme_id, into_id } · move { version_id, comment_id, to_theme_id }
//   accept { theme_id } · export { cohort_id, instrument, timepoint } · settings {} · set_floor { floor }
//   set_mode { mode }                                          Owner: 'on' shares with leadership

import { verifyPortalCaller, getServiceDb, isOwnerAdminProfile } from './lib/portalAuth.js'
import { populationDb } from '../lib/server/demoScope.js'
import * as T from '../lib/server/evaluation/commentThemes.js'
import { setSkillMode, KeithSkillError } from '../lib/server/keith/runKeithSkill.js'
import { surveyName, timepointQualifier } from '../src/lib/evaluation/surveyNames.js'
import { INSTRUMENTS } from '../src/lib/evaluation/commentThemesModel.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMEPOINT = /^[a-z_]{2,40}$/
const ACTION_SCHEMAS = Object.freeze({
  timepoints: ['action', 'cohort_id', 'instrument'],
  view: ['action', 'cohort_id', 'instrument', 'timepoint', 'audience'],
  run: ['action', 'cohort_id', 'instrument', 'timepoint', 'force'],
  rename: ['action', 'theme_id', 'name'],
  merge: ['action', 'theme_id', 'into_id'],
  move: ['action', 'version_id', 'comment_id', 'to_theme_id'],
  accept: ['action', 'theme_id'],
  export: ['action', 'cohort_id', 'instrument', 'timepoint'],
  settings: ['action'],
  set_floor: ['action', 'floor'],
  set_mode: ['action', 'mode'],
})
const invalid = (res, field, message) => res.status(400).json({ error: 'invalid_request', field, message })

export function createCommentThemesHandler({ verifyCaller = verifyPortalCaller, makeDb = getServiceDb, complete } = {}) {
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
    if (!allowed) return invalid(res, 'action', 'Unknown action.')
    const extra = Object.keys(body).find(k => !allowed.includes(k))
    if (extra) return invalid(res, extra, 'Unexpected field.')
    for (const k of ['cohort_id', 'theme_id', 'into_id', 'version_id']) if (k in body && !UUID.test(String(body[k] || ''))) return invalid(res, k, 'Missing id.')
    if ('to_theme_id' in body && body.to_theme_id !== null && !UUID.test(String(body.to_theme_id))) return invalid(res, 'to_theme_id', 'Choose a theme or Other.')
    if ('instrument' in body && !INSTRUMENTS.includes(body.instrument)) return invalid(res, 'instrument', 'Unknown evaluation.')
    if ('timepoint' in body && !TIMEPOINT.test(String(body.timepoint || ''))) return invalid(res, 'timepoint', 'Choose a timepoint.')
    if ('comment_id' in body && !/^c\d{1,4}$/.test(String(body.comment_id || ''))) return invalid(res, 'comment_id', 'Missing comment.')
    if ('audience' in body && !['owner', 'leadership'].includes(body.audience)) return invalid(res, 'audience', 'Choose owner or leadership.')

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }
    const scoped = populationDb(db, req)
    const key = { cohortId: body.cohort_id, slug: body.instrument, timepoint: body.timepoint }
    try {
      switch (body.action) {
        case 'timepoints': return res.status(200).json({ timepoints: await T.timepointsWithComments(scoped, key) })
        case 'view': return res.status(200).json(await T.themesView(scoped, { ...key, audience: body.audience || 'owner', preview: true }))
        case 'run': return res.status(200).json(await T.runThemes(scoped, { ...key, actor: profile, source: 'manual', force: body.force === true, ...(complete ? { complete } : {}) }))
        case 'rename': return res.status(200).json(await T.rename(db, profile, { themeId: body.theme_id, name: body.name }))
        case 'merge': return res.status(200).json(await T.merge(db, profile, { themeId: body.theme_id, intoId: body.into_id }))
        case 'move': return res.status(200).json(await T.move(db, profile, { versionId: body.version_id, commentId: body.comment_id, toThemeId: body.to_theme_id ?? null }))
        case 'accept': return res.status(200).json(await T.accept(db, profile, { themeId: body.theme_id }))
        case 'export': return res.status(200).json(await T.exportThemes(scoped, { ...key, instrumentName: surveyName(key.slug), timepointLabel: timepointQualifier(key.timepoint) }))
        case 'settings': return res.status(200).json({ floor: await T.privacyFloor(db) })
        case 'set_floor':
          if (profile?.is_owner !== true) return res.status(403).json({ error: 'owner_required', message: 'Only the Owner changes the privacy floor.' })
          return res.status(200).json(await T.setPrivacyFloor(db, profile, { floor: body.floor }))
        case 'set_mode':
          if (profile?.is_owner !== true) return res.status(403).json({ error: 'owner_required', message: 'Only the Owner shares themes with leadership.' })
          if (!['on', 'shadow'].includes(body.mode)) return invalid(res, 'mode', 'Choose on or shadow.')
          return res.status(200).json(await setSkillMode(db, T.SKILL_KEY, body.mode, profile))
      }
    } catch (e) {
      if (e instanceof T.CommentThemesError || e instanceof KeithSkillError) return res.status(e.status || 409).json({ error: e.code || e.reason, message: e.message })
      console.warn('[keith-comment-themes] failed', { action: body.action, reason: e?.message })
      return res.status(500).json({ error: 'failed' })
    }
    return invalid(res, 'action', 'Unknown action.')
  }
}

export default createCommentThemesHandler()
