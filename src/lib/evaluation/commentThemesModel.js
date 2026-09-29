// src/lib/evaluation/commentThemesModel.js
//
// KEITH-THEMES-1 (2026-09-29): the rules for Keith's comment themes on Evaluation > Responses, pure and
// shared by the server (lib/server/evaluation/commentThemes.js) and the browser.
//
//   COMMENT_FIELDS   which free-text answers are comments, per instrument (Owner, 2026-09-29: every
//                    comment field EXCEPT the preceptor's confidential comments, never themed or quoted)
//   extractComments  one comment per (response, field), with the response's consent to be quoted
//   normalizeThemes  Keith's output held to the rules: every comment in at most one theme, examples
//                    drawn only from the theme's own comments, names of five words or fewer
//   leadershipCut    what leadership sees: the privacy floor (a theme under it folds into Other and
//                    says why), quotes only with consent and only once de-identified, no links
//   deidentify       every name ASPIRE knows, removed from a quote; a quote that still carries an
//                    email or phone number, or loses too much, is left out and only counted
//
// CONSENT (Owner, 2026-09-29): only Student's Feedback on ASPIRE asks "May ASPIRE use anonymized
// comments…". Every comment counts toward themes; leadership and the export quote only a response
// that answered yes. The other instruments ask nothing, so leadership sees their counts, not quotes.

export const INSTRUMENTS = Object.freeze(['casey_fink_readiness_2024', 'preceptor_progress', 'student_preceptor_eval', 'post_rotation_evaluation'])
export const CONSENT_INSTRUMENT = 'post_rotation_evaluation'
export const DEFAULT_PRIVACY_FLOOR = 3
const get = (o, path) => path.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o)

/** The comment fields of each instrument, in the order they are asked. Labels are ASPIRE's own words. */
export const COMMENT_FIELDS = Object.freeze({
  // Casey-Fink's wording is licensed: a generic label, never the instrument's own.
  casey_fink_readiness_2024: [{ key: 'S4_COMMENT', label: 'Additional comments' }],
  preceptor_progress: [
    { key: 'developmental_feedback.competency.*.comment', label: 'Examples supporting a competency rating' },
    { key: 'developmental_feedback.narrative.strengths_observed', label: 'Strengths observed' },
    { key: 'developmental_feedback.narrative.areas_for_development', label: 'Areas for development or coaching' },
    { key: 'developmental_feedback.narrative.suggested_support_plan', label: 'Suggested support plan' },
    { key: 'readiness_endorsement.endorsement_explanation', label: 'Endorsement explanation' },
    { key: 'readiness_endorsement.best_fit_environment', label: 'Best-fit environment' },
    // confidential_team_comments.confidential_comments: EXCLUDED by the Owner. Never read here.
  ],
  student_preceptor_eval: [
    { key: 'preceptor_support.preceptor_support_comment', label: 'Preceptor support' },
    { key: 'learning_environment.learning_environment_comment', label: 'Learning environment' },
    { key: 'narrative.strengths', label: 'What worked well' },
    { key: 'narrative.suggestions', label: 'What could improve' },
    { key: 'narrative.open_comment', label: 'Additional comments' },
  ],
  post_rotation_evaluation: [
    { key: 'most_valuable_part', label: 'Most valuable part of ASPIRE' },
    { key: 'improved_skills_behaviors_learning', label: 'Skills and behaviours that improved' },
    { key: 'improve_learning_experience', label: 'What could improve the learning experience' },
    { key: 'support_for_interview_or_transition', label: 'Support for the interview or transition' },
    { key: 'final_reflection', label: 'What ASPIRE leaders should know' },
  ],
})

export const qualifies = (slug) => (COMMENT_FIELDS[slug] || []).length > 0

const MIN_CHARS = 3
const responseOf = (a) => {
  const r = Array.isArray(a?.evaluation_responses) ? a.evaluation_responses[0] : a?.evaluation_responses
  return r && r.submitted_at ? r : null
}

/**
 * Every comment on a set of assignments of one instrument: { ref: `${assignmentId}|${field}`,
 * assignmentId, studentId, field, label, text, consent } where consent is true or false for the
 * ASPIRE feedback and null for instruments that do not ask.
 */
export function extractComments(slug, assignments) {
  const out = []
  for (const a of assignments || []) {
    const resp = responseOf(a)
    if (!resp?.responses) continue
    const answers = resp.responses
    const consent = slug === CONSENT_INSTRUMENT ? answers.may_use_anonymized_comments === true : null
    for (const f of COMMENT_FIELDS[slug] || []) {
      const hits = f.key.includes('.*.')
        ? Object.entries(get(answers, f.key.split('.*.')[0]) || {}).map(([code, v]) => [f.key.replace('*', code), v?.[f.key.split('.*.')[1]]])
        : [[f.key, get(answers, f.key)]]
      for (const [field, v] of hits) {
        const text = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
        if (text.length < MIN_CHARS) continue
        out.push({ ref: `${a.id}|${field}`, assignmentId: a.id, studentId: a.student_id || a.students?.id || null, field, label: f.label, text, consent })
      }
    }
  }
  return out.sort((x, y) => (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0))
}

/** Opaque ids for Keith: c1, c2, ... in a stable order. Returns { ids: Map(id -> comment), forKeith }. */
export function opaqueIds(comments, maxChars = 600) {
  const ids = new Map()
  const forKeith = comments.map((c, i) => {
    const id = `c${i + 1}`
    ids.set(id, c)
    return { id, text: c.text.slice(0, maxChars) }
  })
  return { ids, forKeith }
}

const words = (s) => String(s || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)

/** Keith's output held to the rules. Unknown ids are dropped; a comment in two themes keeps the first. */
export function normalizeThemes(json, knownIds) {
  const known = new Set(knownIds)
  const used = new Set()
  const themes = []
  for (const t of Array.isArray(json?.themes) ? json.themes : []) {
    const ids = (Array.isArray(t?.comment_ids) ? t.comment_ids : []).map(String).filter(id => known.has(id) && !used.has(id))
    if (!ids.length) continue
    ids.forEach(id => used.add(id))
    const name = words(t.name).slice(0, 5).join(' ') || 'Theme'
    const examples = (Array.isArray(t?.example_ids) ? t.example_ids : []).map(String).filter(id => ids.includes(id)).slice(0, 3)
    themes.push({ name, comment_ids: ids, example_ids: examples.length ? examples : ids.slice(0, 2), reason: String(t?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300) })
  }
  const unthemed = [...known].filter(id => !used.has(id))
  return { themes, unthemed_ids: unthemed }
}

// ── De-identification ────────────────────────────────────────────────────────────

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The names a quote must not carry, from ASPIRE's own records: { people: [...], units: [...] }.
 * People are split into their words (a first name alone identifies in a cohort of forty); words
 * under three letters are skipped so "Al" does not eat "all".
 */
export function nameList({ students = [], preceptors = [], staff = [], units = [] }) {
  const people = new Set()
  const add = (s) => { for (const w of String(s || '').split(/[\s,.'’-]+/)) if (w.length >= 3) people.add(w) }
  for (const s of students) { add(s.first_name); add(s.last_name); add(s.preferred_first_name) }
  for (const p of preceptors) add(p.full_name)
  for (const p of staff) add(p.full_name)
  const unitNames = new Set(units.map(u => String(u.unit_name || '').trim()).filter(n => n.length >= 2))
  return { people: [...people], units: [...unitNames].sort((a, b) => b.length - a.length) }
}

/** { ok, text }: the quote with every known name removed, or ok=false when it cannot be made safe. */
export function deidentify(text, names) {
  let out = String(text || '')
  const before = words(out).length || 1
  let removed = 0
  for (const u of names.units || []) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(u)}(?![A-Za-z0-9])`, 'gi')
    out = out.replace(re, (m, pre) => { removed += words(u).length; return `${pre}[unit]` })
  }
  if (names.people?.length) {
    // Case-sensitive on the capitalized (and all-caps) form: a name is written with a capital, and
    // matching "will" or "grace" in lower case would strip ordinary words.
    const forms = new Set()
    for (const n of names.people) { const cap = n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); forms.add(cap); forms.add(n.toUpperCase()); forms.add(n) }
    const re = new RegExp(`\\b(${[...forms].map(escapeRe).join('|')})\\b`, 'g')
    out = out.replace(re, () => { removed += 1; return '[name]' })
  }
  out = out.replace(/(\[name\]\s*){2,}/g, '[name] ')
  if (EMAIL.test(out) || PHONE.test(out)) return { ok: false, text: '' }
  if (removed / before > 0.3) return { ok: false, text: '' }
  return { ok: true, text: out.trim() }
}

// ── What leadership sees ─────────────────────────────────────────────────────────

/**
 * The leadership cut of one version. `themes` are live rows ({ id, name, comment_ids, example_ids,
 * reason, state }); `commentsById` maps an opaque id to its comment (with consent). Returns
 * { total, themes: [{ name, count, share, quotes: [text], quotesWithheld }], other: { count,
 * folded: [names…], pending, note }, note }.
 *
 * REVIEWED-THEMES-1 (Owner, 2026-09-29): only a theme a person has ACCEPTED reaches leadership. Pass
 * the accepted themes as `themes`; the comments in themes still awaiting review are counted in
 * Other (never quoted, never named) and `pending` says how many, so the totals still add up.
 */
export function leadershipCut({ themes, commentsById, total, floor = DEFAULT_PRIVACY_FLOOR, names, pending = 0 }) {
  const shown = []
  let otherCount = 0
  const folded = []
  for (const t of [...themes].sort((a, b) => b.comment_ids.length - a.comment_ids.length)) {
    const count = t.comment_ids.length
    if (count < floor) { otherCount += count; folded.push(t.name); continue }
    const quotes = []
    let withheld = 0
    for (const id of t.example_ids) {
      const c = commentsById.get(id)
      if (!c || c.consent !== true) { withheld += 1; continue }
      const d = deidentify(c.text, names)
      if (d.ok) quotes.push(d.text)
      else withheld += 1
    }
    shown.push({ name: t.name, count, share: total ? count / total : 0, quotes, quotesWithheld: withheld })
  }
  const unthemed = total - themes.reduce((a, t) => a + t.comment_ids.length, 0)
  otherCount += Math.max(0, unthemed)
  const notes = []
  if (folded.length) notes.push(`Themes with fewer than ${floor} comments are folded into Other so no comment can be traced to a person.`)
  if (pending > 0) notes.push(`${pending} ${pending === 1 ? 'comment is' : 'comments are'} in themes the ASPIRE team has not reviewed yet.`)
  return {
    total,
    themes: shown,
    other: {
      count: otherCount,
      folded,
      pending,
      note: notes.join(' '),
    },
    note: 'Quotes appear only where the student agreed to share anonymized comments, with names removed.',
  }
}

/** A theme's display share: "12 of 40". */
export const shareText = (n, total) => `${n} of ${total}`

/** The export table's rows, from a leadership cut. */
export function exportRows(cut) {
  const rows = cut.themes.map(t => ({ theme: t.name, count: t.count, share: `${Math.round(t.share * 100)}%`, quotes: t.quotes.join(' | ') }))
  if (cut.other.count) rows.push({ theme: 'Other', count: cut.other.count, share: `${Math.round((cut.other.count / (cut.total || 1)) * 100)}%`, quotes: '' })
  return rows
}

const csvCell = (v) => {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`          // never a formula in a spreadsheet
  return `"${s.replace(/"/g, '""')}"`
}

/** The export: theme, count, share, example quotes, then the review line. */
export function exportCsv(cut, { instrumentName, timepointLabel, reviewer, reviewedAt }) {
  const lines = [
    ['Theme', 'Count', 'Share of comments', 'Example quotes (de-identified)'].map(csvCell).join(','),
    ...exportRows(cut).map(r => [r.theme, r.count, r.share, r.quotes].map(csvCell).join(',')),
    '',
    csvCell(`${instrumentName}${timepointLabel ? `, ${timepointLabel}` : ''}: ${cut.total} comments.`),
    csvCell(reviewer ? `Themes generated by Keith and reviewed by ${reviewer} on ${reviewedAt}.` : 'Themes generated by Keith. Not yet reviewed by a person.'),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
