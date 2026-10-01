// KEITH-KNOWLEDGE-SELFCHECK-1: the questions Keith's Knowledge Center did not cover.
//
// When a program question finds no Active entry, Keith keeps a SCRUBBED copy of it so his self-check
// (the 1st and 15th of each month, and on demand) can propose the missing entry (Owner, 2026-09-30).
// "No Active entry" is decided two ways (KEITH-GAP-DETECT-1, 2026-09-30): retrieval matched nothing,
// OR Keith's own answer says governed guidance was not found. The second is the common case:
// retrieval scores shared words, so "students", "unit" and "policy" qualify entries that say nothing
// about laptops, and only the model reading them knows they do not answer the question. His
// instructions already tell him to say "governed guidance was not found"; ANSWER_SAYS_NOT_FOUND reads
// that sentence and its usual variants. The rules, all enforced here:
//   - only a program question: intent policy_process or general_other. A question about live
//     records (cohort status, placements, contacts) is answered from the database, and a drafting
//     request is not a knowledge question, so neither is ever kept;
//   - only from a real session; a demo session keeps nothing;
//   - scrubbed before it is written: emails and phone numbers become [email] / [phone], and every
//     person's name ASPIRE knows (students, preceptors, staff, contacts) becomes [name], through the
//     de-identification comment themes uses. Unit names stay: they identify no one, and "dress code
//     on 6NE" is only useful with its unit. A question that is mostly names is dropped, not kept;
//   - kept 90 days (the table's expires_at), and anything past it is deleted on the next write.
// Recording is best-effort: a failure is logged and never reaches the person asking.

import { nameList, deidentify } from '../../../src/lib/evaluation/commentThemesModel.js'

export const GAP_INTENTS = Object.freeze(['policy_process', 'general_other'])
export const MAX_QUESTION_CHARS = 500
const MIN_QUESTION_CHARS = 8

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g

// A negation shortly before "governed guidance/entry/source", or one shortly after it ("governed
// guidance was not found"), or "not covered in the Knowledge Center". Bounded to one sentence ([^.]),
// so "the governed guidance says no laptops" is not a miss.
const ANSWER_SAYS_NOT_FOUND = new RegExp([
  String.raw`\b(?:no|not|don['’]t|do not|doesn['’]t|does not|couldn['’]t|could not|can['’]t|cannot|wasn['’]t|without|lack)\b[^.\n]{0,40}\bgoverned (?:guidance|entr(?:y|ies)|sources?)\b`,
  String.raw`\bgoverned (?:guidance|entr(?:y|ies)|sources?)\b[^.\n]{0,30}\b(?:was|were|is|are)(?: not|n['’]t) (?:found|available)`,
  String.raw`\b(?:not|isn['’]t|aren['’]t) (?:covered|found|addressed) (?:in|by) (?:the |any )?(?:ASPIRE )?Knowledge Center\b`,
].join('|'), 'i')

/** Does Keith's answer say his Knowledge Center did not cover the question? Pure. */
export function answerSaysNotFound(answer) {
  return ANSWER_SAYS_NOT_FOUND.test(String(answer || ''))
}

/** Could this chat turn's question be kept, before the answer is known? Pure. */
export function isGapCandidate({ intent, governed, isDemo, question }) {
  if (isDemo) return false
  if (!GAP_INTENTS.includes(intent)) return false
  if (!governed || governed.error) return false
  return String(question || '').trim().length >= MIN_QUESTION_CHARS
}

/** Should it be kept, now that the answer is known? Pure. */
export function shouldRecordGap({ intent, governed, isDemo, question, answer }) {
  if (!isGapCandidate({ intent, governed, isDemo, question })) return false
  return !governed.governedCovered || answerSaysNotFound(answer)
}

/** { ok, text }: the question with contact details and known names removed, or ok=false. Pure. */
export function scrubQuestion(question, names) {
  const plain = String(question || '').replace(/\s+/g, ' ').trim()
    .replace(EMAIL, '[email]').replace(PHONE, '[phone]')
  const d = deidentify(plain, names || {})
  if (!d.ok || !d.text) return { ok: false, text: '' }
  return { ok: true, text: d.text.slice(0, MAX_QUESTION_CHARS) }
}

async function knownNames(db) {
  const read = async (q) => { const { data } = await q; return data || [] }
  const [students, preceptors, staff, contacts] = await Promise.all([
    read(db.from('students').select('first_name, last_name, preferred_first_name')),
    read(db.from('preceptors').select('full_name')),
    read(db.from('user_profiles').select('full_name')),
    read(db.from('contacts').select('full_name')),
  ])
  return nameList({ students, preceptors, staff: [...staff, ...contacts] })
}

/**
 * Keep one scrubbed question. `db` is a service-role client. Returns { recorded, reason } and never
 * throws. A missing table (before the migration) reads as not recorded.
 */
export async function recordKnowledgeGap(db, { question, intent, governed, role }) {
  try {
    const scrubbed = scrubQuestion(question, await knownNames(db))
    if (!scrubbed.ok) return { recorded: false, reason: 'not_safe_to_keep' }
    const topScore = governed?.scores?.length ? Math.max(...governed.scores) : null
    const { error } = await db.from('keith_knowledge_gaps').insert({
      question: scrubbed.text, intent, top_score: topScore, asked_role: role || null,
    })
    if (error) return { recorded: false, reason: ['42P01', 'PGRST205'].includes(error.code) ? 'not_enabled' : 'insert_failed' }
    await db.from('keith_knowledge_gaps').delete().lt('expires_at', new Date().toISOString())
    return { recorded: true }
  } catch (e) {
    return { recorded: false, reason: 'threw' }
  }
}
