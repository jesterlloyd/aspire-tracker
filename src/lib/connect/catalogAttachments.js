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
// IDENTITY IS THE SLUG. PRECEPTOR-ATTACHMENT-REMINDER-1: a document is
// identified by its Catalog slug first, and only then by title. Titles are
// display text the Owner may edit; matching on them alone is what silently
// broke this in production (see PRECEPTOR_ASSIGNMENT_DOCUMENTS below).
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
//
// PRECEPTOR-ATTACHMENT-REMINDER-1: IDENTITY IS THE SLUG, NOT THE TITLE.
// Matching on the display title alone is what broke this in production. The
// Catalog's brochure is titled "ASPIRE Digital Brochure"; the resolver only
// knew "ASPIRE Brochure" and "ASPIRE Program Brochure", so the brochure came
// back MISSING, ok went false, the attachment bullet was suppressed and the
// draft carried one file instead of two. A title is display text the Owner may
// edit at any time; the slug is the Catalog row's stable identity. So `slugs`
// is tried FIRST and a rename can no longer break resolution.
//
// `aliases` remain ONLY as backward compatibility, for a Catalog row whose slug
// differs from the canonical one but whose title still names the document. They
// are compared normalized, so casing and hyphenation never matter.
//
// `label` is the CANONICAL CATALOG TITLE, because it is what the Owner-facing
// warning prints. The old label named "ASPIRE Brochure" - a file that has never
// existed under that title - which sent the reader looking for the wrong thing.
export const PRECEPTOR_ASSIGNMENT_DOCUMENTS = Object.freeze([
  Object.freeze({
    key: 'aspire_brochure',
    label: 'ASPIRE Digital Brochure',
    slugs: Object.freeze(['aspire-digital-brochure']),
    aliases: Object.freeze([
      'ASPIRE Digital Brochure',
      'ASPIRE Brochure',
      'ASPIRE Program Brochure',
    ]),
  }),
  Object.freeze({
    key: 'prelicensure_guidelines',
    label: 'General Guidelines for Pre-Licensure Students',
    slugs: Object.freeze(['general-guidelines-for-pre-licensure-students']),
    aliases: Object.freeze([
      'General Guidelines for Pre-Licensure Students',
      'Pre-Licensure Student General Guidelines',
      'Prelicensure Student General Guidelines',
      'Pre-Licensure Nursing Student General Guidelines',
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

  const bySlug = new Map()
  const byTitle = new Map()
  for (const o of options) {
    if (!o || typeof o.slug !== 'string' || !o.slug) continue
    if (!bySlug.has(o.slug)) bySlug.set(o.slug, o)
    const norm = normalizeTitle(o.title)
    if (!norm) continue
    if (!byTitle.has(norm)) byTitle.set(norm, [])
    byTitle.get(norm).push(o)
  }

  const resolved = []
  const problems = []
  for (const doc of docs) {
    // SLUG FIRST. A slug is the Catalog row's own identity and is unique, so a
    // hit here is unambiguous by construction and survives any retitling.
    let hit = null
    let matchedBy = ''
    for (const slug of doc.slugs || []) {
      const found = bySlug.get(slug)
      if (found) { hit = found; matchedBy = 'slug'; break }
    }

    // TITLE ONLY AS A FALLBACK, for a Catalog row that carries the document
    // under a different slug. The ambiguity rule still applies here: two rows
    // normalizing to one title means nobody can say which was promised.
    if (!hit) {
      const names = [doc.label, ...(doc.aliases || [])]
      let hits = []
      for (const n of names) {
        const found = byTitle.get(normalizeTitle(n))
        if (found && found.length) { hits = found; break }
      }
      if (hits.length > 1) {
        problems.push({ key: doc.key, label: doc.label, code: ATTACHMENT_PROBLEM_CODES.AMBIGUOUS })
        continue
      }
      if (hits.length === 1) { hit = hits[0]; matchedBy = 'title' }
    }

    if (!hit) {
      problems.push({ key: doc.key, label: doc.label, code: ATTACHMENT_PROBLEM_CODES.MISSING })
      continue
    }
    // Only the identity and display text the composer is allowed to hold.
    resolved.push({
      slug: hit.slug,
      title: String(hit.title || hit.slug),
      type_label: hit.type_label || '',
      size_bytes: null,          // the server's preview supplies the real size
      requiredKey: doc.key,
      matchedBy,                 // 'slug' | 'title' - provable, never displayed
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

/** The required documents, named the way the Catalog names them. */
function namesOf(required) {
  const labels = (Array.isArray(required) ? required : []).map(d => d?.label).filter(Boolean)
  if (labels.length === 0) return 'the required documents'
  if (labels.length === 1) return `the ${labels[0]}`
  return `the ${labels.slice(0, -1).join(', the ')} and the ${labels[labels.length - 1]}`
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
    return `This message says documents are attached. Re-attach ${namesOf(required)}, or remove the claim.`
  }
  const notResolved = wanted.filter(s => !serverSlugs.has(s))
  if (notResolved.length) {
    return 'The attached documents have not been verified by the server yet. Wait for the check to finish, or remove the claim.'
  }
  return null
}

// ── Obsolete drafts ─────────────────────────────────────────────────────────
//
// PRECEPTOR-ATTACHMENT-REMINDER-1. Drafts written while resolution was broken
// are still sitting in browser storage: they carry ONE attachment and no
// attachment reminder, and they are restored silently because a draft that
// names its own placement is correctly recognized as "this handoff, restored"
// rather than somebody else's work.
//
// So the draft is COMPARED against what the template would produce now. When it
// falls short the composer OFFERS a refresh; it never performs one. The offer
// leads to the same branded Replace-draft confirmation every other template
// application uses, so real edits can never be replaced without a decision.
export function templateRefreshReason({ body, selected, docs, requiredBullet } = {}) {
  // Nothing better can be offered while the documents still do not resolve.
  if (!docs || docs.ok !== true) return null
  const text = bodyText(body)
  if (!text) return null

  const have = new Set((selected || []).map(a => a?.slug).filter(Boolean))
  const missingFiles = docs.resolved.map(a => a.slug).filter(slug => !have.has(slug))
  const bulletMissing = requiredBullet ? !text.includes(bodyText(requiredBullet)) : false
  if (!missingFiles.length && !bulletMissing) return null

  const what = missingFiles.length && bulletMissing
    ? `${missingFiles.length === 1 ? 'a required document' : 'both required documents'} and the attachment reminder`
    : missingFiles.length
      ? (missingFiles.length === 1 ? 'a required document' : 'both required documents')
      : 'the attachment reminder'
  const tail = missingFiles.length
    ? 'Both documents are available now.'
    : 'Both documents are attached; only the sentence that says so is missing.'
  return `This draft was written before the ASPIRE Catalog documents could be resolved, so it is missing ${what}. ${tail}`
}
