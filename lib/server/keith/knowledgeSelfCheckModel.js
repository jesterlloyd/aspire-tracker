// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 2: the pure core of Keith's Knowledge Center self-check.
//
// Prompt construction, the parse of Keith's triage, and the gates a proposed edit or Draft must clear.
// No I/O here: lib/server/keith/knowledgeSelfCheck.js reads and writes; everything that can be wrong
// with what the model returned is decided here, under test.
//
// The gates follow enrichment's (lib/server/keith/knowledgeEnrichment.js) where they apply, and differ
// where an UPDATE legitimately differs from a reformat:
//   - governed rails (Keith Guidance, boundary sentences) must survive, exactly as in enrichment;
//   - links must resolve against the real catalog, or are unwrapped to plain text;
//   - numbers MAY change (that is often the point of an update), so a changed number never fails the
//     edit: every number removed or added is listed in the change note for the Owner to check;
//   - the length band is wider than a reformat's (0.5x to 2x), because an update can add a section.

import { ENRICH_CAPS, normalizeTerms, missingGovernedContent, missingNumbers } from './knowledgeEnrichment.js'
import { resolveBodyLinks, LINK_STATUS } from './knowledgeLinks.js'

export const MAX_FINDINGS = 10
// 1,500 hid the second half of most entries (the navigation entry's Settings list and its retired terms
// sit past it). 6,000 shows 24 of the Owner's 28 entries whole, for about 17,000 more input tokens a check.
export const EXCERPT_CHARS = 6000
export const MAX_TRIAGE_CHANGES = 800
export const UPDATE_LENGTH_RATIO = Object.freeze({ min: 0.5, max: 2.0 })
export const KNOWLEDGE_CATEGORIES = Object.freeze([
  'program_overview', 'eligibility_placement', 'interview_selection', 'rotations_matching',
  'student_requirements', 'communication_guidance', 'terminology_navigation', 'faq',
])
const CONFIDENCE = ['high', 'medium', 'low']

const oneLine = (s, max) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
const firstLine = (body) => String(body || '').split(/\n\s*\n|\n/).map(l => l.trim()).find(Boolean) || ''
const day = (d) => (d ? String(d).slice(0, 10) : 'undated')

// ── Triage ───────────────────────────────────────────────────────────────────────

/**
 * Give every entry, change and question a short id (e1, c1, q1) and build the triage message. The ids
 * are what Keith cites; refs maps them back. Only ACTIVE entries can be flagged; Drafts are listed by
 * title so Keith does not propose a topic a Draft already covers.
 */
export function buildTriage({ today, entries, changes, questions }) {
  const active = entries.filter(e => e.state === 'active')
  const drafts = entries.filter(e => e.state === 'draft')
  const shownChanges = changes.slice(0, MAX_TRIAGE_CHANGES)
  const refs = { entries: new Map(), changes: new Map(), questions: new Map() }
  active.forEach((e, i) => refs.entries.set(`e${i + 1}`, e))
  shownChanges.forEach((c, i) => refs.changes.set(`c${i + 1}`, c))
  questions.forEach((q, i) => refs.questions.set(`q${i + 1}`, q))

  const lines = ['TASK: TRIAGE', `Today is ${today}.`, '']
  lines.push(`APP CHANGES SINCE THE LAST CHECK (${changes.length}, newest first${changes.length > shownChanges.length ? `; the newest ${shownChanges.length} are listed` : ''})`)
  if (!shownChanges.length) lines.push('(none)')
  for (const [ref, c] of refs.changes) {
    const note = oneLine(firstLine(c.body), 200)
    lines.push(`[${ref}] ${day(c.date)} · ${oneLine(c.subject, 160)}${note ? ` :: ${note}` : ''}`)
  }
  lines.push('', `QUESTIONS KEITH COULD NOT ANSWER (${questions.length}, scrubbed)`)
  if (!questions.length) lines.push('(none)')
  for (const [ref, q] of refs.questions) lines.push(`[${ref}] ${day(q.created_at)} · ${oneLine(q.question, 500)}`)
  lines.push('', `DRAFT ENTRIES ALREADY WAITING (${drafts.length})`)
  if (!drafts.length) lines.push('(none)')
  for (const d of drafts) lines.push(`- ${oneLine(d.title, 160)}`)
  lines.push('', `KNOWLEDGE CENTER: ACTIVE ENTRIES (${active.length})`)
  for (const [ref, e] of refs.entries) {
    const body = String(e.body || '').trim()
    lines.push(`[${ref}] ${oneLine(e.title, 160)} · ${e.category} · review ${e.review_date ? day(e.review_date) : 'none'}`)
    lines.push(body.length > EXCERPT_CHARS ? `${body.slice(0, EXCERPT_CHARS).trimEnd()} …(continues)` : body || '(empty)')
    lines.push('')
  }
  return { message: lines.join('\n').trim(), refs }
}

/**
 * Keith's findings, held to what he was shown: known ids only, an Active entry for "outdated", none
 * for "missing", at least one piece of evidence, one finding per entry, at most MAX_FINDINGS.
 */
export function parseFindings(json, refs) {
  const out = []
  const seenEntries = new Set()
  const seenTitles = new Set()
  for (const f of Array.isArray(json?.findings) ? json.findings : []) {
    const kind = f?.kind === 'outdated' || f?.kind === 'missing' ? f.kind : null
    if (!kind) continue
    const changes = (Array.isArray(f.changes) ? f.changes : []).map(String).filter(r => refs.changes.has(r)).map(r => refs.changes.get(r))
    const questions = (Array.isArray(f.questions) ? f.questions : []).map(String).filter(r => refs.questions.has(r)).map(r => refs.questions.get(r))
    if (!changes.length && !questions.length) continue
    const reason = oneLine(f.reason, 300)
    if (!reason) continue
    const confidence = CONFIDENCE.includes(f.confidence) ? f.confidence : 'low'
    if (kind === 'outdated') {
      const entry = refs.entries.get(String(f.entry || ''))
      if (!entry || seenEntries.has(entry.id)) continue
      seenEntries.add(entry.id)
      out.push({ kind, entry, title: entry.title, changes, questions, reason, confidence })
    } else {
      const title = oneLine(f.title, 120)
      if (title.length < 3 || seenTitles.has(title.toLowerCase())) continue
      seenTitles.add(title.toLowerCase())
      out.push({ kind, entry: null, title, changes, questions, reason, confidence })
    }
    if (out.length >= MAX_FINDINGS) break
  }
  return out
}

// ── Drafting ─────────────────────────────────────────────────────────────────────

function evidenceLines(finding) {
  const lines = ['WHY IT WAS FLAGGED', finding.reason, '']
  lines.push(`APP CHANGES (${finding.changes.length})`)
  if (!finding.changes.length) lines.push('(none)')
  for (const c of finding.changes) {
    lines.push(`--- ${c.sha} · ${day(c.date)} · ${c.subject}`)
    if (c.body) lines.push(c.body)
  }
  lines.push('', `QUESTIONS KEITH COULD NOT ANSWER (${finding.questions.length})`)
  if (!finding.questions.length) lines.push('(none)')
  for (const q of finding.questions) lines.push(`- ${q.question}`)
  return lines
}

/** The message for one finding: an UPDATE of an Active entry, or a NEW Draft entry. */
export function buildDraftMessage({ finding, catalog }) {
  const titles = catalog.filter(e => !finding.entry || e.id !== finding.entry.id).map(e => `- ${e.title}`)
  if (finding.kind === 'outdated') {
    const e = finding.entry
    return [
      'TASK: UPDATE ENTRY', '',
      ...evidenceLines(finding), '',
      'CATALOG OF EXISTING TITLES (for links only)', ...titles, '',
      'THE ENTRY',
      `title: ${e.title}`,
      `category: ${e.category}`,
      'body:',
      String(e.body || '').trim(),
    ].join('\n')
  }
  return [
    'TASK: NEW ENTRY', '',
    `PROPOSED TITLE: ${finding.title}`, '',
    ...evidenceLines(finding), '',
    `CATEGORIES (use exactly one): ${KNOWLEDGE_CATEGORIES.join(', ')}`, '',
    'CATALOG OF EXISTING TITLES (for links, and so you do not duplicate one)', ...titles,
  ].join('\n')
}

/** Resolve [[links]] against the catalog; anything that does not resolve is unwrapped to plain text. */
function unwrapUnresolved(body, catalog, selfId) {
  let out = body
  let unwrapped = 0
  for (const l of resolveBodyLinks(out, catalog, selfId).filter(l => l.status !== LINK_STATUS.RESOLVED)) {
    const label = l.label || l.target
    const escaped = l.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\[\\[${escaped}\\|[^\\]]*\\]\\]`, 'g'), label).replace(new RegExp(`\\[\\[${escaped}\\]\\]`, 'g'), label)
    unwrapped++
  }
  return { body: out, unwrapped }
}

const flagsOf = (p) => (Array.isArray(p?.flags) ? p.flags : []).map(f => oneLine(f, 300)).filter(Boolean).slice(0, 8)
const sameText = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim()

/** The change note the Owner reads in the revision, version history and Apply. */
export function selfCheckChangeNote({ reason, proposal, numbersRemoved = [], numbersAdded = [], unwrapped = 0, flags = [] }) {
  const parts = [`Keith self-check (Owner-reviewed): ${reason}`]
  const note = oneLine(proposal?.change_note, 600)
  if (note) parts.push(note)
  if (numbersRemoved.length || numbersAdded.length) {
    parts.push(`Numbers to check:${numbersRemoved.length ? ` removed ${numbersRemoved.join(', ')}` : ''}${numbersRemoved.length && numbersAdded.length ? ';' : ''}${numbersAdded.length ? ` added ${numbersAdded.join(', ')}` : ''}.`)
  }
  if (unwrapped) parts.push(`${unwrapped} proposed link(s) did not resolve and were unwrapped to plain text.`)
  if (flags.length) parts.push(`REVIEW FLAGS: ${flags.join(' | ')}`)
  return parts.join(' ').slice(0, ENRICH_CAPS.changeNote)
}

/** Gate a proposed UPDATE. { ok: true, body, changeNote, flags } or { ok: false, reason, detail }. */
export function validateUpdate({ finding, proposal, catalog }) {
  const entry = finding.entry
  const raw = typeof proposal?.body_markdown === 'string' ? proposal.body_markdown.trim() : ''
  if (!raw) return { ok: false, reason: 'unparseable', detail: 'no body_markdown' }
  if (raw.length > ENRICH_CAPS.body) return { ok: false, reason: 'too_long', detail: `${raw.length} chars` }
  if (sameText(raw, entry.body)) return { ok: false, reason: 'no_change', detail: 'the proposal equals the entry' }
  // Governed rails first: losing Keith Guidance is the more serious, and the more useful, reason.
  const governed = missingGovernedContent(entry.body, raw)
  if (governed.sections.length || governed.rules.length) {
    return { ok: false, reason: 'governed_rails_lost', detail: [...governed.sections, ...governed.rules.map(r => `"${r.slice(0, 80)}"`)].slice(0, 3).join('; ') }
  }
  const srcLen = String(entry.body || '').trim().length
  const ratio = srcLen > 0 ? raw.length / srcLen : 1
  if (srcLen > 200 && (ratio < UPDATE_LENGTH_RATIO.min || ratio > UPDATE_LENGTH_RATIO.max)) {
    return { ok: false, reason: 'length_ratio', detail: `${ratio.toFixed(2)}x the entry` }
  }
  const { body, unwrapped } = unwrapUnresolved(raw, catalog, entry.id)
  const flags = flagsOf(proposal)
  return {
    ok: true, body, flags,
    changeNote: selfCheckChangeNote({
      reason: finding.reason, proposal, flags, unwrapped,
      numbersRemoved: missingNumbers(entry.body, body), numbersAdded: missingNumbers(body, entry.body),
    }),
  }
}

/** Gate a proposed NEW Draft entry. { ok: true, title, category, body, aliases, tags, changeNote, flags } or { ok: false, reason, detail }. */
export function validateNewEntry({ finding, proposal, catalog }) {
  const title = oneLine(proposal?.title || finding.title, 200)
  if (title.length < 3) return { ok: false, reason: 'unparseable', detail: 'no title' }
  if (catalog.some(e => String(e.title || '').trim().toLowerCase() === title.toLowerCase())) return { ok: false, reason: 'duplicate_title', detail: title }
  const category = KNOWLEDGE_CATEGORIES.includes(proposal?.category) ? proposal.category : null
  if (!category) return { ok: false, reason: 'bad_category', detail: String(proposal?.category || '') }
  const raw = typeof proposal?.body_markdown === 'string' ? proposal.body_markdown.trim() : ''
  if (!raw) return { ok: false, reason: 'unparseable', detail: 'no body_markdown' }
  if (raw.length > ENRICH_CAPS.body) return { ok: false, reason: 'too_long', detail: `${raw.length} chars` }
  const { body, unwrapped } = unwrapUnresolved(raw, catalog, null)
  const flags = flagsOf(proposal)
  return {
    ok: true, title, category, body, flags,
    aliases: normalizeTerms(proposal?.aliases, ENRICH_CAPS.aliases),
    tags: normalizeTerms(proposal?.tags, ENRICH_CAPS.tags),
    changeNote: selfCheckChangeNote({ reason: finding.reason, proposal, flags, unwrapped }),
  }
}

/** What a suggestion carries as its evidence (knowledge_revisions.evidence / knowledge_entries.proposal_evidence). */
export function evidenceOf({ runId, finding, provenanceId = null }) {
  return {
    run_id: runId,
    provenance_id: provenanceId,
    reason: finding.reason,
    confidence: finding.confidence,
    changes: finding.changes.map(c => ({ sha: c.sha, date: c.date, subject: oneLine(c.subject, 200) })),
    questions: finding.questions.map(q => ({ text: oneLine(q.question, 500), asked: day(q.created_at) })),
  }
}
