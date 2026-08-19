// src/lib/connect/catalogAttachments.js
//
// PLACEMENT-COMMUNICATION-HANDOFF-1 - resolving the documents a template PROMISES
// against the documents the ASPIRE Catalog actually offers.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE. A message may say "please see the
// attached ASPIRE brochure and Pre-Licensure Student General Guidelines" only
// when BOTH files are really selected and really resolvable. Anything less -
// a renamed Catalog entry, a deactivated file, two entries with the same title,
// a Catalog that would not load - is reported as a problem the Owner must see
// BEFORE sending, never smoothed over.
//
// MATCHING IS EXACT-NORMALIZED, NEVER FUZZY. Titles are compared after
// lowercasing, stripping punctuation and collapsing whitespace, so
// "Pre-Licensure Student General Guidelines" and "Pre licensure student general
// guidelines" are the same document while "Guidelines" is not. A write-path
// identity is never guessed - the same discipline schoolIdentity.js uses.
//
// AMBIGUITY IS A FAILURE, NOT A TIE-BREAK. Two Catalog entries normalizing to
// the same title means nobody can say which one was promised, so neither is
// chosen.

/** Normalize a Catalog title for comparison only. Never for display. */
export function normalizeTitle(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[’']/g, '')          // "student's" and "students" compare equal
    .replace(/[^a-z0-9]+/g, ' ')   // punctuation and hyphens become separators
    .replace(/\s+/g, ' ')
    .trim()
}

// The two documents the Preceptor Assignment & Details message promises.
// `aliases` cover the spellings the Catalog has actually carried ("Pre-licensure"
// vs "Pre-Licensure"); they are compared normalized, so casing never matters.
export const PRECEPTOR_ASSIGNMENT_DOCUMENTS = Object.freeze([
  Object.freeze({
    key: 'aspire_brochure',
    label: 'ASPIRE Brochure',
    aliases: Object.freeze(['ASPIRE Brochure', 'ASPIRE Program Brochure']),
  }),
  Object.freeze({
    key: 'prelicensure_guidelines',
    label: 'Pre-Licensure Student General Guidelines',
    aliases: Object.freeze([
      'Pre-Licensure Student General Guidelines',
      'Prelicensure Student General Guidelines',
      'Pre-Licensure Nursing Student General Guidelines',
      // The template bullet words it this way; the Catalog title may too someday.
      'General Guidelines for Pre-Licensure Students',
    ]),
  }),
])

export const ATTACHMENT_PROBLEM_CODES = Object.freeze({
  MISSING: 'missing',
  AMBIGUOUS: 'ambiguous',
  UNAVAILABLE: 'unavailable',
})

/**
 * Resolve required documents against the options the server offered.
 *
 * `options` is the /api/outreach-attachment-options payload: already filtered to
 * ACTIVE internal Catalog files whose real extension is attachable, and carrying
 * no storage path. So "present in options" already means active and attachable -
 * this function only has to answer "is it there, exactly once?".
 *
 * @param options   [{ slug, title, type_label }] or null when the list could not load
 * @param required  defaults to PRECEPTOR_ASSIGNMENT_DOCUMENTS
 * @returns {{ resolved: Array, problems: Array, ok: boolean }}
 */
export function resolveRequiredAttachments(options, required = PRECEPTOR_ASSIGNMENT_DOCUMENTS) {
  const docs = Array.isArray(required) ? required : []

  // A Catalog that could not be read is not an empty Catalog. Saying "missing"
  // there would be a guess; every document is reported UNAVAILABLE instead.
  if (!Array.isArray(options)) {
    return {
      resolved: [],
      problems: docs.map(d => ({
        key: d.key, label: d.label, code: ATTACHMENT_PROBLEM_CODES.UNAVAILABLE,
      })),
      ok: false,
    }
  }

  const byTitle = new Map()
  for (const o of options) {
    if (!o || typeof o.slug !== 'string' || !o.slug) continue
    const norm = normalizeTitle(o.title)
    if (!norm) continue
    if (!byTitle.has(norm)) byTitle.set(norm, [])
    byTitle.get(norm).push(o)
  }

  const resolved = []
  const problems = []
  for (const doc of docs) {
    const names = [doc.label, ...(doc.aliases || [])]
    let hits = []
    for (const n of names) {
      const found = byTitle.get(normalizeTitle(n))
      if (found && found.length) { hits = found; break }
    }
    if (hits.length === 0) {
      problems.push({ key: doc.key, label: doc.label, code: ATTACHMENT_PROBLEM_CODES.MISSING })
      continue
    }
    if (hits.length > 1) {
      problems.push({ key: doc.key, label: doc.label, code: ATTACHMENT_PROBLEM_CODES.AMBIGUOUS })
      continue
    }
    const hit = hits[0]
    // Only the identity and display text the composer is allowed to hold.
    resolved.push({
      slug: hit.slug,
      title: String(hit.title || hit.slug),
      type_label: hit.type_label || '',
      size_bytes: null,          // the server's preview supplies the real size
      requiredKey: doc.key,
    })
  }
  return { resolved, problems, ok: problems.length === 0 && resolved.length === docs.length }
}

/** The Owner-facing sentence for an unresolved required document. */
export function attachmentProblemText(problem) {
  if (!problem) return ''
  switch (problem.code) {
    case ATTACHMENT_PROBLEM_CODES.AMBIGUOUS:
      return `More than one ASPIRE Catalog file is titled “${problem.label}”, so the right one cannot be identified.`
    case ATTACHMENT_PROBLEM_CODES.UNAVAILABLE:
      return `The ASPIRE Catalog could not be read, so “${problem.label}” could not be attached.`
    default:
      return `“${problem.label}” is not an active, attachable file in the ASPIRE Catalog.`
  }
}

/** One banner line summarizing every unresolved document. */
export function attachmentWarningText(problems) {
  const list = Array.isArray(problems) ? problems.filter(Boolean) : []
  if (list.length === 0) return ''
  const detail = list.map(attachmentProblemText).join(' ')
  return `${detail} Attach ${list.length === 1 ? 'it' : 'them'} manually, or edit the message so it does not promise ${list.length === 1 ? 'a document' : 'documents'} it does not carry.`
}

// ── The "do not claim what you are not carrying" guard ───────────────────────

// The claim fragments the guard recognizes. The current template says
// "Please see attached ..."; drafts saved before PRECEPTOR-DRAFT-CONTINUITY-1
// say "Please see the attached ...". Neither phrase contains the other, so BOTH
// are checked - an old restored draft must stay guarded, not slip through on a
// wording change.
export const ATTACHMENT_CLAIM_FRAGMENTS = Object.freeze(['see attached', 'see the attached'])

/** Strip HTML so the guard reads the rich editor's body the same as plain text. */
export function bodyText(body) {
  return String(body == null ? '' : body)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

/** Does this body tell the reader that documents are attached? */
export function claimsAttachments(body) {
  const text = bodyText(body)
  return ATTACHMENT_CLAIM_FRAGMENTS.some(f => text.includes(f))
}

/**
 * Why a message that CLAIMS attachments must not be sent yet, or null when it is
 * safe. `resolvedAttachments` is the server preview's own list, so this passes
 * only when the server confirmed the very files the message promises.
 */
export function attachmentClaimBlockReason({
  body, selected, serverResolved, required = PRECEPTOR_ASSIGNMENT_DOCUMENTS, requiredSlugs = null,
} = {}) {
  if (!claimsAttachments(body)) return null
  const wanted = Array.isArray(requiredSlugs) ? requiredSlugs.filter(Boolean) : null
  const selectedSlugs = new Set((selected || []).map(a => a?.slug).filter(Boolean))
  const serverSlugs = new Set((serverResolved || []).map(a => a?.slug).filter(Boolean))

  if (!wanted || wanted.length !== (required || []).length) {
    return 'This message says documents are attached, but they could not be identified in the ASPIRE Catalog. Attach them or remove the claim.'
  }
  const notSelected = wanted.filter(s => !selectedSlugs.has(s))
  if (notSelected.length) {
    return 'This message says documents are attached. Re-attach the ASPIRE Brochure and the Pre-Licensure Student General Guidelines, or remove the claim.'
  }
  const notResolved = wanted.filter(s => !serverSlugs.has(s))
  if (notResolved.length) {
    return 'The attached documents have not been verified by the server yet. Wait for the check to finish, or remove the claim.'
  }
  return null
}
