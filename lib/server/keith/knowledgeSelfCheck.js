// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 2: one Knowledge Center self-check, start to finish.
//
//   1. the window: from where the last finished check stopped (keith_knowledge_checks.changes_until),
//      or FIRST_CHECK_DAYS back on the first run;
//   2. what Keith reads: the app's commits in that window (appChanges.js), the Active and Draft
//      entries, and the scrubbed questions he could not answer that have not expired;
//   3. triage (one model call): what is outdated or missing, each with its evidence;
//   4. one draft per finding, DRAFT_CONCURRENCY at a time inside the time budget: an edit to an
//      Active entry goes to knowledge_revisions (proposed_by 'keith'), a missing topic becomes a Draft
//      entry (proposed_by 'keith'), each carrying its evidence and credited to the Owner who reviews it;
//   5. the questions that fed a suggestion are deleted (Owner, 2026-09-30); the run is recorded.
//
// Nothing here makes anything live: a revision waits for Apply, a Draft for Activate. An entry that
// already has a pending revision, human or Keith, is skipped (no-clobber, as enrichment). With nothing
// new to read, no model is called. Every model call goes through runKeithSkill, so the skill's on/off
// switch, metering and provenance apply. The pure parts are in knowledgeSelfCheckModel.js.

import { runKeithSkill, loadSkill } from './runKeithSkill.js'
import { skillMode } from '../../../src/lib/keith/provenanceModel.js'
import { fetchAppChanges } from './appChanges.js'
import { nextAvailableSlug, slugify } from './knowledgeSlugs.js'
import { toPacificDateStr } from '../../../shared/dateUtils.js'
import {
  buildTriage, buildDraftMessage, validateUpdate, validateNewEntry, evidenceOf, MAX_FINDINGS,
} from './knowledgeSelfCheckModel.js'

export const SKILL_KEY = 'knowledge-self-check'
export const DRAFT_KEY = 'knowledge-self-check-draft'
export const FIRST_CHECK_DAYS = 30
export const DRAFT_CONCURRENCY = 4
// Vercel stops the function at 300s; no draft starts once this much of the run has gone.
export const RUN_BUDGET_MS = 200000
export const STALE_RUN_MS = 15 * 60 * 1000
const ENTRY_COLS = 'id, title, slug, category, state, body, body_format, aliases, tags, review_date, confidence, source_attribution, precedence_rank, proposed_by'
const missingTable = (e) => ['42P01', 'PGRST205', '42703'].includes(e?.code)

const fail = (reason, message, status = 409) => ({ ok: false, reason, message, status })

/** The finished checks, newest first (for the Knowledge Center and the next check's window). */
export async function listChecks(db, limit = 5) {
  const { data, error } = await db.from('keith_knowledge_checks').select('*').order('started_at', { ascending: false }).limit(limit)
  if (error) return { ok: false, notEnabled: missingTable(error) }
  return { ok: true, checks: data || [] }
}

async function ownerProfile(db, actor) {
  if (actor?.is_owner === true && actor.id) return actor
  const { data } = await db.from('user_profiles').select('id, full_name, role, is_owner').eq('is_owner', true).limit(1)
  return data?.[0] || null
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

/**
 * Run one check. `actor` is the Owner's profile for "Check now", null for the schedule. Test seams:
 * `now`, `fetchChanges`, `complete` (the model), `budgetMs`. Returns { ok: true, check } or
 * { ok: false, reason, message, status }.
 */
export async function runKnowledgeSelfCheck(db, { actor = null, trigger = 'manual', now = new Date(), fetchChanges = fetchAppChanges, complete, budgetMs = RUN_BUDGET_MS } = {}) {
  const started = Date.now()
  const skill = await loadSkill(db, SKILL_KEY).catch(() => null)
  if (!skill) return fail('not_enabled', 'The Knowledge Center check needs its database update before it can run.')
  if (skillMode(skill) === 'off') return fail('off', 'Keith’s Knowledge Self-Check skill is off. Turn it on in Settings > Keith > Skills.')

  const prior = await listChecks(db, 10)
  if (!prior.ok) return fail('not_enabled', 'The Knowledge Center check needs its database update before it can run.')
  const running = prior.checks.find(c => c.status === 'running' && now.getTime() - new Date(c.started_at).getTime() < STALE_RUN_MS)
  if (running) return fail('already_running', 'A check is already running. It takes a minute or two.')
  const owner = await ownerProfile(db, actor)
  if (!owner) return fail('no_owner', 'No Owner profile was found to credit the suggestions to.', 500)

  const lastDone = prior.checks.find(c => c.status === 'done' && c.changes_until)
  const since = lastDone ? new Date(lastDone.changes_until) : new Date(now.getTime() - FIRST_CHECK_DAYS * 86400000)
  const { data: runRows, error: runErr } = await db.from('keith_knowledge_checks')
    .insert({ trigger, run_by: actor?.id || null, changes_since: since.toISOString(), status: 'running' }).select('*')
  if (runErr || !runRows?.[0]) return fail('not_enabled', 'The Knowledge Center check could not start.', 500)
  const run = runRows[0]
  const finish = async (patch) => {
    const row = { ...patch, finished_at: new Date().toISOString() }
    await db.from('keith_knowledge_checks').update(row).eq('id', run.id)
    return { ...run, ...row }
  }

  try {
    const history = await fetchChanges({ since })
    if (!history.ok) return { ok: false, reason: 'history_unavailable', status: 502, message: 'The app’s change history could not be read from GitHub. Try again later.', check: await finish({ status: 'failed', error: `github: ${history.error}` }) }
    const changes = history.commits
    const [{ data: entries, error: eErr }, { data: pending }, { data: gaps }] = await Promise.all([
      db.from('knowledge_entries').select(ENTRY_COLS).in('state', ['active', 'draft']),
      db.from('knowledge_revisions').select('entry_id'),
      db.from('keith_knowledge_gaps').select('id, question, created_at').gte('expires_at', now.toISOString()),
    ])
    if (eErr) throw new Error('entries_unreadable')
    const catalog = entries || []
    const questions = gaps || []
    // GitHub's `since` is inclusive: the next window starts a second after the newest commit read.
    const newest = changes.reduce((m, c) => (c.date && c.date > m ? c.date : m), '')
    const until = newest ? new Date(new Date(newest).getTime() + 1000).toISOString() : since.toISOString()
    const counts = { changes_read: changes.length, questions_read: questions.length, entries_read: catalog.filter(e => e.state === 'active').length, changes_until: until }

    if (!changes.length && !questions.length) {
      return { ok: true, check: await finish({ status: 'done', ...counts }) }
    }

    let inputTokens = 0, outputTokens = 0, model = null
    const tally = (r) => { if (r?.usage) { inputTokens += r.usage.inputTokens || 0; outputTokens += r.usage.outputTokens || 0 } if (r?.model) model = r.model }

    const { message, refs } = buildTriage({ today: toPacificDateStr(now), entries: catalog, changes, questions })
    const provRefs = [...questions.map(q => ({ type: 'unanswered_question', id: q.id })), ...catalog.map(e => ({ type: 'knowledge_entry', id: e.id }))]
    const context = { actor, system: !actor, complete, invocationMode: 'knowledge_check' }
    const triage = await runKeithSkill(db, SKILL_KEY, { triage: { value: message, refs: provRefs, map: refs } }, { ...context, entity: { id: run.id, field: 'findings' } })
    tally(triage)
    if (!triage.ok) {
      return { ok: false, reason: triage.reason, status: triage.status || 502, message: triage.message || 'Keith could not finish the check. Try again.', check: await finish({ status: 'failed', error: `triage: ${triage.reason}`, ...counts, input_tokens: inputTokens, output_tokens: outputTokens, model }) }
    }

    // Rehydrate the findings (the parse kept ids only) and decide what to draft.
    const byEntry = new Map(catalog.map(e => [e.id, e]))
    const bySha = new Map(changes.map(c => [c.sha, c]))
    const byQuestion = new Map(questions.map(q => [q.id, q]))
    const pendingIds = new Set((pending || []).map(r => r.entry_id))
    const findings = triage.output.findings.slice(0, MAX_FINDINGS).map(f => ({
      kind: f.kind, title: f.title, reason: f.reason, confidence: f.confidence,
      entry: f.entry_id ? byEntry.get(f.entry_id) : null,
      changes: f.change_shas.map(s => bySha.get(s)).filter(Boolean),
      questions: f.question_ids.map(id => byQuestion.get(id)).filter(Boolean),
    }))

    const skipped = []
    const record = []
    const jobs = []
    for (const f of findings) {
      const summary = { kind: f.kind, title: f.title, reason: f.reason, confidence: f.confidence, entry_id: f.entry?.id || null, changes: f.changes.map(c => c.sha), questions: f.questions.length }
      if (f.kind === 'outdated' && pendingIds.has(f.entry.id)) { skipped.push({ title: f.title, reason: 'pending_revision' }); record.push({ ...summary, outcome: 'skipped: a revision is already waiting' }); continue }
      jobs.push({ f, summary })
    }

    let suggestions = 0, drafts = 0
    const usedQuestions = new Set()
    await mapLimit(jobs, DRAFT_CONCURRENCY, async ({ f, summary }) => {
      if (Date.now() - started > budgetMs) { skipped.push({ title: f.title, reason: 'out_of_time' }); record.push({ ...summary, outcome: 'skipped: out of time, next check' }); return }
      const input = { proposal_request: { value: buildDraftMessage({ finding: f, catalog }), refs: [...(f.entry ? [{ type: 'knowledge_entry', id: f.entry.id }] : []), ...f.questions.map(q => ({ type: 'unanswered_question', id: q.id }))] } }
      const res = await runKeithSkill(db, DRAFT_KEY, input, { ...context, entity: { id: f.entry?.id || run.id, field: 'proposal' } })
      tally(res)
      if (!res.ok) { skipped.push({ title: f.title, reason: `model: ${res.reason}` }); record.push({ ...summary, outcome: 'skipped: Keith could not draft it' }); return }
      const evidence = evidenceOf({ runId: run.id, finding: f, provenanceId: res.provenanceId || null })
      if (f.kind === 'outdated') {
        const g = validateUpdate({ finding: f, proposal: res.output, catalog })
        if (!g.ok) { skipped.push({ title: f.title, reason: g.reason, detail: g.detail }); record.push({ ...summary, outcome: `skipped: ${g.reason}` }); return }
        const e = f.entry
        const { error } = await db.from('knowledge_revisions').insert({
          entry_id: e.id, title: e.title, category: e.category, body: g.body, source_attribution: e.source_attribution || '',
          precedence_rank: e.precedence_rank ?? 100, change_note: g.changeNote, author_id: owner.id, submitted_at: new Date().toISOString(),
          body_format: 'markdown', aliases: e.aliases || [], tags: e.tags || [], review_date: e.review_date || null, confidence: e.confidence || null,
          proposed_by: 'keith', evidence,
        })
        if (error) { skipped.push({ title: f.title, reason: error.code === '23505' ? 'pending_revision' : 'insert_failed' }); record.push({ ...summary, outcome: 'skipped: could not be saved' }); return }
        suggestions++
      } else {
        const g = validateNewEntry({ finding: f, proposal: res.output, catalog })
        if (!g.ok) { skipped.push({ title: f.title, reason: g.reason, detail: g.detail }); record.push({ ...summary, outcome: `skipped: ${g.reason}` }); return }
        const slug = await nextAvailableSlug(db, slugify(g.title))
        if (slug.error) { skipped.push({ title: f.title, reason: 'slug_failed' }); record.push({ ...summary, outcome: 'skipped: could not be saved' }); return }
        const { error } = await db.from('knowledge_entries').insert({
          title: g.title, slug: slug.slug, category: g.category, body: g.body,
          source_attribution: `Proposed by Keith's Knowledge Center check, ${toPacificDateStr(now)}. ${g.changeNote}`.slice(0, 2000),
          precedence_rank: 100, state: 'draft', created_by: owner.id, updated_by: owner.id, body_format: 'markdown',
          aliases: g.aliases, tags: g.tags, confidence: 'provisional', proposed_by: 'keith', proposal_evidence: evidence,
        })
        if (error) { skipped.push({ title: f.title, reason: error.code === '23505' ? 'slug_taken' : 'insert_failed' }); record.push({ ...summary, outcome: 'skipped: could not be saved' }); return }
        drafts++
      }
      f.questions.forEach(q => usedQuestions.add(q.id))
      record.push({ ...summary, outcome: f.kind === 'outdated' ? 'suggested an edit' : 'wrote a Draft' })
    })

    // A question that fed a suggestion has done its job (Owner, 2026-09-30).
    if (usedQuestions.size) await db.from('keith_knowledge_gaps').delete().in('id', [...usedQuestions])

    const check = await finish({
      status: 'done', ...counts, findings: record, suggestions, drafts, skipped,
      input_tokens: inputTokens, output_tokens: outputTokens, model,
    })
    await db.from('activity_logs').insert({
      user_id: actor?.id || null, user_name: actor?.full_name || 'Keith (scheduled)', user_role: actor ? 'owner' : 'system',
      action_type: 'knowledge_self_check', entity_type: 'keith_knowledge_check', entity_id: run.id,
      description: `Keith checked the Knowledge Center: ${suggestions} edit${suggestions === 1 ? '' : 's'} and ${drafts} Draft${drafts === 1 ? '' : 's'} proposed`,
      metadata: { check_id: run.id, trigger, changes_read: counts.changes_read, questions_read: counts.questions_read, suggestions, drafts, skipped: skipped.length },
    }).then(() => {}, () => {})
    return { ok: true, check }
  } catch (e) {
    return { ok: false, reason: 'failed', status: 500, message: 'Keith could not finish the check. Try again.', check: await finish({ status: 'failed', error: String(e?.message || e).slice(0, 300) }) }
  }
}
