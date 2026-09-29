// lib/server/evaluation/commentThemes.js
//
// KEITH-THEMES-1 (2026-09-29): Keith's comment themes for Evaluation > Responses, the server side. The
// rules are src/lib/evaluation/commentThemesModel.js; the model call is the theme-comments skill
// through runKeithSkill.
//
//   runThemes     one run for (cohort, instrument, timepoint): the comments read live, given to Keith
//                 as opaque ids, written as a NEW version with one Keith provenance per theme. A run
//                 never replaces a version a person has edited unless the caller confirms (force).
//   themesView    OWNER (Owner and Admin): every theme with its verbatim quotes and their responses,
//                 and Other. LEADERSHIP: the de-identified cut, and only once the skill is ON.
//   rename / merge / move / accept   a person's edits, each moving the affected themes' provenance
//   exportCsv     the de-identified table with the review line
//   autoRun       the daily cron: a timepoint with nothing still awaiting gets themes (or new ones,
//                 when comments arrived since and nobody has edited the current version)
//   portalIndex   what a Nursing Education & Leadership grant may open: real cohorts, skill ON only

import { randomUUID } from 'node:crypto'
import { runKeithSkill, recordKeithOutcome, loadSkill, skillVersionOf } from '../keith/runKeithSkill.js'
import { SKILL_DEFS } from '../keith/skillDefs.js'
import { skillMode } from '../../../src/lib/keith/provenanceModel.js'
import {
  extractComments, opaqueIds, leadershipCut, nameList, exportCsv as toCsv, qualifies, DEFAULT_PRIVACY_FLOOR, INSTRUMENTS,
} from '../../../src/lib/evaluation/commentThemesModel.js'

export const SKILL_KEY = 'theme-comments'
const MAX_COMMENTS = 400
const AUTO_PER_RUN = 5

export class CommentThemesError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}
async function rows(query, what) {
  const { data, error } = await query
  if (error) throw new CommentThemesError('read_failed', `${what} could not be read.`, 500)
  return data || []
}

/** The submitted assignments of one instrument, cohort and timepoint, with their responses. */
async function assignmentsWithResponses(db, { cohortId, slug, timepoint }) {
  const [instrument] = await rows(db.from('evaluation_instruments').select('id, slug').eq('slug', slug).limit(1), 'Instruments')
  if (!instrument) return []
  const list = await rows(db.from('evaluation_assignments').select('id, student_id, timepoint').eq('cohort_id', cohortId).eq('instrument_id', instrument.id).eq('timepoint', timepoint), 'Assignments')
  if (!list.length) return []
  const resp = await rows(db.from('evaluation_responses').select('assignment_id, responses, submitted_at').in('assignment_id', list.map(a => a.id)), 'Responses')
  const byId = new Map(resp.map(r => [r.assignment_id, r]))
  return list.map(a => ({ ...a, evaluation_responses: byId.get(a.id) || null }))
}

export async function loadComments(db, key) {
  if (!qualifies(key.slug)) return []
  return extractComments(key.slug, await assignmentsWithResponses(db, key))
}

async function latestVersion(db, { cohortId, slug, timepoint }) {
  const [v] = await rows(db.from('comment_theme_versions').select('*').eq('cohort_id', cohortId).eq('instrument_slug', slug).eq('timepoint', timepoint).order('version', { ascending: false }).limit(1), 'Theme versions')
  if (!v) return null
  const themes = await rows(db.from('comment_themes').select('*').eq('version_id', v.id).order('position'), 'Themes')
  return { ...v, themes }
}
const personEdited = (v) => !!v?.themes?.some(t => t.state !== 'drafted')

/** One run. `source` is 'manual' (a person, Run again) or 'auto' (the cron). */
export async function runThemes(db, { cohortId, slug, timepoint, actor = null, source = 'manual', force = false, complete } = {}) {
  if (!INSTRUMENTS.includes(slug) || !qualifies(slug)) throw new CommentThemesError('not_qualifying', 'This evaluation has no comment questions.', 400)
  const skill = await loadSkill(db, SKILL_KEY).catch(() => null)
  if (skillMode(skill) === 'off') throw new CommentThemesError('off', 'Keith’s Theme Comments skill is off. Turn it on in Settings > Keith > Skills.')
  const comments = (await loadComments(db, { cohortId, slug, timepoint })).slice(0, MAX_COMMENTS)
  if (!comments.length) throw new CommentThemesError('no_comments', 'There are no comments to read for this timepoint yet.')
  const prior = await latestVersion(db, { cohortId, slug, timepoint })
  if (personEdited(prior) && !force) {
    throw new CommentThemesError('edited', 'Someone has edited these themes. Running again makes a new version from Keith; the edited one stays in the history. Confirm to run again.')
  }

  const { ids, forKeith } = opaqueIds(comments)
  const refs = [...new Set(comments.map(c => c.assignmentId))].map(id => ({ type: 'evaluation_response', id }))
  const versionId = randomUUID()
  const run = await runKeithSkill(db, SKILL_KEY, { comments: { value: forKeith, refs } },
    { actor, system: source === 'auto', entity: { id: versionId, field: 'themes' }, complete, defs: SKILL_DEFS })
  if (!run.ok) throw new CommentThemesError('keith_failed', 'Keith could not theme these comments just now. Try again in a moment.', 502)

  const version = {
    id: versionId, cohort_id: cohortId, instrument_slug: slug, timepoint, version: (prior?.version || 0) + 1, source, mode: run.mode,
    created_by: actor?.id || null, comment_count: comments.length,
    comment_refs: Object.fromEntries([...ids].map(([id, c]) => [id, { assignment_id: c.assignmentId, field: c.field }])),
    keith_provenance_id: run.provenanceId,
  }
  const { error: verr } = await db.from('comment_theme_versions').insert(version)
  if (verr) throw new CommentThemesError('save_failed', 'The themes could not be saved.', 500)

  const skillVersion = skillVersionOf(skill, SKILL_DEFS[SKILL_KEY])
  const themeRows = []
  for (const [i, t] of run.output.themes.entries()) {
    const id = randomUUID()
    const themeRefs = [...new Set(t.comment_ids.map(cid => ids.get(cid)?.assignmentId).filter(Boolean))].map(a => ({ type: 'evaluation_response', id: a }))
    const { data: prov } = await db.from('keith_provenance').insert({
      skill_key: SKILL_KEY, skill_version: skillVersion, entity_type: 'eval_theme', entity_id: id, field: 'theme',
      input_refs: themeRefs, output: t, reason: t.reason || null, mode: run.mode, state: 'drafted',
    }).select('id')
    themeRows.push({ id, version_id: versionId, name: t.name, keith_name: t.name, comment_ids: t.comment_ids, example_ids: t.example_ids, reason: t.reason || null, position: i, keith_provenance_id: prov?.[0]?.id || null })
  }
  if (themeRows.length) {
    const { error } = await db.from('comment_themes').insert(themeRows)
    if (error) throw new CommentThemesError('save_failed', 'The themes could not be saved.', 500)
  }
  return { version: version.version, themes: themeRows.length, comments: comments.length, mode: run.mode }
}

async function namesFor(db, cohortId) {
  const [students, units] = await Promise.all([
    rows(db.from('students').select('first_name, last_name, preferred_first_name').eq('cohort_id', cohortId), 'Students'),
    rows(db.from('units').select('unit_name').eq('cohort_id', cohortId), 'Units'),
  ])
  const preceptors = (await db.from('preceptors').select('full_name')).data || []
  const staff = (await db.from('user_profiles').select('full_name')).data || []
  return nameList({ students, preceptors, staff, units })
}

/**
 * REVIEWED-THEMES-1 (Owner, 2026-09-29): leadership, the portal and the export see ACCEPTED themes only.
 * A theme edited after acceptance reads 'edited' again (THEMES-FOLD-1), so it leaves this view until a
 * person accepts it again.
 */
function reviewedOnly(live) {
  const themes = live.filter(t => t.state === 'accepted')
  const pending = live.filter(t => t.state !== 'accepted').reduce((n, t) => n + t.comment_ids.length, 0)
  return { themes, pending }
}

export async function privacyFloor(db) {
  const { data } = await db.from('evaluation_theme_settings').select('privacy_floor').limit(1)
  return Number(data?.[0]?.privacy_floor) || DEFAULT_PRIVACY_FLOOR
}

async function reviewerOf(db, themes) {
  const touched = themes.filter(t => t.state !== 'drafted' && t.updated_by).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0]
  if (!touched) return null
  const { data } = await db.from('user_profiles').select('full_name').eq('id', touched.updated_by).limit(1)
  // The day it was reviewed, on ASPIRE's clock: an evening edit in Los Angeles is not tomorrow.
  return { name: data?.[0]?.full_name || 'a staff member', at: new Date(touched.updated_at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) }
}

/**
 * The current version, its comments read live by reference, and its live themes (merged ones gone,
 * comments whose response has since gone dropped), largest first.
 */
async function snapshot(db, key) {
  const comments = await loadComments(db, key)
  const v = await latestVersion(db, key).catch(e => { if (e.code === 'read_failed') return null; throw e })
  const byRef = new Map(comments.map(c => [c.ref, c]))
  const commentsById = new Map()
  for (const [id, r] of Object.entries(v?.comment_refs || {})) {
    const c = byRef.get(`${r.assignment_id}|${r.field}`)
    if (c) commentsById.set(id, c)
  }
  const live = (v?.themes || []).filter(t => t.state !== 'merged')
    .map(t => ({ ...t, comment_ids: (t.comment_ids || []).filter(id => commentsById.has(id)), example_ids: (t.example_ids || []).filter(id => commentsById.has(id)) }))
    .filter(t => t.comment_ids.length)
    .sort((a, b) => b.comment_ids.length - a.comment_ids.length || a.position - b.position)
  return { comments, v, commentsById, live, total: commentsById.size }
}

/**
 * What the Comments section shows. `audience` is 'owner' (Owner and Admin) or 'leadership'. Returns
 * { available, mode, timepoints, version, total, ... }. `preview` lets Owner and Admin see the
 * leadership cut while the skill is still in shadow, so it can be checked before it is shared; the
 * portal never passes it, so leadership sees nothing until the skill is ON.
 */
export async function themesView(db, { cohortId, slug, timepoint, audience = 'owner', preview = false }) {
  const skill = await loadSkill(db, SKILL_KEY).catch(() => null)
  if (!skill || !('run_mode' in skill)) return { available: false }
  const mode = skillMode(skill)
  const qualifying = qualifies(slug)
  if (!qualifying) return { available: true, mode, qualifying: false }
  const { comments, v, commentsById, live, total } = await snapshot(db, { cohortId, slug, timepoint })
  const base = { available: true, mode, qualifying: true, liveComments: comments.length, published: mode === 'on' }
  if (!v) return { ...base, version: null, total: 0 }
  const reviewer = await reviewerOf(db, v.themes)
  const versionInfo = { id: v.id, version: v.version, createdAt: v.created_at, source: v.source, provenanceId: v.keith_provenance_id, edited: personEdited(v), reviewer, newComments: Math.max(0, comments.length - v.comment_count) }

  if (audience === 'leadership') {
    if (mode !== 'on' && !(preview && mode === 'shadow')) return { ...base, version: null, total: 0 }
    const cut = leadershipCut({ ...reviewedOnly(live), commentsById, total, floor: await privacyFloor(db), names: await namesFor(db, cohortId) })
    return { ...base, version: versionInfo, ...cut, floor: await privacyFloor(db) }
  }
  const quote = (id) => { const c = commentsById.get(id); return c ? { id, text: c.text, assignmentId: c.assignmentId, label: c.label } : null }
  const themed = new Set(live.flatMap(t => t.comment_ids))
  return {
    ...base, version: versionInfo, total,
    themes: live.map(t => ({
      id: t.id, name: t.name, keithName: t.keith_name, count: t.comment_ids.length, reason: t.reason || '', state: t.state,
      provenanceId: t.keith_provenance_id, quotes: t.example_ids.map(quote).filter(Boolean), commentIds: t.comment_ids,
      comments: t.comment_ids.map(quote).filter(Boolean),
    })),
    other: [...commentsById.keys()].filter(id => !themed.has(id)).map(quote).filter(Boolean),
  }
}

/** The timepoints of an instrument in a cohort that have at least one submitted response. */
export async function timepointsWithComments(db, { cohortId, slug }) {
  const [instrument] = await rows(db.from('evaluation_instruments').select('id').eq('slug', slug).limit(1), 'Instruments')
  if (!instrument) return []
  const list = await rows(db.from('evaluation_assignments').select('id, timepoint').eq('cohort_id', cohortId).eq('instrument_id', instrument.id), 'Assignments')
  const done = list.length ? new Set((await rows(db.from('evaluation_responses').select('assignment_id').in('assignment_id', list.map(a => a.id)).not('submitted_at', 'is', null), 'Responses')).map(r => r.assignment_id)) : new Set()
  return [...new Set(list.filter(a => done.has(a.id)).map(a => a.timepoint))]
}

// ── A person's edits ─────────────────────────────────────────────────────────────

async function themeOf(db, id) {
  const [t] = await rows(db.from('comment_themes').select('*').eq('id', id).limit(1), 'Theme')
  if (!t || t.state === 'merged') throw new CommentThemesError('not_found', 'That theme no longer exists.', 404)
  const [v] = await rows(db.from('comment_theme_versions').select('id, cohort_id, instrument_slug, timepoint, version').eq('id', t.version_id).limit(1), 'Version')
  const latest = await latestVersion(db, { cohortId: v.cohort_id, slug: v.instrument_slug, timepoint: v.timepoint })
  if (latest?.id !== v.id) throw new CommentThemesError('old_version', 'A newer version of these themes exists. Refresh to edit it.')
  return t
}
const stamp = (actor) => ({ updated_by: actor?.id || null, updated_at: new Date().toISOString() })
const edited = (t) => (t.state === 'accepted' || t.state === 'drafted' || t.state === 'edited' ? 'edited' : t.state)

export async function rename(db, actor, { themeId, name }) {
  const t = await themeOf(db, themeId)
  const next = String(name || '').replace(/\s+/g, ' ').trim()
  if (next.length < 1 || next.length > 80) throw new CommentThemesError('invalid_name', 'A theme name is 1 to 80 characters.', 400)
  if (next === t.name) return { unchanged: true }
  await db.from('comment_themes').update({ name: next, state: edited(t), ...stamp(actor) }).eq('id', t.id)
  await recordKeithOutcome(db, t.keith_provenance_id, 'edit', [{ field: 'name', from: t.name, to: next }], actor)
  return { renamed: true }
}

export async function merge(db, actor, { themeId, intoId }) {
  if (themeId === intoId) throw new CommentThemesError('same', 'Choose a different theme to merge into.', 400)
  const from = await themeOf(db, themeId)
  const into = await themeOf(db, intoId)
  if (from.version_id !== into.version_id) throw new CommentThemesError('old_version', 'Both themes must be in the current version.')
  const ids = [...new Set([...(into.comment_ids || []), ...(from.comment_ids || [])])]
  const examples = [...new Set([...(into.example_ids || []), ...(from.example_ids || [])])].slice(0, 3)
  await db.from('comment_themes').update({ comment_ids: ids, example_ids: examples, state: edited(into), ...stamp(actor) }).eq('id', into.id)
  await db.from('comment_themes').update({ state: 'merged', merged_into: into.id, ...stamp(actor) }).eq('id', from.id)
  await recordKeithOutcome(db, into.keith_provenance_id, 'edit', [{ field: 'merge', item: from.name, from: into.comment_ids.length, to: ids.length }], actor)
  await recordKeithOutcome(db, from.keith_provenance_id, 'edit', [{ field: 'merged_into', from: from.name, to: into.name }], actor)
  return { merged: true }
}

/** Move one comment to another theme, or to Other (toThemeId null). */
export async function move(db, actor, { versionId, commentId, toThemeId = null }) {
  const themes = await rows(db.from('comment_themes').select('*').eq('version_id', versionId), 'Themes')
  if (!themes.length) throw new CommentThemesError('not_found', 'Those themes no longer exist.', 404)
  await themeOf(db, themes[0].id)                          // the current version only
  const [v] = await rows(db.from('comment_theme_versions').select('comment_refs').eq('id', versionId).limit(1), 'Version')
  if (!v?.comment_refs || !(commentId in v.comment_refs)) throw new CommentThemesError('not_found', 'That comment is not in these themes.', 404)
  const source = themes.find(t => t.state !== 'merged' && (t.comment_ids || []).includes(commentId)) || null
  const target = toThemeId ? themes.find(t => t.id === toThemeId && t.state !== 'merged') : null
  if (toThemeId && !target) throw new CommentThemesError('not_found', 'That theme no longer exists.', 404)
  if (source?.id === target?.id) return { unchanged: true }
  if (source) {
    await db.from('comment_themes').update({ comment_ids: source.comment_ids.filter(x => x !== commentId), example_ids: (source.example_ids || []).filter(x => x !== commentId), state: edited(source), ...stamp(actor) }).eq('id', source.id)
    await recordKeithOutcome(db, source.keith_provenance_id, 'edit', [{ field: 'move_out', item: commentId, from: source.name, to: target?.name || 'Other' }], actor)
  }
  if (target) {
    await db.from('comment_themes').update({ comment_ids: [...new Set([...(target.comment_ids || []), commentId])], state: edited(target), ...stamp(actor) }).eq('id', target.id)
    await recordKeithOutcome(db, target.keith_provenance_id, 'edit', [{ field: 'move_in', item: commentId, from: source?.name || 'Other', to: target.name }], actor)
  }
  return { moved: true }
}

/**
 * Accept is the person's sign-off: the theme's own state becomes 'accepted' whether or not it was edited
 * first, and that is what folds the card and counts as reviewed (THEMES-FOLD-1, Owner, 2026-09-29). The
 * Keith mark still says whether Keith's work was changed: its provenance stays Edited after an edit. An
 * edit after acceptance (rename, merge, move) puts the theme back to 'edited', to be reviewed again.
 */
export async function accept(db, actor, { themeId }) {
  const t = await themeOf(db, themeId)
  if (t.state === 'accepted') return { state: 'accepted', unchanged: true }
  await db.from('comment_themes').update({ state: 'accepted', ...stamp(actor) }).eq('id', t.id)
  await recordKeithOutcome(db, t.keith_provenance_id, 'accept', null, actor)
  return { state: 'accepted' }
}

export async function setPrivacyFloor(db, actor, { floor }) {
  const n = Number(floor)
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new CommentThemesError('invalid_floor', 'The privacy floor is a whole number from 1 to 20.', 400)
  await db.from('evaluation_theme_settings').upsert({ id: true, privacy_floor: n, ...stamp(actor) }, { onConflict: 'id' })
  return { floor: n }
}

/** The de-identified export, with the review line. */
export async function exportThemes(db, { cohortId, slug, timepoint, instrumentName, timepointLabel }) {
  const { v, commentsById, live, total } = await snapshot(db, { cohortId, slug, timepoint })
  if (!v) throw new CommentThemesError('no_themes', 'There are no themes to export yet.')
  const cut = leadershipCut({ ...reviewedOnly(live), commentsById, total, floor: await privacyFloor(db), names: await namesFor(db, cohortId) })
  const r = await reviewerOf(db, v.themes)
  return { csv: toCsv(cut, { instrumentName, timepointLabel, reviewer: r?.name, reviewedAt: r?.at }), fileName: `aspire_comment_themes_${slug}_${timepoint}.csv` }
}

// ── The daily cron ───────────────────────────────────────────────────────────────

const AWAITING = new Set(['pending', 'invited', 'sent', 'opened'])
const awaiting = (a, now) => AWAITING.has(a.status) && !a.revoked_at && (!a.expires_at || new Date(a.expires_at).getTime() > now)

/** Timepoints with nothing still awaiting get themes (or fresh ones, if unedited and comments grew). */
export async function autoRun(db, { complete, now = Date.now() } = {}) {
  const skill = await loadSkill(db, SKILL_KEY).catch(() => null)
  if (skillMode(skill) === 'off') return { ran: 0, mode: 'off' }
  const instruments = await rows(db.from('evaluation_instruments').select('id, slug').in('slug', INSTRUMENTS), 'Instruments')
  const slugOf = new Map(instruments.map(i => [i.id, i.slug]))
  const since = new Date(now - 180 * 86400000).toISOString()
  const list = await rows(db.from('evaluation_assignments').select('id, cohort_id, instrument_id, timepoint, status, expires_at, revoked_at, sent_at').in('instrument_id', instruments.map(i => i.id)).gte('sent_at', since), 'Assignments')
  const groups = new Map()
  for (const a of list) {
    const k = `${a.cohort_id}|${slugOf.get(a.instrument_id)}|${a.timepoint}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(a)
  }
  let ran = 0
  const out = []
  for (const [k, as] of groups) {
    if (ran >= AUTO_PER_RUN) break
    if (as.some(a => awaiting(a, now)) || !as.some(a => a.status === 'completed')) continue
    const [cohortId, slug, timepoint] = k.split('|')
    const comments = await loadComments(db, { cohortId, slug, timepoint })
    if (!comments.length) continue
    const v = await latestVersion(db, { cohortId, slug, timepoint })
    if (v && (personEdited(v) || v.comment_count === comments.length)) continue
    try {
      out.push({ key: k, ...(await runThemes(db, { cohortId, slug, timepoint, source: 'auto', complete })) })
      ran += 1
    } catch (e) { out.push({ key: k, error: e.code || 'failed' }) }
  }
  return { ran, runs: out }
}

/** For the portal: the real cohorts and instruments with themes, once the skill is ON. */
export async function portalIndex(db) {
  const skill = await loadSkill(db, SKILL_KEY).catch(() => null)
  if (skillMode(skill) !== 'on') return { enabled: true, published: false, cohorts: [] }
  const versions = await rows(db.from('comment_theme_versions').select('cohort_id, instrument_slug, timepoint, created_at'), 'Theme versions')
  const cohortIds = [...new Set(versions.map(v => v.cohort_id))]
  const cohorts = cohortIds.length ? await rows(db.from('cohorts').select('id, name').in('id', cohortIds), 'Cohorts') : []
  return {
    enabled: true, published: true,
    cohorts: cohorts.map(c => ({
      id: c.id, name: c.name,
      items: [...new Map(versions.filter(v => v.cohort_id === c.id).map(v => [`${v.instrument_slug}|${v.timepoint}`, { slug: v.instrument_slug, timepoint: v.timepoint }])).values()],
    })),
  }
}
