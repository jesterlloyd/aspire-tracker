// src/lib/outreachTemplates.js
//
// MANUAL-OUTREACH-TEMPLATE-LIBRARY — copy builders for single-recipient manual templates.
// Both hydrate the editable in-app Direct Message composer (ASPIRE Outreach send) and are ALWAYS
// editable before sending. Copy is safe-draft with clear [placeholders] and fallbacks; the owner
// customizes the final wording. No tokens, secure links, or documents are embedded.

// Formal signature (per approved spec).
const SIGNATURE = `Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
ASPIRE Program Lead
Brawerman Nursing Institute, Cedars-Sinai
JesterLloyd.Bautista@cshs.org | Office: 310-248-8964`

// fallback: trimmed value if present, else the placeholder.
const fb = (v, placeholder) => (v && String(v).trim()) ? String(v).trim() : placeholder

// Preceptor Assignment — internal Cedars email, sent through the in-app Direct Message flow.
export function buildPreceptorAssignmentDraft({ studentName, school, unit } = {}) {
  const subject = `ASPIRE Preceptor Assignment: ${fb(studentName, '[Student Name]')}`
  const body = `Dear Preceptor,

Thank you so much for agreeing to precept one of our senior nursing students through the ASPIRE Program at Cedars-Sinai. Your willingness to teach, mentor, and support our students makes a meaningful difference in shaping the next generation of nurses.

Student: ${fb(studentName, '[Student Name]')}
School: ${fb(school, '[School]')}
Unit / Assignment: ${fb(unit, '[Unit / Assignment]')}
Rotation Schedule: [Rotation Dates / Schedule]

The student is expected to follow the ASPIRE guidelines for senior nursing students, Cedars-Sinai policies, and patient confidentiality expectations at all times, and to log their shifts accurately throughout the rotation.

The student will reach out to introduce themselves and coordinate scheduling. Program details, guidelines, and the ASPIRE brochure can be added before sending if needed.

Warm regards,
${SIGNATURE}`
  return { subject, body }
}

// Coordinator Acceptance Update — external coordinator/academic-partner email (ASPIRE Outreach).
// Salutation uses the recipient's first name when available, else "Colleague".
export function buildCoordinatorAcceptanceDraft({ firstName } = {}) {
  const subject = 'ASPIRE Program: Student Acceptance and Orientation Next Steps'
  const body = `Dear ${fb(firstName, 'Colleague')},

I'm reaching out with an update on your students' participation in the ASPIRE Program at Cedars-Sinai.

[Insert accepted student names and relevant details here.]

A few items for your awareness:

Students are expected to log their shifts accurately and follow the ASPIRE guidelines for senior nursing students. They are also expected to follow Cedars-Sinai policies, maintain patient confidentiality at all times, attend the required in-person orientation before beginning their shifts, and notify the ASPIRE team if they will not be moving forward for any reason.

In-Person Orientation Invitation

We would like to invite you and your students to attend an in-person, on-campus orientation on [day], [date], at [time] at Cedars-Sinai Medical Center. This session will cover:

- ASPIRE Program overview and expectations
- Shift log process and badge use
- Unit expectations and preceptor introductions
- New Graduate RN Residency Program pathways

Please confirm your availability for this date and time. If [day], [date], at [time] does not work for your group, please let us know right away.

We will send additional logistical details, including meeting location, parking, and what to bring, once we receive your confirmation.

To make sure you receive program communications without them being blocked by your school's email filters, including weekly updates on your students' progress, please add the following email address to your contact list or safe senders:

ASPIRE Intelligence: noreply@aspire-program.com

Please let me know if there is any documentation or coordination needed on your end. Thank you for your continued partnership in supporting clinical nursing education.

Warm regards,
${SIGNATURE}`
  return { subject, body }
}
