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

export function buildUnitLeaderEmail({
  contactPersons,
  contactEmails,
  unitName,
  students,
  isMultiStudent = false
}) {
  const emailList = contactEmails
    .split(/[;,]/)
    .map(e => e.trim())
    .filter(Boolean)
    .join(',')

  const subject = isMultiStudent
    ? `ASPIRE Program Student Placements – ${unitName}`
    : `ASPIRE Program Student Placement – ${students[0].lastName}, ${students[0].firstName} | ${unitName}`

  const studentBlock = students.map(s => `
Student: ${s.lastName}, ${s.firstName}
School: ${s.school}
Program: ${s.programType || 'N/A'}
Term Dates: ${s.termDates || 'TBD'}
Hours Required: ${s.hoursRequired ? s.hoursRequired + ' hours' : 'TBD'}
Shift Preference: ${s.shiftPreference || 'TBD'}
${s.preceptorAssigned ? `Assigned Preceptor: ${s.preceptorAssigned}` : 'Preceptor: To be confirmed'}
`).join('\n---\n')

  const greeting = contactPersons.includes(',')
    ? `Dear ${contactPersons.split(',')[0].trim().split(' ')[0]} and team,`
    : `Dear ${contactPersons.split(' ')[0]},`

  const body = `${greeting}

Thank you for your continued support of the ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience) at Cedars-Sinai. We are grateful for your unit's commitment to hosting senior nursing students this cycle.

We are pleased to share the following placement${students.length > 1 ? 's' : ''} for your unit:

${studentBlock}

To complete this placement, please confirm with your team which preceptor will be working with this student and reply to this email so we can coordinate next steps. Once confirmed, we will send the preceptor a separate onboarding email with full details and guidelines.

If you have any questions or concerns about this placement, please do not hesitate to reach out.

Thank you again for your support of clinical nursing education at Cedars-Sinai.

Warm regards,
Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute
JesterLloyd.Bautista@cshs.org | 310-248-8964`

  return `https://outlook.office.com/mail/deeplink/compose?bcc=${encodeURIComponent(emailList)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
