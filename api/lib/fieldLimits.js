// api/lib/fieldLimits.js
//
// S-06 LENGTH CAPS: server-side maximum lengths for the free-text fields the PUBLIC submission
// endpoints accept. Before this, most of them were unbounded, so a single request could store an
// arbitrarily large blob and push it into an email that staff and coordinators receive.
//
// POLICY
//   Caps are generous. A coordinator or unit leader writing several thoughtful paragraphs must
//   never hit one; these exist to stop abuse, not to shape prose.
//
//   Over-length input is REJECTED with a clear message naming the field. It is never silently
//   truncated, because a submitter would have no way to learn their text was cut.
//
//   The tiers match the caps this codebase already used before this module existed, so nothing
//   drifts: 120 for a typed name (student intake privacy acknowledgment), 500 for a short field
//   (unavailable weekdays reason), 1000 for availability notes, 2000 for a narrative (school
//   scheduling notes), 254 for an email address and 200/100 for the unit form's identity fields.

export const LIMITS = {
  NAME: 120,          // a person's name as typed
  IDENTITY: 200,      // a unit, school, program, or preference label
  ROLE: 100,          // a role selection
  EMAIL: 254,         // RFC 5321 practical maximum
  PHONE: 50,
  DATE: 50,           // an ISO date string with room to spare
  SHORT: 500,         // a sentence or two
  NOTES: 1000,        // availability notes
  NARRATIVE: 2000,    // a paragraph or several
  LONG_NARRATIVE: 4000, // the main free-text field on a form
};

// The largest number of students one placement request may carry. A real school submits a cohort
// roster; this bounds both the write loop and the per-student notification fan-out it triggers.
export const MAX_STUDENTS_PER_PLACEMENT_REQUEST = 100;

const len = (v) => (typeof v === 'string' ? v.trim().length : 0);

// Checks one field. Returns null when it fits, or { field, label, max, message } when it does not.
export function checkLength(field, label, value, max) {
  const actual = len(value);
  if (actual <= max) return null;
  return {
    field,
    label,
    max,
    message: `${label} is too long. Please shorten it to ${max} characters or fewer (currently ${actual}).`,
  };
}

// Checks a list of [field, label, value, max] tuples in order and returns the FIRST failure, so the
// submitter is pointed at one specific field rather than a wall of errors.
export function checkLengths(specs) {
  for (const [field, label, value, max] of specs) {
    const failure = checkLength(field, label, value, max);
    if (failure) return failure;
  }
  return null;
}
