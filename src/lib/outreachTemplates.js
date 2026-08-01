// src/lib/outreachTemplates.js
//
// MANUAL-OUTREACH-TEMPLATE-LIBRARY - copy builders for single-recipient manual templates.
// Both hydrate the editable in-app Direct Message composer (ASPIRE Outreach send) and are ALWAYS
// editable before sending. Copy is safe-draft with clear [placeholders] and fallbacks; the owner
// customizes the final wording. No tokens, secure links, or documents are embedded.
//
// NO closing or signature lives in these bodies. The app's "Include my email signature" behavior
// (server-side, see lib/server/connect/emailTemplates.js) appends the closing "Warm regards," and
// the resolved sender signature, so templates end at body content to avoid a duplicate closing.
// Callers hydrate these with includeSignature=true.

import { appUrl } from './appUrl.js'

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
// Linked Button block (RICH-COMPOSE-2A-2). The url may be a [static link token]: the composer's
// withStaticLinks substitution resolves it to the full public URL before the editor hydrates, and the
// server validates the final URL (https only) at render time.
const bButton = ({ label, url }) =>
  `<div data-aspire-block="button" data-label="${escAttr(label)}" data-url="${escAttr(url)}"></div>`
// (bEvent available for future date/time templates; unused here since none carry fixed event details.)

// Preceptor Assignment - internal Cedars email, sent through the in-app Direct Message flow.
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

// ── Academic Partner Acceptance / Orientation - ONE shared factory for Send-to-one AND Send-to-many.
// ASPIRE-EMAIL-PARTNER-ORIENTATION-1: unifies the former divergent one/many copies. The message
// communicates: students accepted, orientation now being planned, a warm invitation to attend or stay
// looped in, what orientation is for, student expectations, a save-the-contact reminder (so weekly
// updates do not land in spam), and a direct contact line. NO risky "[Insert ...]" placeholders and
// NO leakable raw merge token. Greeting: mode 'one' resolves the recipient's first name now (safe
// fallback when missing); mode 'many' uses the always-resolving [Clinical Coordinator Greeting] token
// (applyMergeFields turns it into "Good morning {name}," or "Good morning,"). Orientation details are
// a configurable block: an editable Content Block Note in the rich (Send-to-one) layout, and a plain
// paragraph with the same default text otherwise. Rich Content Blocks are only wired into Send-to-one;
// Send-to-many uses the plain body (the bulk composer converts it to HTML paragraphs) - see report.
const AP_ORIENTATION_SUBJECT = 'ASPIRE: Student acceptance and orientation next steps'
const AP_ORIENTATION_DEFAULT = 'Orientation details are being finalized. We will share the confirmed date, time, location or meeting link, and any check-in instructions once available.'

export function buildAcademicPartnerAcceptanceOrientation({ mode = 'one', firstName } = {}) {
  const subject  = AP_ORIENTATION_SUBJECT
  const greeting = mode === 'many'
    ? '[Clinical Coordinator Greeting]'
    : (fb(firstName, '') ? `Good morning ${fb(firstName, '')},` : 'Good morning,')

  const pAccepted = 'I hope you are doing well. I am writing to share that your students have been accepted to ASPIRE at Cedars-Sinai and are moving forward in the placement process.'
  const pPurpose  = 'We are now planning orientation for the accepted students. Orientation is designed to help students understand ASPIRE expectations, onboarding steps, communication pathways, scheduling responsibilities, and how to prepare for a successful transition into their assigned units.'
  const pInvite   = 'You are warmly invited to attend or stay looped in, whichever is best for your program. Your involvement helps reinforce school-specific expectations and supports a consistent transition for students as they begin ASPIRE.'
  const pExpect   = 'Student expectations include completing required onboarding items on time, monitoring ASPIRE emails, communicating promptly, attending scheduled orientation activities, and following Cedars-Sinai and school requirements throughout the placement process.'
  const pSave     = 'To make sure ASPIRE updates reach you, please add ASPIRE at Cedars-Sinai (noreply@aspire-program.com) to your contacts or safe-sender list.'
  const pContact  = 'For any questions, please email Jester directly at jesterlloyd.bautista@cshs.org.'
  const pClose    = 'Thank you for your continued partnership.'

  const body = `${greeting}

${pAccepted}

${pPurpose}

${pInvite}

${AP_ORIENTATION_DEFAULT}

${pExpect}

${pSave}

${pContact}

${pClose}`

  // Rich Content Block layout for BOTH modes (Send-to-one hydrates it directly; Send-to-many hydrates
  // it too now that the bulk composer supports richBody). The greeting carries through as-is: mode
  // 'one' is already resolved; mode 'many' keeps the [Clinical Coordinator Greeting] token (bP escapes
  // only < > &, so the bracket token survives and applyMergeFields resolves it per recipient at send).
  const richBody =
    bH2('Student acceptance and orientation next steps')
    + bP(`${greeting} ${pAccepted}`)
    + bP(pPurpose)
    + bP(pInvite)
    + bNote({ title: 'Orientation details', body: AP_ORIENTATION_DEFAULT })
    + bP(pExpect)
    + bNote({ title: 'Save the ASPIRE contact', body: pSave })
    + bP(`${pContact} ${pClose}`)
  return { subject, body, richBody }
}

// Send-to-one entry (registry KEY preserved as 'coordinator_acceptance' for draft/routing
// compatibility). Salutation uses the recipient's first name when available, else a plain greeting.
export function buildAcademicPartnerUpdateDraft({ firstName } = {}) {
  return buildAcademicPartnerAcceptanceOrientation({ mode: 'one', firstName })
}

// Preceptor Details Request - internal Cedars email asking the preceptor for the information needed
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
• A photo we can share with the student, if you're comfortable, this is completely optional
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

// Unit Leader Support Request - internal Cedars email asking the unit leader for a preceptor name
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

// Interviewer Availability Request - internal Cedars/BNI email asking an interviewer colleague to
// access ASPIRE Intelligence and enter their interview availability. Brief and collegial. The
// "[ASPIRE Intelligence link]" stays a literal placeholder - never a generated or secure link.
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
// or signature (the app signature supplies the close - see Phase 1C). Per-recipient first name
// and school are merged at preview/send only; every other [placeholder] (links, deadlines, unit,
// preceptor, rotation, dates, cohort name) stays literal and is edited once before sending.
// Static public links (/school-form, /student-form, /interview-schedule) remain editable
// placeholders in this UI-only phase.

// ASPIRE-CONNECT-BULK-RICH-TEMPLATES-1: cleaned Academic Partner Placement Request. Drops the former
// leak-prone placeholders (a cohort token in the subject, a raw first-name salutation, and a bracketed
// deadline) in favor of the always-resolving Clinical Coordinator Greeting token plus the real
// canonical school-form link. Ships both a plain body (readable fallback) and a richBody (heading and a
// Submission timeline Note block) hydrated by the bulk composer when rich compose is on.
const BULK_ACADEMIC_PARTNER = (() => {
  const subject = 'ASPIRE: Student Placement Request Form'
  const link    = appUrl('/school-form')
  const greeting = '[Clinical Coordinator Greeting]'
  const pIntro   = 'I hope you are doing well.'
  const pInvite  = 'We are preparing for the upcoming ASPIRE cohort at Cedars-Sinai and would like to invite your school to submit student placement requests for consideration.'
  const pForm    = 'Please complete the ASPIRE School Placement Request Form using the link below:'
  const pWhat    = 'This form allows us to collect requested student placements, including student names, program details, preferred units, rotation requirements, dates, and any important notes that may help us review placement feasibility.'
  const pTimeline = 'Please submit the form by the timeline shared for your cohort, if possible, so we can review all requests alongside available unit capacity.'
  const pDisc    = 'As a reminder, submission of a request does not guarantee placement. Placement decisions are based on unit capacity, preceptor availability, student eligibility, and program alignment.'
  const pSave    = 'To help ensure that you receive ASPIRE communications, including future updates regarding student progress, please add ASPIRE at Cedars-Sinai (noreply@aspire-program.com) to your contacts or safe-sender list.'
  const pContact = 'For any questions, please email Jester directly at jesterlloyd.bautista@cshs.org.'
  const pClose   = 'Thank you for your continued partnership.'

  const body = `${greeting}

${pIntro}

${pInvite}

${pForm}

${link}

${pWhat}

${pTimeline}

${pDisc}

${pSave}

${pContact}

${pClose}`

  const richBody =
    bH2('Student placement request')
    + bP(`${greeting} ${pIntro}`)
    + bP(pInvite)
    + bP(`${pForm} ${link}`)
    + bP(pWhat)
    + bNote({ title: 'Submission timeline', body: pTimeline })
    + bP(pDisc)
    + bNote({ title: 'Save the ASPIRE contact', body: pSave })
    + bP(`${pContact} ${pClose}`)

  return { subject, body, richBody }
})()

// ASPIRE-DESIGN-CORRECTION-1 (Owner-directed, 2026-07-29): exact approved copy with a full Tiptap
// Content Block layout (heading hierarchy, Complete Your Form button, divider, What Happens Next
// section). No greeting line by design. The plain body mirrors the same copy for non-rich composers.
const BULK_STUDENT_PROFILE = (() => {
  const subject = 'Cedars-Sinai | Complete Your ASPIRE Intake Form'
  const pThanks   = "Thank you for your interest in participating in ASPIRE, Affiliate Students' Pathway from Internship to Residency Experience, at Cedars-Sinai."
  const pForm     = 'To help us review your information and prepare for the next steps, please complete your ASPIRE Student Profile Form using the link below:'
  const pDeadline = 'Please complete the form by [Insert Deadline].'
  const pDisc     = 'Completion of the form does not guarantee placement. Final placement depends on student eligibility, school approval, unit capacity, preceptor availability, and program alignment.'
  const pNext     = 'After you submit, our team will invite you to a brief interview with Nursing Professional Development. From there, we will collaborate with unit leaders to match you with a unit and preceptor, then schedule you for orientation.'
  const pPrivate  = 'This link is for your use only. Please do not share or forward this email.'
  const pContact  = "If you have any questions, email aspire@cshs.org. We're here to help."
  const pClose    = 'Thank you, and we look forward to learning more about you.'

  const body = `${pThanks}

${pForm}

[Insert Student Form Link]

${pDeadline}

${pDisc}

What Happens Next

${pNext}

${pPrivate}

${pContact}

${pClose}`

  const richBody =
    bH2('Complete Your ASPIRE Intake Form')
    + bP(pThanks)
    + bP(pForm)
    + bButton({ label: 'Complete Your Form', url: '[Insert Student Form Link]' })
    + bP(pDeadline)
    + bP(pDisc)
    + bDivider
    + bH2('What Happens Next')
    + bP(pNext)
    + bP(pPrivate)
    + bP(pContact)
    + bP(pClose)

  return { subject, body, richBody }
})()

// CONNECT-SCHEDULING-LINK-1 (Owner copy, 2026-07-31): the Interview Scheduling Link email, and the
// template the two scheduling-link actions launch (Interviews worklist, Student Profiles). Rebuilt as
// a Content Block layout with a prominent "Schedule Interview" button; the URL rides the existing
// [Insert Interview Schedule Link] static-link token, which BulkManualComposer resolves to the public
// /interview-schedule route before the editor hydrates.
//
// The body deliberately ends at the contact line: the closing and signature are appended server-side
// by "Include my email signature" (see this file's header), so a literal "Kind regards," + signature
// here would duplicate them.
//
// The previous longer copy (first-come-first-served note, interview-prep bullets, [Insert Deadline])
// is retired with this rewrite - see the release notes for the Owner decision.
const BULK_INTERVIEW_SCHEDULING = (() => {
  const subject = 'Schedule Your ASPIRE Interview'

  const pThanks  = 'Thank you for completing your ASPIRE Student Profile. The next step is to schedule your interview with the Nursing Professional Development team.'
  const pUse     = 'Please use the button below to view available times and select one that works for your schedule.'
  const pPrompt  = 'When prompted, enter your school email address to access your scheduling page.'
  const pTeams   = 'Your interview will be conducted through Microsoft Teams. The meeting link will be sent separately after you book your interview slot.'
  const pContact = 'If you have any questions, please contact us at aspire@cshs.org.'

  const body = `Dear [Student First Name],

${pThanks}

${pUse}

[Insert Interview Schedule Link]

${pPrompt}

${pTeams}

${pContact}`

  const richBody =
    bH2('Schedule Your ASPIRE Interview')
    + bP('Dear [Student First Name],')
    + bP(pThanks)
    + bP(pUse)
    + bButton({ label: 'Schedule Interview', url: '[Insert Interview Schedule Link]' })
    + bP(pPrompt)
    + bP(pTeams)
    + bP(pContact)

  return { subject, body, richBody }
})()

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

// Academic Partner Acceptance / Orientation Update (bulk). ASPIRE-EMAIL-PARTNER-ORIENTATION-1: now
// the Send-to-many mode of the ONE shared factory above, so one/many stay in lockstep. Greeting uses
// the always-resolving [Clinical Coordinator Greeting] token (no raw first-name token can leak); no
// "[Insert ...]" placeholder; includes the save-the-contact reminder in the plain body.
const BULK_ACADEMIC_PARTNER_ACCEPTANCE = buildAcademicPartnerAcceptanceOrientation({ mode: 'many' })

// Interviewer Availability / App Access Request (bulk) - CONNECT-MANUAL-TEMPLATES-3. Asks BNI /
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

// Unit Leader Capacity Request (bulk) - CAPACITY-RESPONSE-OUTREACH-2, copy + layout corrected by
// ASPIRE-DESIGN-CORRECTION-1 (Owner-directed, 2026-07-29): exact approved copy with a full Tiptap
// Content Block layout (heading hierarchy, Unit Form button, why-hosting bullets). The cohort and
// rotation-window blanks ("_____") are intentional Owner fill-ins from the approved copy. The
// subject stays cohort-aware ("[Cohort]" resolves in the composer: launch-context cohort name, else
// a neutral fallback) and "[Insert Unit Form Link]" resolves to the public /unit-form route via the
// composer's static-link substitution.
const BULK_UNIT_CAPACITY = (() => {
  const subject = 'ASPIRE: Unit Capacity Response Request | [Cohort]'
  const pDear    = 'Dear Unit Leaders,'
  const pIntro   = "As we get ready for our _____ ASPIRE cohort, we'd love to know if your unit is able to host senior nursing students for their 1-on-1 bedside clinical rotation."
  const pWindow  = 'The rotation window is:'
  const pWindowRange = '_____ to _____'
  const pAsk     = "Whether or not you're able to host this round, we ask that you submit your response, so we know how to plan:"
  const pNotThisTime = 'Even a "not this time" is genuinely helpful, since it lets us match students to units that have the capacity and interest right now.'
  const hWhy     = 'A quick word on why hosting is worth it:'
  const whyBullets = [
    'These are senior students in their final semester, and many of them go on to become strong new-graduate candidates for your own unit.',
    'Precepting one gives you an early, extended look at how a potential future hire thinks, works, and fits your team, long before a formal interview ever happens.',
    'It also strengthens your preceptors, who often tell us that teaching a student sharpens their own practice.',
    'It keeps your unit connected to the pipeline that has become one of our most reliable sources of new graduate nurses.',
  ]
  const pContact = 'If you have any questions please email us directly at aspire@cshs.org.'
  const pClose   = 'Thank you for everything you do for our students.'

  const body = `${pDear}

${pIntro}

${pWindow}

${pWindowRange}

${pAsk}

[Insert Unit Form Link]

${pNotThisTime}

${hWhy}

${whyBullets.map(b => `• ${b}`).join('\n')}

${pContact}

${pClose}`

  const richBody =
    bH2('ASPIRE Unit Capacity Request')
    + bP(pDear)
    + bP(pIntro)
    + bP(pWindow)
    + bUL([pWindowRange])
    + bP(pAsk)
    + bButton({ label: 'Unit Form', url: '[Insert Unit Form Link]' })
    + bP(pNotThisTime)
    + bH2(hWhy)
    + bUL(whyBullets)
    + bP(pContact)
    + bP(pClose)

  return { subject, body, richBody }
})()

// Unit Leader Capacity Reminder (bulk) - CAPACITY-FILTER-REMINDER-1, Owner-approved copy. A gentle
// follow-up to units still pending on the cohort's capacity request. Same Content Block treatment
// as the request (heading, bolded rotation window, Complete Unit Response button resolving to
// /unit-form); the cohort and rotation-window blanks ("_____") are intentional Owner fill-ins, and
// the subject stays cohort-aware. Sending a reminder never changes target or response status.
const BULK_UNIT_CAPACITY_REMINDER = (() => {
  const subject = 'ASPIRE: Unit Capacity Response Reminder | [Cohort]'
  const pDear   = 'Dear Unit Leaders,'
  const pIntro  = "This is a friendly reminder to submit your unit's response for the _____ ASPIRE cohort."
  const pWhy    = 'Even if your unit is unable to host students during this rotation, your response is important and helps us plan placements accurately.'
  const windowLabel = 'Rotation window:'
  const windowRange = '_____ to _____'
  const pThanks = 'Thank you for taking a moment to respond and for your continued support of our students.'
  const pContact = 'If you have any questions, please contact us at aspire@cshs.org.'
  const pClose  = 'Thank you for everything you do for our students.'

  const body = `${pDear}

${pIntro}

${pWhy}

${windowLabel} ${windowRange}

[Insert Unit Form Link]

${pThanks}

${pContact}

${pClose}`

  const richBody =
    bH2('ASPIRE Unit Capacity Request Reminder')
    + bP(pDear)
    + bP(pIntro)
    + bP(pWhy)
    + `<p><strong>${escTxt(windowLabel)}</strong> ${escTxt(windowRange)}</p>`
    + bButton({ label: 'Complete Unit Response', url: '[Insert Unit Form Link]' })
    + bP(pThanks)
    + bP(pContact)
    + bP(pClose)

  return { subject, body, richBody }
})()

// Keyed registry for the Send-to-Many message-type selector.
const BULK_TEMPLATES = {
  academic_partner_placement:           BULK_ACADEMIC_PARTNER,
  academic_partner_acceptance_orientation: BULK_ACADEMIC_PARTNER_ACCEPTANCE,
  student_profile_invitation:           BULK_STUDENT_PROFILE,
  student_interview_scheduling:         BULK_INTERVIEW_SCHEDULING,
  interviewer_availability_bulk:        BULK_INTERVIEWER_AVAILABILITY,
  announcement_broadcast:               BULK_ANNOUNCEMENT,
  unit_capacity_response_request:       BULK_UNIT_CAPACITY,
  unit_capacity_response_reminder:      BULK_UNIT_CAPACITY_REMINDER,
}

// Returns a fresh { subject, body } for a bulk template key, or null for an unknown key.
export function buildBulkTemplate(key) {
  const tpl = BULK_TEMPLATES[key]
  // richBody (Content Block HTML) is present only on templates that ship one; the bulk composer
  // hydrates it when rich compose is on, else falls back to the plain `body`. undefined otherwise.
  return tpl ? { subject: tpl.subject, body: tpl.body, richBody: tpl.richBody } : null
}
