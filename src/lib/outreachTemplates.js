// src/lib/outreachTemplates.js
//
// MANUAL-OUTREACH-TEMPLATE-LIBRARY — copy builders for single-recipient manual templates.
// Both hydrate the editable in-app Direct Message composer (ASPIRE Outreach send) and are ALWAYS
// editable before sending. Copy is safe-draft with clear [placeholders] and fallbacks; the owner
// customizes the final wording. No tokens, secure links, or documents are embedded.
//
// NO closing or signature lives in these bodies. The app's "Include my email signature" behavior
// (server-side, see lib/server/connect/emailTemplates.js) appends the closing "Warm regards," and
// the resolved sender signature, so templates end at body content to avoid a duplicate closing.
// Callers hydrate these with includeSignature=true.

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

Again, we truly appreciate your time, effort, and heart in mentoring our students. Many ASPIRE students go on to become strong candidates for our New-Graduate RN Residency Program, and your guidance plays a meaningful role in helping them build confidence, competence, and readiness for practice.

Please don't hesitate to reach out if you have any questions.`
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

ASPIRE at Cedars-Sinai <noreply@aspire-program.com>

Thank you for your continued partnership in supporting clinical nursing education.`
  return { subject, body }
}

// ── Send-to-Many manual bulk templates (Phase 2A) ───────────────────────────────
// Shared editable drafts for the multi-source bulk audience composer. Bodies carry NO closing
// or signature (the app signature supplies the close — see Phase 1C). Per-recipient first name
// and school are merged at preview/send only; every other [placeholder] (links, deadlines, unit,
// preceptor, rotation, dates, cohort name) stays literal and is edited once before sending.
// Static public links (/school-form, /student-form, /interview-schedule) remain editable
// placeholders in this UI-only phase.

const BULK_ACADEMIC_PARTNER = {
  subject: 'ASPIRE Program: Student Placement Request Form for [Cohort Name]',
  body: `Dear [Clinical Coordinator First Name],

I hope you are doing well.

We are preparing for the upcoming ASPIRE Program cohort at Cedars-Sinai and would like to invite your school to submit student placement requests for consideration.

Please complete the ASPIRE School Placement Request Form using the link below:

[Insert School Form Link]

This form allows us to collect your requested student placements, including student names, program details, preferred units, rotation requirements, dates, and any important notes that may help us review placement feasibility.

Please submit the form by [Insert Deadline], if possible, so we can review all requests alongside available unit capacity.

As a reminder, submission of a request does not guarantee placement. Placement decisions are based on unit capacity, preceptor availability, student eligibility, and program alignment.

To help ensure that you receive ASPIRE Program communications, including future updates regarding student progress, please add the following email address to your contact list or safe senders:

ASPIRE at Cedars-Sinai <noreply@aspire-program.com>

Thank you for your continued partnership in supporting clinical nursing education.`,
}

const BULK_STUDENT_PROFILE = {
  subject: 'ASPIRE Program: Complete Your Student Profile',
  body: `Dear [Student First Name],

Thank you for your interest in participating in the ASPIRE Program, Affiliate Students' Pathway from Internship to Residency Experience, at Cedars-Sinai.

To help us review your information and prepare for the next steps, please complete your ASPIRE Student Profile Form using the link below:

[Insert Student Form Link]

Please complete the form by [Insert Deadline].

The form will ask for important information such as your contact details, school/program information, expected graduation timeline, availability, unit interests, and other details needed for placement review.

Please make sure that all information is accurate and complete. If your availability, contact information, or program status changes after submission, please notify the ASPIRE team as soon as possible.

Completion of the form does not guarantee placement. Final placement depends on student eligibility, school approval, unit capacity, preceptor availability, and program alignment.

Thank you, and we look forward to learning more about you.`,
}

const BULK_INTERVIEW_SCHEDULING = {
  subject: 'ASPIRE Program: Schedule Your Interview',
  body: `Dear [Student First Name],

Thank you for completing the ASPIRE Program student profile process.

We are now inviting you to schedule your ASPIRE Program interview. Please use the link below to select an available interview time:

[Insert Interview Schedule Link]

Interview appointments are based on the availability of our ASPIRE interviewers and may be filled on a first-come, first-served basis. Please select a time that you can attend reliably.

Before your interview, please be prepared to discuss:

• Your interest in the ASPIRE Program
• Your clinical goals and learning objectives
• Your preferred areas of nursing practice
• Your readiness to participate in a senior nursing student rotation at Cedars-Sinai
• Your interest in future transition-to-practice opportunities, including the New Graduate RN Residency Program pathway, if applicable

Please complete your scheduling by [Insert Deadline].

If you have a scheduling conflict or cannot find an available time that works for you, please contact the ASPIRE team as soon as possible.

Thank you, and we look forward to meeting with you.`,
}

const BULK_ANNOUNCEMENT = {
  subject: 'ASPIRE Program: Acceptance and Orientation Next Steps',
  body: `Dear [Student First Name],

Congratulations. We are pleased to inform you that you have been accepted to participate in the ASPIRE Program, Affiliate Students' Pathway from Internship to Residency Experience, at Cedars-Sinai.

We are excited to welcome you to this next step in your senior nursing student experience.

Your ASPIRE Program details are listed below:

School: [School]
Assigned Unit: [Unit / Assignment]
Preceptor: [Preceptor Name, if available]
Rotation Dates / Schedule: [Rotation Dates / Schedule]
Required Hours: [Required Hours, if applicable]
Additional Notes: [Insert Additional Notes, if applicable]

In-Person Orientation

You are required to attend the ASPIRE in-person orientation before beginning your shifts.

Orientation Date: [Day], [Date]
Time: [Time]
Location: [Location]
Parking / Arrival Instructions: [Insert Details]
What to Bring: [Insert Details]

The orientation will include:

• ASPIRE Program overview and expectations
• Shift log process and badge use
• Unit expectations and preceptor communication
• Patient confidentiality and professional expectations
• New Graduate RN Residency Program pathways

A few important reminders:

• You must attend orientation before beginning your ASPIRE shifts.
• You are expected to follow ASPIRE Program expectations for senior nursing students.
• You are expected to follow Cedars-Sinai policies and unit expectations at all times.
• You must maintain patient confidentiality at all times.
• You are expected to log your shifts accurately throughout the rotation.
• Please notify the ASPIRE team right away if you will no longer be moving forward for any reason.

New Graduate RN Residency Program Pathway

As part of ASPIRE, you may receive information about Cedars-Sinai's New Graduate RN Residency Program and related transition-to-practice opportunities. We encourage you to pay close attention to application timelines, eligibility requirements, and communications from the ASPIRE and NGRP teams.

To help ensure that you receive ASPIRE Program communications, please add the following email address to your contact list or safe senders:

ASPIRE at Cedars-Sinai <noreply@aspire-program.com>

We are excited to support your growth, learning, and transition into professional nursing practice.`,
}

// Keyed registry for the Send-to-Many message-type selector.
const BULK_TEMPLATES = {
  academic_partner_placement:   BULK_ACADEMIC_PARTNER,
  student_profile_invitation:   BULK_STUDENT_PROFILE,
  student_interview_scheduling: BULK_INTERVIEW_SCHEDULING,
  announcement_broadcast:       BULK_ANNOUNCEMENT,
}

// Returns a fresh { subject, body } for a bulk template key, or null for an unknown key.
export function buildBulkTemplate(key) {
  const tpl = BULK_TEMPLATES[key]
  return tpl ? { subject: tpl.subject, body: tpl.body } : null
}
