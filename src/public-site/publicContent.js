// src/public-site/publicContent.js
//
// PHASE1-PUBLIC-SITE: every string on the public site lives here, in one
// reviewable module, so copy changes never touch layout code and a future
// governed content interface (Phase 5) can replace this file wholesale.
//
// Copy discipline (see reference source and PHASE_0A planning constraints):
//   - Only "likely public-safe after approval" content blocks are used.
//   - NO outcome metrics, NO partner school names, NO team names or bios,
//     NO Magnet or PTAP language, NO health-clearance detail, NO internal
//     workflow references, NO public email address (mailbox approval pending).
//   - "ASPIRE" is never written as "ASPIRE Program".
//   - The whole site ships noindex until Cedars-Sinai communications approves
//     public indexing (meta tag in index.html).

export const SITE_NAME = 'ASPIRE at Cedars-Sinai'

export const NAV_LINKS = [
  { path: '/about',       label: 'About' },
  { path: '/eligibility', label: 'Eligibility' },
  { path: '/apply',       label: 'How to Apply' },
  { path: '/experience',  label: 'The Experience' },
  { path: '/preceptors',  label: 'For Preceptors' },
  { path: '/faq',         label: 'FAQ' },
  { path: '/contact',     label: 'Contact' },
]

export const HOME = {
  heroKicker: 'Cedars-Sinai Nursing',
  heroTitle: 'Finish your nursing degree where you want to begin your career.',
  heroBody:
    'ASPIRE, the Affiliate Students’ Pathway from Internship to Residency Experience, ' +
    'is Cedars-Sinai’s pathway for senior nursing students, including current Cedars-Sinai ' +
    'employees, to complete a hands-on bedside clinical rotation in a specialized unit while ' +
    'paired with an experienced preceptor.',
  heroPrimaryCta:   { path: '/eligibility', label: 'See if you are eligible' },
  heroSecondaryCta: { path: '/apply',       label: 'How to apply' },
  glanceTitle: 'ASPIRE at a glance',
  glanceCards: [
    { title: 'Hands-on bedside hours',   body: 'A minimum of 90 hours of direct patient care during your final rotation.' },
    { title: 'Specialized unit placement', body: 'Placement in a specialized unit aligned with your clinical interests when possible.' },
    { title: 'A dedicated preceptor',    body: 'One experienced RN preceptor supports your growth throughout the rotation.' },
    { title: 'Professional development', body: 'Nursing Professional Development practitioners support you from start to finish.' },
    { title: 'A residency pathway',      body: 'ASPIRE strengthens your preparation for the New-Graduate RN Residency at Cedars-Sinai.' },
  ],
  stepsTitle: 'How ASPIRE works',
  steps: [
    { title: 'Talk to your placement coordinator', body: 'Tell your school’s placement coordinator you are interested in a senior rotation at Cedars-Sinai through ASPIRE. The coordinator confirms your eligibility with the ASPIRE team.' },
    { title: 'Complete the intake form',           body: 'Once your school confirms eligibility, you receive an intake form covering your unit preferences, interests, goals, and scheduling.' },
    { title: 'Have a brief conversation',          body: 'The ASPIRE team meets with you to discuss placement fit, your learning objectives, and unit availability.' },
  ],
  preceptorBandTitle: 'Experienced nurses: help shape the next generation.',
  preceptorBandBody:  'ASPIRE preceptors mentor senior nursing students through their final rotation, with structured support from Nursing Professional Development.',
  preceptorBandCta:   { path: '/preceptors', label: 'Learn about precepting' },
}

export const ABOUT = {
  title: 'About ASPIRE',
  intro:
    'The Affiliate Students’ Pathway from Internship to Residency Experience, or ASPIRE, ' +
    'is Cedars-Sinai’s pathway for senior nursing students to complete hands-on bedside ' +
    'clinical rotations in specialized units while paired with experienced preceptors.',
  sections: [
    {
      heading: 'What ASPIRE is designed to do',
      bullets: [
        'Build clinical confidence before graduation',
        'Sharpen bedside skills in a specialty area of interest',
        'Support the transition into professional nursing practice',
        'Strengthen preparation for the New-Graduate RN Residency',
      ],
    },
    {
      heading: 'Why Cedars-Sinai offers ASPIRE',
      body:
        'Academic-practice partnerships strengthen nursing pipelines. Structured transitions ' +
        'from student to professional practice can support confidence, competence, readiness ' +
        'for practice, and long-term retention in the nursing workforce.',
    },
    {
      heading: 'Support throughout the rotation',
      body:
        'Students in ASPIRE are supported by Nursing Professional Development practitioners, ' +
        'their unit’s leadership, and a dedicated preceptor. Support includes unit rounding, ' +
        'coaching, and check-ins across the rotation.',
    },
  ],
}

export const ELIGIBILITY = {
  title: 'Eligibility',
  intro: 'Applicants should meet all applicable criteria below. Your school’s placement coordinator confirms eligibility with the ASPIRE team.',
  checklistHeading: 'Eligibility checklist',
  checklist: [
    'Be in the final semester of an accredited nursing program affiliated with Cedars-Sinai',
    'Be enrolled in an eligible program type (listed below)',
    'Complete a hands-on bedside clinical rotation involving direct patient care',
    'Have a cumulative GPA of 3.0 or higher on a 4.0 scale',
    'Complete a minimum of 90 hours in a direct patient-care role under preceptor supervision',
    'Meet the educational, health, safety, and background requirements established by both Cedars-Sinai and your nursing school',
  ],
  programsHeading: 'Eligible academic programs',
  programs: [
    'Bachelor of Science in Nursing (semester, trimester, or quarter formats)',
    'Accelerated Bachelor of Science in Nursing',
    'Licensed Vocational Nurse to Bachelor of Science in Nursing',
    'Master’s Entry Clinical Nurse',
    'Entry-Level Master’s in Nursing',
  ],
  limitationHeading: 'An important limitation',
  limitationBody:
    'Leadership rotations and observation-only rotations do not meet ASPIRE criteria. ' +
    'The rotation must include direct patient care.',
  requirementsNote:
    'Detailed educational, health, and safety requirements are provided through your ' +
    'school’s placement coordinator during eligibility verification, and are subject ' +
    'to change under Cedars-Sinai policy.',
}

export const APPLY = {
  title: 'How to apply',
  intro: 'Applying to ASPIRE starts at your school, not with an application portal.',
  steps: [
    {
      title: 'Step 1: Notify your school’s placement coordinator',
      body:
        'Tell your placement coordinator you are interested in completing your senior rotation ' +
        'at Cedars-Sinai through ASPIRE. The coordinator helps confirm your school’s ' +
        'affiliation, your final-semester status, your rotation requirements, and both ' +
        'school-specific and Cedars-Sinai prerequisites.',
    },
    {
      title: 'Step 2: Complete the intake form',
      body:
        'After your school confirms eligibility, you receive an intake form from the ASPIRE ' +
        'team. It collects your unit preferences, specialty interests, career goals, learning ' +
        'goals, and scheduling information. Your placement coordinator may support you in ' +
        'completing it.',
    },
    {
      title: 'Step 3: Participate in a brief conversation',
      body:
        'The ASPIRE team meets with you to discuss your preferences, interests, goals, and ' +
        'learning objectives, along with placement fit and unit availability. Placement ' +
        'decisions consider both your interests and organizational workforce needs.',
    },
  ],
}

export const EXPERIENCE = {
  title: 'The student experience',
  intro: 'ASPIRE is built around hands-on practice, mentorship, and a supported transition into professional nursing.',
  bullets: [
    'Hands-on patient care in a specialized unit',
    'Placement aligned with your clinical interests when possible',
    'Mentorship from an experienced RN preceptor',
    'Nursing Professional Development support throughout the rotation',
    'Unit rounding and coaching',
    'Professional connections with nurses, leaders, and peers',
    'Exposure to the transition from student nurse to professional nurse',
  ],
  continuityHeading: 'Preceptor continuity',
  continuityBody:
    'Continuity is the preferred model. Students are generally assigned one primary preceptor ' +
    'to support relationship development, consistency, progressive learning, and reliable ' +
    'feedback. When staffing or scheduling requires temporary or secondary preceptor support, ' +
    'the change is coordinated with Nursing Professional Development.',
}

export const PRECEPTORS = {
  title: 'For preceptors',
  intro:
    'ASPIRE needs experienced nurses and advanced practice nurses who are passionate about ' +
    'developing the next generation of nurses.',
  benefitsHeading: 'What precepting can offer you',
  benefits: [
    'Structured mentorship experience',
    'Nursing Professional Development support and dedicated resources',
    'Leadership and coaching development',
    'Professional growth',
    'A direct contribution to the nursing workforce pipeline',
    'The opportunity to shape a new nurse’s career',
  ],
  ctaHeading: 'Interested in becoming an ASPIRE preceptor?',
  ctaBody:
    'Let your unit leadership know you are interested, or reach out to the ASPIRE team ' +
    'through Nursing Professional Development at Cedars-Sinai.',
}

export const FAQ = {
  title: 'Frequently asked questions',
  items: [
    {
      q: 'My program requires a leadership or observational rotation. Can I still participate in ASPIRE?',
      a: 'No. ASPIRE requires a hands-on bedside clinical rotation involving direct patient care. Students completing leadership or observation-only rotations may still explore other residency pathways after graduation if they meet those pathways’ requirements.',
    },
    {
      q: 'Can current Cedars-Sinai employees participate in ASPIRE?',
      a: 'Yes. Current employees in clinical, administrative, or support roles who meet all eligibility criteria may apply. Your current job classification does not determine eligibility.',
    },
    {
      q: 'How is unit placement determined?',
      a: 'Placement is based on your clinical interests, career goals, and learning objectives, together with unit availability, preceptor availability, and workforce needs. The ASPIRE conversation helps clarify your preferences and potential placement options.',
    },
    {
      q: 'Will I have the same preceptor throughout the rotation?',
      a: 'Continuity is the preferred model, and students are generally assigned one primary preceptor. When staffing or scheduling needs require temporary or secondary preceptor support, the change is coordinated with Nursing Professional Development.',
    },
    {
      q: 'Do I need an RN license before starting the residency?',
      a: 'Yes. An RN license is required before beginning the New-Graduate RN Residency. Confirm current timing and licensure requirements with the residency team through your coordinator.',
    },
    {
      q: 'Is ASPIRE the only path into the residency?',
      a: 'No. ASPIRE is one pathway into the New-Graduate RN Residency, but it is not the only one. Applicants who meet the requirements of other residency pathways may still apply.',
    },
  ],
}

export const CONTACT = {
  title: 'Contact',
  sections: [
    {
      heading: 'Students and schools',
      body:
        'Start with your school’s placement coordinator. Coordinators work directly with ' +
        'the ASPIRE team on eligibility, requirements, and placement, and they are the fastest ' +
        'route to an answer about your specific situation.',
    },
    {
      heading: 'Cedars-Sinai employees and clinicians',
      body:
        'Current Cedars-Sinai employees pursuing a nursing degree, and nurses interested in ' +
        'precepting, can reach the ASPIRE team through Nursing Professional Development.',
    },
  ],
  loginNote: 'Program participants and partners with an ASPIRE Intelligence account can sign in from the Log in link above.',
}

export const FOOTER = {
  disclaimer:
    'Program details are subject to change and are confirmed through your school’s ' +
    'placement coordinator.',
  // Institute naming, team bios, partner schools, metrics, and a public email
  // address are all withheld pending approval (Owner decision list, Phase 1).
  attribution: '© Cedars-Sinai. ASPIRE is a nursing workforce pathway at Cedars-Sinai.',
}
