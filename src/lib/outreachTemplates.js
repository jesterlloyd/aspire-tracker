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

// ── EMAIL-MANUAL-TEMPLATE-BLOCKS-1: rich Content Block builders ──────────────────
// Some manual templates also ship a `richBody`: HTML containing the SAME ASPIRE Content Block markers
// the rich composer produces (data-aspire-block="…"). When rich compose is ON the composer hydrates
// the editor from this HTML (the markers parse into Heading/Note/Divider/Event blocks via the proven
// RICH-COMPOSE-2A-1 path), and the server's renderConnectBody renders the identical email for preview
// and send. When rich compose is OFF, the plain-text `body` is used unchanged. Placeholders ([Student
// Name], [Unit], [Date]…) stay literal and editable. No tokens, secure links, or buttons are added.
const escTxt  = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const bH2   = (t) => `<h2>${escTxt(t)}</h2>`
const bP    = (t) => `<p>${escTxt(t)}</p>`
const bUL   = (items) => `<ul>${items.map(i => `<li>${escTxt(i)}</li>`).join('')}</ul>`
const bDivider = '<hr data-aspire-block="divider">'
const bNote = ({ title = '', body }) =>
  `<div data-aspire-block="note" data-title="${escAttr(title)}" data-body="${escAttr(body)}"></div>`
// (bEvent available for future date/time templates; unused here since none carry fixed event details.)

// Preceptor Assignment — internal Cedars email, sent through the in-app Direct Message flow.
// Salutation uses the recipient's (preceptor's) first name when available, else "Preceptor".
// All assignment fields stay bracketed editable placeholders (the student is not reliably the
// current recipient, so we do not auto-fill them). No attachments are claimed as included.
export function buildPreceptorAssignmentDraft({ firstName } = {}) {
  const subject = 'Thank You for Precepting an ASPIRE Student Nurse'
  const body = `Dear ${fb(firstName, 'Preceptor')},

Thank you for agreeing to precept one of our senior nursing students through ASPIRE, Affiliate Students' Pathway from Internship to Residency Experience. Your willingness to teach, mentor, and support our students makes such a meaningful difference in their professional growth and transition into practice.

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

// Academic Partner Update — external academic-partner/coordinator email (ASPIRE Outreach).
// CONNECT-MANUAL-TEMPLATES-3: repurposed from the former "Coordinator Acceptance Update" — the
// registry KEY is preserved as 'coordinator_acceptance' for draft/routing compatibility; only the
// visible label and this copy changed (confirm acceptance + invite to orientation, concise).
// Salutation uses the recipient's first name when available, else "Colleague".
export function buildAcademicPartnerUpdateDraft({ firstName } = {}) {
  const subject = 'ASPIRE: Student placement update and orientation next steps'
  const body = `Dear ${fb(firstName, 'Colleague')},

I'm writing with an update on your students' participation in ASPIRE at Cedars-Sinai.

The following student(s) have been accepted and are moving forward in the ASPIRE process:

[Insert accepted student names and relevant details here.]

As a next step, students will be invited to the required in-person orientation before they begin their shifts. We will send each student the orientation date, location, parking, and arrival details directly.

You are warmly invited to attend the orientation or to stay looped in as appropriate for your program. If you would like to join, please let me know and I will share the details.

Thank you for your continued partnership in supporting clinical nursing education.`
  const richBody =
    bH2('ASPIRE Student Update')
    + bP(`Dear ${fb(firstName, 'Colleague')}, I'm writing with an update on your students' participation in ASPIRE at Cedars-Sinai. The following student(s) have been accepted and are moving forward in the ASPIRE process:`)
    + bP('[Insert accepted student names and relevant details here.]')
    + bNote({ title: 'Next step: orientation', body: 'Students will be invited to the required in-person orientation before they begin their shifts. We will send each student the orientation date, location, parking, and arrival details directly.' })
    + bP('You are warmly invited to attend the orientation or to stay looped in as appropriate for your program. If you would like to join, please let me know and I will share the details. Thank you for your continued partnership in supporting clinical nursing education.')
  return { subject, body, richBody }
}

// Preceptor Details Request — internal Cedars email asking the preceptor for the information needed
// to introduce them to the student. Salutation uses the preceptor's first name when available.
// The photo is explicitly optional. No tokens, secure links, or attachments.
export function buildPreceptorDetailsRequestDraft({ firstName } = {}) {
  const subject = 'ASPIRE: Preceptor details for student introduction'
  const body = `Dear ${fb(firstName, 'Preceptor')},

Thank you again for supporting ASPIRE and for agreeing to precept one of our senior nursing students. I'm getting ready to introduce you to [Student Name] and want to make that introduction as smooth as possible.

When you have a moment, could you please send me the following:

• Your preferred name and title (how you'd like to be introduced)
• The best contact information for the student to reach you
• Your preferred schedule or upcoming shifts
• Your preferred method of communication (email, phone, or in person)
• A photo we can share with the student, if you're comfortable — this is completely optional
• Any specific expectations or instructions for the student's first day

The photo is entirely optional, so please only share one if you'd like to. Once I have these details, I'll introduce you and [Student Name] so you can connect before the rotation begins.

Thank you so much for your time and for helping our students get off to a great start.`
  const richBody =
    bH2('Preceptor Details Request')
    + bP(`Dear ${fb(firstName, 'Preceptor')}, thank you again for supporting ASPIRE and for agreeing to precept one of our senior nursing students. I'm getting ready to introduce you to [Student Name] and want to make that introduction as smooth as possible.`)
    + bNote({ title: 'A few details, when you have a moment', body: "Please share your preferred name and title, the best contact information for the student, your preferred schedule, your preferred communication method, and any instructions for the first day. A photo to share with the student is welcome but completely optional." })
    + bUL(['Preferred name and title', 'Best contact email (and phone, if appropriate)', 'Typical schedule or upcoming shifts', 'Unit and shift confirmation', 'Optional photo to share with the student'])
    + bP("Once I have these details, I'll introduce you and [Student Name] so you can connect before the rotation begins. Thank you so much for your time and for helping our students get off to a great start.")
  return { subject, body, richBody }
}

// Unit Leader Support Request — internal Cedars email asking the unit leader for a preceptor name
// after a student has been matched to their unit. Appreciative, collaborative tone.
export function buildUnitLeaderSupportRequestDraft({ firstName } = {}) {
  const subject = 'ASPIRE: Preceptor support requested for student placement'
  const body = `Dear ${fb(firstName, 'Colleague')},

I'm reaching out because a senior nursing student has been matched to your unit, [Unit], through ASPIRE at Cedars-Sinai. Thank you for supporting this placement.

The next step is identifying a preceptor for the student. When you have a moment, could you please help me by providing:

• Preceptor name
• Preceptor email
• Shift or schedule, if known
• Whether the preceptor is comfortable being introduced to the student

Once the preceptor is confirmed, I'll connect [Student Name] and the preceptor so they can coordinate scheduling and the student's learning objectives.

Thank you for your partnership in supporting our students and unit.`
  const richBody =
    bH2('Unit Leader Support Request')
    + bP(`Dear ${fb(firstName, 'Colleague')}, a senior nursing student has been matched to your unit, [Unit], through ASPIRE at Cedars-Sinai. Thank you for supporting this placement.`)
    + bNote({ title: 'Support needed: a preceptor', body: 'The next step is identifying a preceptor for the student. Could you please share the details below? Once the preceptor is confirmed, I will connect them with [Student Name].' })
    + bDivider
    + bUL(['Preceptor name', 'Preceptor email', 'Shift or schedule, if known', 'Comfortable being introduced to the student? (yes / no)'])
    + bP("Once the preceptor is confirmed, I'll connect [Student Name] and the preceptor so they can coordinate scheduling and the student's learning objectives. Thank you for your partnership in supporting our students and unit.")
  return { subject, body, richBody }
}

// Interviewer Availability Request — internal Cedars/BNI email asking an interviewer colleague to
// access ASPIRE Intelligence and enter their interview availability. Brief and collegial. The
// "[ASPIRE Intelligence link]" stays a literal placeholder — never a generated or secure link.
export function buildInterviewerAvailabilityRequestDraft({ firstName } = {}) {
  const subject = 'ASPIRE: Interview availability requested'
  const body = `Dear ${fb(firstName, 'Colleague')},

We're beginning to plan ASPIRE student interviews and would appreciate your help.

When you have a moment, please log in to ASPIRE Intelligence and enter or update your interview availability:

[ASPIRE Intelligence link]

Your availability helps us coordinate the interview schedule and assign students to interviewers. If anything changes, you can update your availability at any time.

Thank you for being part of the ASPIRE interview team.`
  const richBody =
    bH2('Interviewer Availability Request')
    + bP(`Dear ${fb(firstName, 'Colleague')}, we're beginning to plan ASPIRE student interviews and would appreciate your help.`)
    + bNote({ title: 'Action needed', body: 'Please log in to ASPIRE Intelligence and enter or update your interview availability. Your availability helps us coordinate the interview schedule and assign students to interviewers.' })
    + bP('Open ASPIRE Intelligence: [ASPIRE Intelligence link]')
    + bP('If anything changes, you can update your availability at any time. Thank you for being part of the ASPIRE interview team.')
  return { subject, body, richBody }
}

// ── Send-to-Many manual bulk templates (Phase 2A) ───────────────────────────────
// Shared editable drafts for the multi-source bulk audience composer. Bodies carry NO closing
// or signature (the app signature supplies the close — see Phase 1C). Per-recipient first name
// and school are merged at preview/send only; every other [placeholder] (links, deadlines, unit,
// preceptor, rotation, dates, cohort name) stays literal and is edited once before sending.
// Static public links (/school-form, /student-form, /interview-schedule) remain editable
// placeholders in this UI-only phase.

const BULK_ACADEMIC_PARTNER = {
  subject: 'ASPIRE: Student Placement Request Form for [Cohort Name]',
  body: `Dear [Clinical Coordinator First Name],

I hope you are doing well.

We are preparing for the upcoming ASPIRE cohort at Cedars-Sinai and would like to invite your school to submit student placement requests for consideration.

Please complete the ASPIRE School Placement Request Form using the link below:

[Insert School Form Link]

This form allows us to collect your requested student placements, including student names, program details, preferred units, rotation requirements, dates, and any important notes that may help us review placement feasibility.

Please submit the form by [Insert Deadline], if possible, so we can review all requests alongside available unit capacity.

As a reminder, submission of a request does not guarantee placement. Placement decisions are based on unit capacity, preceptor availability, student eligibility, and program alignment.

To help ensure that you receive ASPIRE communications, including future updates regarding student progress, please add the following email address to your contact list or safe senders:

ASPIRE at Cedars-Sinai <noreply@aspire-program.com>

Thank you for your continued partnership in supporting clinical nursing education.`,
}

const BULK_STUDENT_PROFILE = {
  subject: 'ASPIRE: Complete Your Student Profile',
  body: `Dear [Student First Name],

Thank you for your interest in participating in ASPIRE, Affiliate Students' Pathway from Internship to Residency Experience, at Cedars-Sinai.

To help us review your information and prepare for the next steps, please complete your ASPIRE Student Profile Form using the link below:

[Insert Student Form Link]

Please complete the form by [Insert Deadline].

The form will ask for important information such as your contact details, school/program information, expected graduation timeline, availability, unit interests, and other details needed for placement review.

Please make sure that all information is accurate and complete. If your availability, contact information, or program status changes after submission, please notify the ASPIRE team as soon as possible.

Completion of the form does not guarantee placement. Final placement depends on student eligibility, school approval, unit capacity, preceptor availability, and program alignment.

Thank you, and we look forward to learning more about you.`,
}

const BULK_INTERVIEW_SCHEDULING = {
  subject: 'ASPIRE: Schedule Your Interview',
  body: `Dear [Student First Name],

Thank you for completing the ASPIRE student profile process.

We are now inviting you to schedule your ASPIRE interview. Please use the link below to select an available interview time:

[Insert Interview Schedule Link]

Interview appointments are based on the availability of our ASPIRE interviewers and may be filled on a first-come, first-served basis. Please select a time that you can attend reliably.

Before your interview, please be prepared to discuss:

• Your interest in ASPIRE
• Your clinical goals and learning objectives
• Your preferred areas of nursing practice
• Your readiness to participate in a senior nursing student rotation at Cedars-Sinai
• Your interest in future transition-to-practice opportunities, including the New Graduate RN Residency Program pathway, if applicable

Please complete your scheduling by [Insert Deadline].

If you have a scheduling conflict or cannot find an available time that works for you, please contact the ASPIRE team as soon as possible.

Thank you, and we look forward to meeting with you.`,
}

const BULK_ANNOUNCEMENT = {
  subject: 'ASPIRE: Acceptance and Orientation Next Steps',
  body: `Dear [Student First Name],

Congratulations. We are pleased to inform you that you have been accepted to participate in ASPIRE, Affiliate Students' Pathway from Internship to Residency Experience, at Cedars-Sinai.

We are excited to welcome you to this next step in your senior nursing student experience.

Your ASPIRE details are listed below:

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

• ASPIRE overview and expectations
• Shift log process and badge use
• Unit expectations and preceptor communication
• Patient confidentiality and professional expectations
• New Graduate RN Residency Program pathways

A few important reminders:

• You must attend orientation before beginning your ASPIRE shifts.
• You are expected to follow ASPIRE expectations for senior nursing students.
• You are expected to follow Cedars-Sinai policies and unit expectations at all times.
• You must maintain patient confidentiality at all times.
• You are expected to log your shifts accurately throughout the rotation.
• Please notify the ASPIRE team right away if you will no longer be moving forward for any reason.

New Graduate RN Residency Program Pathway

As part of ASPIRE, you may receive information about Cedars-Sinai's New Graduate RN Residency Program and related transition-to-practice opportunities. We encourage you to pay close attention to application timelines, eligibility requirements, and communications from the ASPIRE and NGRP teams.

To help ensure that you receive ASPIRE communications, please add the following email address to your contact list or safe senders:

ASPIRE at Cedars-Sinai <noreply@aspire-program.com>

We are excited to support your growth, learning, and transition into professional nursing practice.`,
}

// Academic Partner Acceptance / Orientation Update (bulk) — CONNECT-MANUAL-TEMPLATES-3. Bulk version
// of the Send-to-one Academic Partner Update: confirm acceptance + orientation next steps. First name
// merges via [Clinical Coordinator First Name]; every other placeholder stays literal and editable.
const BULK_ACADEMIC_PARTNER_ACCEPTANCE = {
  subject: 'ASPIRE: Student placement update and orientation next steps',
  body: `Dear [Clinical Coordinator First Name],

I'm writing with an update on your students' participation in ASPIRE at Cedars-Sinai.

The following student(s) have been accepted and are moving forward in the ASPIRE process:

[Insert accepted student names and relevant details here.]

As a next step, students will be invited to the required in-person orientation before they begin their shifts. We will send each student the orientation date, location, parking, and arrival details directly.

You are warmly invited to attend the orientation or to stay looped in as appropriate for your program. If you would like to join, please let us know.

To help ensure that you receive ASPIRE communications, including future updates regarding student progress, please add the following email address to your contact list or safe senders:

ASPIRE at Cedars-Sinai <noreply@aspire-program.com>

Thank you for your continued partnership in supporting clinical nursing education.`,
}

// Interviewer Availability / App Access Request (bulk) — CONNECT-MANUAL-TEMPLATES-3. Asks BNI /
// interviewer colleagues to access ASPIRE Intelligence and enter availability. First name merges via
// [First Name]; "[ASPIRE Intelligence link]" stays a literal placeholder (never a generated link).
const BULK_INTERVIEWER_AVAILABILITY = {
  subject: 'ASPIRE: Interview availability requested',
  body: `Dear [First Name],

We are beginning to plan ASPIRE student interviews and would appreciate your help.

Please log in to ASPIRE Intelligence and enter or update your interview availability:

[ASPIRE Intelligence link]

Your availability will be used to coordinate the interview schedule and assign students to interviewers. If anything changes, you can update your availability at any time.

Thank you for being part of the ASPIRE interview team.`,
}

// Keyed registry for the Send-to-Many message-type selector.
const BULK_TEMPLATES = {
  academic_partner_placement:           BULK_ACADEMIC_PARTNER,
  academic_partner_acceptance_orientation: BULK_ACADEMIC_PARTNER_ACCEPTANCE,
  student_profile_invitation:           BULK_STUDENT_PROFILE,
  student_interview_scheduling:         BULK_INTERVIEW_SCHEDULING,
  interviewer_availability_bulk:        BULK_INTERVIEWER_AVAILABILITY,
  announcement_broadcast:               BULK_ANNOUNCEMENT,
}

// Returns a fresh { subject, body } for a bulk template key, or null for an unknown key.
export function buildBulkTemplate(key) {
  const tpl = BULK_TEMPLATES[key]
  return tpl ? { subject: tpl.subject, body: tpl.body } : null
}
