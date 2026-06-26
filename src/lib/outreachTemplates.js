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
// Salutation uses the recipient's (preceptor's) first name when available, else "Preceptor".
// All assignment fields stay bracketed editable placeholders (the student is not reliably the
// current recipient, so we do not auto-fill them). No attachments are claimed as included.
export function buildPreceptorAssignmentDraft({ firstName } = {}) {
  const subject = 'Thank You for Precepting an ASPIRE Student Nurse'
  const body = `Dear ${fb(firstName, 'Preceptor')},

Thank you for agreeing to precept one of our senior nursing students through the ASPIRE Program, Affiliate Students' Pathway from Internship to Residency Experience. Your willingness to teach, mentor, and support our students makes such a meaningful difference in their professional growth and transition into practice.

Below is a summary of your student assignment:

Student: [Student Name]
School: [School]
Unit / Assignment: [Unit / Assignment]
Rotation Dates / Schedule: [Rotation Dates / Schedule]
Required Hours: [Required Hours, if applicable]
Additional Notes: [Insert any relevant notes, if applicable]

The student is encouraged to reach out to you directly by email to introduce themselves, coordinate scheduling, and share their individual learning objectives to help guide the experience.

A few quick reminders:

• Preceptor pay: If eligible, please feel free to reach out to Dr. Krystal Rodriguez with any questions.
• Coverage: If possible, please avoid being in charge while precepting so you can focus on teaching and supporting the student.
• Floating: Students may float with you if you are comfortable and if it is appropriate for safety and learning.
• Scope of practice: The ASPIRE brochure and Pre-Licensure Student General Guidelines can be added before sending or shared separately for your reference.

Again, we truly appreciate your time, effort, and heart in mentoring our students. Many ASPIRE students go on to become strong candidates for our New Graduate RN Residency Program, and your guidance plays a meaningful role in helping them build confidence, competence, and readiness for practice.

Please don't hesitate to reach out if you have any questions.

Kind regards,

Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Nursing Professional Development Practitioner
Geri & Richard Brawerman Nursing Institute
Cedars-Sinai
JesterLloyd.Bautista@cshs.org | 310-248-8964`
  return { subject, body }
}

// Coordinator Acceptance Update — external coordinator/academic-partner email (ASPIRE Outreach).
// Salutation uses the recipient's first name when available, else "Colleague".
export function buildCoordinatorAcceptanceDraft({ firstName } = {}) {
  const subject = 'ASPIRE Program: Accepted Students and Orientation Next Steps'
  const body = `Dear ${fb(firstName, 'Colleague')},

I'm reaching out with an update regarding your students' participation in the ASPIRE Program at Cedars-Sinai.

The following student(s) have been accepted to move forward:

[Insert accepted student names and relevant details here.]

As part of the ASPIRE Program, students are expected to:
• Attend the required in-person orientation before beginning their shifts
• Accurately log all completed shifts through the ASPIRE shift log process
• Follow ASPIRE Program expectations for senior nursing students
• Follow Cedars-Sinai policies and unit expectations
• Maintain patient confidentiality at all times
• Notify the ASPIRE team if they will no longer be moving forward for any reason

In-Person Orientation Invitation

We would like to invite you and your students to attend an in-person, on-campus orientation on [day], [date], at [time] at Cedars-Sinai Medical Center.

This session will include:
• ASPIRE Program overview and expectations
• Shift log process and badge use
• Unit expectations and preceptor introductions
• New Graduate RN Residency Program pathways

Please confirm whether this date and time will work for your group. If the schedule does not work, please let us know as soon as possible so we can discuss next steps.

Once we receive your confirmation, we will send your students a separate email with logistical details, including the meeting location, parking instructions, and what to bring.

Lastly, to help ensure that you receive ASPIRE Program communications, including automated updates regarding student progress, please add the following email address to your contact list or safe senders:

ASPIRE Intelligence: noreply@aspire-program.com

Thank you for your continued partnership in supporting clinical nursing education.

Kind regards,
${SIGNATURE}`
  return { subject, body }
}
