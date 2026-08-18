// ── Student email lookup normalization (shared by frontend + serverless API) ──
//
// All student-email lookups must be forgiving: case-insensitive, whitespace- and
// invisible-character-tolerant. Normalize BOTH the typed/pasted input AND the
// stored value before comparing, so capitalization, surrounding spaces, and
// zero-width characters introduced by copy/paste never block a match.
//   - NFKC Unicode-normalize
//   - strip zero-width chars: U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM
//   - trim, then lowercase
export function normalizeEmailForLookup(value) {
  // Zero-width set built via RegExp string so the source stays plain-ASCII and
  // robust (no literal invisible characters): U+200B ZWSP, U+200C ZWNJ,
  // U+200D ZWJ, U+FEFF BOM / zero-width no-break space.
  const ZERO_WIDTH = new RegExp('[\\u200B-\\u200D\\uFEFF]', 'g')
  return String(value || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .trim()
    .toLowerCase()
}

// Escape LIKE/ILIKE metacharacters so a normalized email is matched LITERALLY
// (case-insensitively) rather than treating % or _ within the address as
// wildcards. Pair an ilike(escapeLikePattern(norm)) filter with a JS
// normalizeEmailForLookup equality check to guarantee no broad/wrong-student match.
export function escapeLikePattern(value) {
  return String(value || '').replace(/[\\%_]/g, m => `\\${m}`)
}

// ── Unit-leader placement notice (PLACEMENT-COMMUNICATION-HANDOFF-1) ─────────
//
// The message a unit leader actually receives when a student is placed on their
// unit. RECIPIENT AND CC RULES ARE UNCHANGED: the same Outlook Web compose
// deeplink, the same bcc list built from the unit's contact_email. Only the
// subject and body changed.
//
// NO SIGNATURE IS APPENDED. The body ends at "Kind regards," because Outlook
// inserts the sender's own signature on compose; appending one here produced two.
// Nothing about typography is set - the message is plain text and inherits
// whatever the sender's Outlook uses.
//
// EVERY VALUE IS SUPPLIED ALREADY RESOLVED. This builder does no lookups and has
// no fallback of its own beyond "To be confirmed": it cannot reach a legacy
// column, so it cannot quote one. src/lib/placementCommunication.js is where the
// resolution (and the date audit behind it) lives.

const UNIT_LEADER_COMPOSE_BASE = 'https://outlook.office.com/mail/deeplink/compose'

// The https compose deeplink is not a mailto:, so it is bounded by URL limits
// rather than by an OS mail handler. 8000 is the conservative ceiling common
// server/proxy stacks accept; past it the caller warns instead of silently
// opening a truncated draft.
export const MAX_COMPOSE_URL_LENGTH = 8000

const orTBC = (v) => {
  const s = typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim())
  return s || 'To be confirmed'
}

/**
 * Build the subject, body and compose URL for a unit-leader placement notice.
 *
 * @param greetingName  the leader's preferred/first name, or null/'' when none is
 *                      reliable - the greeting then addresses the unit's team.
 * @param students      [{ name, school, program, termDates, hoursRequired,
 *                         shiftPreference, preceptorName, availability }]
 *                      Values are used verbatim; blanks become "To be confirmed".
 */
export function buildUnitLeaderPlacementMessage({
  contactEmails = '',
  unitName = '',
  greetingName = null,
  students = [],
  isMultiStudent = false,
}) {
  const emailList = String(contactEmails || '')
    .split(/[;,]/)
    .map(e => e.trim())
    .filter(Boolean)
    .join(',')

  const list = Array.isArray(students) ? students : []
  const many = isMultiStudent || list.length > 1
  const unit = String(unitName || '').trim() || 'the unit'

  const subject = many
    ? `ASPIRE placements: ${list.length} students — ${unit}`
    : `ASPIRE placement: ${orTBC(list[0]?.name)} — ${unit}`

  const greeting = greetingName && String(greetingName).trim()
    ? `Dear ${String(greetingName).trim()} and team,`
    : `Dear ${unit} team,`

  const studentBlock = list.map(s => [
    `Student: ${orTBC(s?.name)}`,
    `School: ${orTBC(s?.school)}`,
    `Program: ${orTBC(s?.program)}`,
    `Term Dates: ${orTBC(s?.termDates)}`,
    `Hours Required: ${orTBC(s?.hoursRequired)}`,
    `Shift Preference: ${orTBC(s?.shiftPreference)}`,
    `Preceptor: ${orTBC(s?.preceptorName)}`,
  ].join('\n')).join('\n\n---\n\n')

  // One availability paragraph per student when there is more than one, so the
  // sentence can never attach a student's availability to the wrong name.
  const availabilityLines = list.map(s => {
    const shared = String(s?.availability || '').trim()
    const who = many ? `${orTBC(s?.name)}` : 'the student'
    return shared
      ? `If it helps in preceptor selection, ${who} shared the following availability for shifts: ${shared}.`
      : `${many ? who : 'The student'} has not shared shift availability yet; we will follow up as soon as they do.`
  }).join('\n\n')

  const body = `${greeting}

Thank you for your continued support of ASPIRE (Affiliate Students' Pathway from Internship to Residency Experience) at Cedars-Sinai. We are grateful for your unit's commitment to hosting senior nursing students this cycle.

We are pleased to share the following placement${many ? 's' : ''} for your unit:

${studentBlock}

To complete ${many ? 'these placements' : 'this placement'}, kindly confirm with your team which preceptor will be working with ${many ? 'each student' : 'this student'} so we can coordinate the next steps. Once identified, we will send the preceptor a separate onboarding email with full details and guidelines.

${availabilityLines}

If you have any questions or concerns about ${many ? 'these placements' : 'this placement'}, please do not hesitate to reach out.

Thank you again for your support of clinical nursing education at Cedars-Sinai.

Kind regards,`

  const params = []
  if (emailList) params.push(`bcc=${encodeURIComponent(emailList)}`)
  params.push(`subject=${encodeURIComponent(subject)}`)
  params.push(`body=${encodeURIComponent(body)}`)
  const url = `${UNIT_LEADER_COMPOSE_BASE}?${params.join('&')}`

  return { subject, body, url, urlLength: url.length, tooLong: url.length > MAX_COMPOSE_URL_LENGTH }
}

/** Backward-compatible URL-only form. */
export function buildUnitLeaderEmail(args) {
  return buildUnitLeaderPlacementMessage(args).url
}
