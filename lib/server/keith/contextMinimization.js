// KEITH-P0: the privacy boundary between BASE Keith and CONFIDENTIAL skills.
//
// The rule this module enforces:
//
//   Base Keith is role-minimized. Ordinary chat context carries the OPERATIONAL
//   record (who is placed where, on what unit, with which preceptor, how many
//   hours) and NOT the personal-contact record. Personal email, phone, GPA, and
//   stored file paths are removed from the default prompt for every role.
//
//   A confidential skill may reach one explicitly resolved student's protected
//   data only after role, cohort, entitlement, and required-data authorization
//   all succeed - and that access is audited per invocation.
//
// Before this module every Keith request, whatever the caller's role and
// whatever they asked, carried every placed student's school email, personal
// email, phone, and GPA in the system prompt. An interviewer asking "how many
// students are on 6NE" received the same contact dossier as the Owner. That is
// the leak this closes.
//
// SCHOOL EMAIL is the one contact field that survives, and only when the caller
// is actually drafting an email. That reuses the existing intent-gated
// withholding pattern already used for the leadership roster: the field is
// present when the task genuinely needs it and absent otherwise. Personal email
// and phone never return, in any intent - Connect is the system of record for
// reaching a student personally, not Keith's prompt.

/** Fields removed from the default prompt for every role, in every intent. */
export const ALWAYS_WITHHELD_FIELDS = Object.freeze([
  'personal_email',
  'phone',
  'cumulative_gpa',
  'resume_url',
  'headshot_url',
]);

/** Fields present only for the intent that needs them. */
export const INTENT_GATED_FIELDS = Object.freeze({
  school_email: 'EMAIL_DRAFTING',
});

/**
 * Decide whether a student field may appear in the DEFAULT (non-skill) prompt.
 * Pure and role-independent by design: minimization is a floor for everyone,
 * not a privilege gradient. Role still governs tools and skills separately.
 */
export function allowsFieldInDefaultContext(field, intent) {
  if (ALWAYS_WITHHELD_FIELDS.includes(field)) return false;
  const requiredIntent = INTENT_GATED_FIELDS[field];
  if (requiredIntent) return intent === requiredIntent;
  return true;
}

/**
 * The contact line for one student in the live block, or null when nothing is
 * permitted. Returning null (rather than a line of "N/A") keeps the withheld
 * state honest: the model is not told a value is missing when it is withheld.
 */
export function buildContactLine(student, intent) {
  if (!allowsFieldInDefaultContext('school_email', intent)) return null;
  const email = student?.school_email;
  return `  School Email: ${email || 'N/A'}`;
}

/**
 * Strip withheld fields from a student-shaped object. Used to keep tool results
 * and any future context assembly aligned with the same single rule.
 */
export function minimizeStudent(student, intent) {
  if (!student || typeof student !== 'object') return student;
  const out = {};
  for (const [k, v] of Object.entries(student)) {
    if (allowsFieldInDefaultContext(k, intent)) out[k] = v;
  }
  return out;
}

/**
 * Assertion helper for tests and for the request path: returns the list of
 * withheld field names found in an assembled prompt string. A non-empty result
 * means the boundary leaked.
 */
export function findWithheldFieldLabels(promptText) {
  const labels = {
    personal_email: /Personal Email:/i,
    phone: /\bPhone:/i,
    cumulative_gpa: /\bGPA:/i,
    resume_url: /resume_url|\/resume\.(pdf|docx?|doc)\b/i,
  };
  return Object.entries(labels)
    .filter(([, re]) => re.test(String(promptText || '')))
    .map(([name]) => name);
}
