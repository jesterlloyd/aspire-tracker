// src/public-site/publicContent.js
//
// PHASE1-PUBLIC-SITE (elevated): every string on the public site lives here, in
// one reviewable module, so copy changes never touch layout code and a future
// governed content interface (Phase 5) can replace this file wholesale.
//
// Copy discipline (see reference source and planning constraints):
//   - Only "likely public-safe after approval" content blocks are used.
//   - NO outcome metrics, NO partner school names, NO team names or bios,
//     NO testimonials, NO Magnet or PTAP language, NO health-clearance detail,
//     NO internal workflow references, NO public email address (mailbox
//     approval pending).
//   - "ASPIRE" is never written as "ASPIRE Program".
//   - The formal residency name is always "New Graduate RN Residency Program".
//   - No language implies guaranteed placement, employment, or residency
//     admission, or a single preceptor for every shift.
//   - The whole site ships noindex until Cedars-Sinai communications approves
//     public indexing (meta tag in index.html).

export const SITE_NAME = 'ASPIRE at Cedars-Sinai'
export const SITE_TITLE = 'ASPIRE at Cedars-Sinai | Senior Nursing Student Clinical Pathway'

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
  heroEyebrow: 'ASPIRE at Cedars-Sinai',
  heroTitle: 'Finish your nursing degree where you want to begin your career.',
  heroBody:
    'ASPIRE, the Affiliate Students’ Pathway from Internship to Residency Experience, ' +
    'is Cedars-Sinai’s pathway for senior nursing students, including current Cedars-Sinai ' +
    'employees, to complete a hands-on bedside clinical rotation in a specialized unit while ' +
    'paired with an experienced preceptor.',
  heroPrimaryCta:   { path: '/eligibility', label: 'See if you are eligible' },
  heroSecondaryCta: { path: '/apply',       label: 'How to apply' },

  audienceTitle: 'Find your pathway',
  audienceIntro: 'ASPIRE connects four groups around one shared goal: a strong, well-supported start to nursing practice.',
  audiences: [
    {
      icon: 'cap',
      title: 'Nursing Students',
      body: 'Senior students seeking hands-on bedside experience and a strong start to their career.',
      cta: { path: '/eligibility', label: 'Explore your pathway' },
    },
    {
      icon: 'mentor',
      title: 'Preceptors',
      body: 'Experienced nurses ready to mentor and shape the next generation of caregivers.',
      cta: { path: '/preceptors', label: 'Learn about precepting' },
    },
    {
      icon: 'hospital',
      title: 'Unit Leaders',
      body: 'Partner with ASPIRE to build your team and strengthen the nursing workforce.',
      cta: { path: '/contact', label: 'Partner with ASPIRE' },
    },
    {
      icon: 'handshake',
      title: 'Academic Partners',
      body: 'Collaborate with Cedars-Sinai to support student success and clinical excellence.',
      cta: { path: '/contact', label: 'Work together' },
    },
  ],

  glanceTitle: 'ASPIRE at a glance',
  glanceIntro: 'What a senior rotation through ASPIRE offers.',
  glanceCards: [
    { icon: 'clock',       stat: '90+', title: 'Bedside clinical hours', body: 'Hands-on direct patient care in a specialized unit. Your nursing school may require more.' },
    { icon: 'compass',     title: 'Specialty-aligned placement', body: 'Placement in a unit that aligns with your clinical interests whenever possible.' },
    { icon: 'stethoscope', title: 'Dedicated preceptor support', body: 'A primary preceptor supports your growth throughout the rotation.' },
    { icon: 'heart',       title: 'NPD guidance throughout', body: 'Nursing Professional Development (NPD) practitioners support you from start to finish.' },
  ],
  glanceNote: 'Complete at least 90 hours of hands-on bedside clinical practice, or the greater number of hours required by your nursing school.',

  journeyTitle: 'The ASPIRE journey',
  journeyIntro: 'Six steps from your school to your first year of practice.',
  journey: [
    { icon: 'school',      title: 'School confirms eligibility', body: 'Your placement coordinator confirms your eligibility and program requirements with the ASPIRE team.' },
    { icon: 'form',        title: 'Student completes intake',    body: 'You complete the ASPIRE intake form covering your goals, interests, and preferences.' },
    { icon: 'chat',        title: 'ASPIRE conversation',         body: 'The ASPIRE team meets with you to discuss placement fit and learning objectives.' },
    { icon: 'match',       title: 'Unit and preceptor match',    body: 'You are matched with a unit and preceptor based on fit and availability.' },
    { icon: 'pulse',       title: 'Clinical rotation',           body: 'You complete your hands-on rotation with mentorship and Nursing Professional Development support.' },
    { icon: 'cap',         title: 'Residency application opportunity', body: 'ASPIRE strengthens your preparation to apply to the New Graduate RN Residency Program.' },
  ],
  journeyNote: 'ASPIRE strengthens your preparation for the New Graduate RN Residency Program. It does not guarantee placement, employment, or residency admission.',

  preceptorBandEyebrow: 'For Preceptors',
  preceptorBandTitle: 'Help shape the next generation of exceptional nurses.',
  preceptorBandBody:  'Share your expertise. Inspire future colleagues. Strengthen our profession, with structured support from Nursing Professional Development.',
  preceptorBandCta:   { path: '/preceptors', label: 'Become a preceptor' },

  faqTitle: 'Frequently asked questions',
  faqCtaLabel: 'View all FAQs',
}

export const ABOUT = {
  eyebrow: 'About',
  title: 'A supported bridge from student to professional nurse.',
  intro:
    'The Affiliate Students’ Pathway from Internship to Residency Experience, or ASPIRE, ' +
    'is Cedars-Sinai’s pathway for senior nursing students to complete hands-on bedside ' +
    'clinical rotations in specialized units while paired with experienced preceptors.',
  designedTitle: 'What students build through ASPIRE',
  designed: [
    { icon: 'compass',     title: 'Build clinical confidence', body: 'Grow confidence at the bedside before graduation.' },
    { icon: 'stethoscope', title: 'Sharpen bedside skills',    body: 'Practice in a specialty area of interest with expert guidance.' },
    { icon: 'match',       title: 'Support the transition',    body: 'Ease the move from student to professional nursing practice.' },
    { icon: 'cap',         title: 'Strengthen preparation',    body: 'Build readiness to apply to the New Graduate RN Residency Program.' },
  ],
  sections: [
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
  eyebrow: 'Eligibility',
  title: 'See if ASPIRE is right for you.',
  intro: 'Applicants should meet all applicable criteria below. Your school’s placement coordinator confirms eligibility with the ASPIRE team.',
  checklistHeading: 'Quick eligibility self-check',
  checklistIntro:
    'Check each item that describes you. This is a self-assessment only. It does not ' +
    'confirm official eligibility, which is verified by your school and the ASPIRE team.',
  checklist: [
    'I am in the final semester of an accredited nursing program affiliated with Cedars-Sinai',
    'I am enrolled in an eligible program type (listed below)',
    'My rotation is a hands-on bedside clinical rotation involving direct patient care',
    'I have a cumulative GPA of 3.0 or higher on a 4.0 scale',
    'I can complete at least 90 hours of hands-on bedside clinical practice, or the greater number my nursing school requires',
    'I can meet the educational, health, safety, and background requirements set by both Cedars-Sinai and my nursing school',
  ],
  // Completion card, revealed only when every self-check item is checked.
  ready: {
    heading: 'Ready to take the next step?',
    body:
      'Your responses suggest you may be ready to participate. Final eligibility is ' +
      'confirmed by your school and the ASPIRE team.',
    support: 'Applying to ASPIRE starts at your school, not with an application portal.',
    ctaLabel: 'See how to apply',
    ctaPath: '/apply',
    // aria-live announcement when the self-check completes.
    announce: 'All self-check items complete. You may be ready to take the next step.',
  },
  programsHeading: 'Eligible academic programs',
  programs: [
    'Bachelor of Science in Nursing (semester, trimester, or quarter formats)',
    'Accelerated Bachelor of Science in Nursing',
    'Licensed Vocational Nurse to Bachelor of Science in Nursing',
    'Master’s Entry Clinical Nurse',
    'Entry-Level Master’s in Nursing',
  ],
  // Verified affiliate-school names from the approved ASPIRE source content.
  // Text only; partner-logo use is a separate approval.
  schoolsHeading: 'Our affiliate schools',
  schoolsIntro:
    'ASPIRE partners with accredited nursing programs across the region.',
  schools: [
    'Azusa Pacific University',
    'California State University, Long Beach',
    'California State University, Los Angeles',
    'California State University, Northridge',
    'University of California, Los Angeles',
    'West Coast University, Los Angeles Campus',
    'West Coast University, Orange County Campus',
  ],
  schoolsNote:
    'Your school’s placement coordinator confirms current program eligibility and ' +
    'affiliation with Cedars-Sinai.',
  // Neutral informational note, presented after schools and programs.
  rotationHeading: 'Rotation requirement',
  rotationBody:
    'ASPIRE requires a hands-on bedside clinical rotation involving direct patient care. ' +
    'Leadership rotations and observation-only rotations do not meet ASPIRE criteria.',
  requirementsNote:
    'Detailed educational, health, and safety requirements are provided through your ' +
    'school’s placement coordinator during eligibility verification, and are subject ' +
    'to change under Cedars-Sinai policy.',
}

export const APPLY = {
  eyebrow: 'How to Apply',
  title: 'Applying to ASPIRE starts at your school.',
  intro: 'Applying to ASPIRE starts at your school, not with an application portal. Your placement coordinator is your first and most important contact.',
  steps: [
    {
      title: 'Notify your school’s placement coordinator',
      body:
        'Tell your placement coordinator you are interested in completing your senior rotation ' +
        'at Cedars-Sinai through ASPIRE. The coordinator helps confirm your school’s ' +
        'affiliation, your final-semester status, your rotation requirements, and both ' +
        'school-specific and Cedars-Sinai prerequisites.',
    },
    {
      title: 'Complete the intake form',
      body:
        'After your school confirms eligibility, you receive an intake form from the ASPIRE ' +
        'team. It collects your unit preferences, specialty interests, career goals, learning ' +
        'goals, and scheduling information. Your placement coordinator may support you in ' +
        'completing it.',
    },
    {
      title: 'Participate in a brief conversation',
      body:
        'The ASPIRE team meets with you to discuss your preferences, interests, goals, and ' +
        'learning objectives, along with placement fit and unit availability.',
    },
  ],
  placementNote: 'Placement depends on eligibility, student interests, unit capacity, and preceptor availability.',
}

export const EXPERIENCE = {
  eyebrow: 'The Experience',
  title: 'Hands-on practice, real mentorship, a supported transition.',
  intro: 'ASPIRE is built around hands-on practice, mentorship, and a supported transition into professional nursing.',
  bullets: [
    { icon: 'stethoscope', text: 'Hands-on patient care in a specialized unit' },
    { icon: 'compass',     text: 'Placement aligned with your clinical interests when possible' },
    { icon: 'mentor',      text: 'Mentorship from an experienced RN preceptor' },
    { icon: 'heart',       text: 'Nursing Professional Development support throughout the rotation' },
    { icon: 'pulse',       text: 'Unit rounding and coaching' },
    { icon: 'handshake',   text: 'Professional connections with nurses, leaders, and peers' },
  ],
  continuityHeading: 'Preceptor continuity',
  continuityBody:
    'Students are assigned a primary preceptor whenever possible. A secondary preceptor may ' +
    'support scheduling or staffing needs. Any change is coordinated with Nursing Professional ' +
    'Development to protect consistency, progressive learning, and reliable feedback.',
}

export const PRECEPTORS = {
  eyebrow: 'For Preceptors',
  title: 'Mentor a future colleague. Grow as a leader.',
  intro:
    'ASPIRE needs experienced nurses and advanced practice nurses who are passionate about ' +
    'developing the next generation of nurses.',
  benefitsHeading: 'What precepting can offer you',
  benefits: [
    { icon: 'mentor',      title: 'Structured mentorship', body: 'A guided mentorship experience with clear expectations.' },
    { icon: 'heart',       title: 'Dedicated support',     body: 'Nursing Professional Development support and dedicated resources.' },
    { icon: 'compass',     title: 'Leadership growth',     body: 'Develop coaching and leadership skills that carry across your career.' },
    { icon: 'handshake',   title: 'Lasting impact',        body: 'A direct contribution to the nursing workforce pipeline.' },
  ],
  ctaHeading: 'Interested in becoming an ASPIRE preceptor?',
  ctaBody:
    'Let your unit leadership know you are interested, or email the ASPIRE team ' +
    'directly at aspire@cshs.org.',
  ctaLabel: 'Email the ASPIRE team',
  ctaPath: 'mailto:aspire@cshs.org',
}

export const FAQ = {
  eyebrow: 'FAQ',
  title: 'Frequently asked questions',
  intro: 'Answers to the questions students and schools ask most often.',
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
      a: 'Placement depends on eligibility, student interests, unit capacity, and preceptor availability. The ASPIRE conversation helps clarify your preferences and potential placement options.',
    },
    {
      q: 'Will I have the same preceptor throughout the rotation?',
      a: 'Students are assigned a primary preceptor whenever possible. A secondary preceptor may support scheduling or staffing needs, and any change is coordinated with Nursing Professional Development.',
    },
    {
      q: 'Do I need an RN license before starting the residency?',
      a: 'Yes. An RN license is required before beginning the New Graduate RN Residency Program. Confirm current timing and licensure requirements with the residency team through your coordinator.',
    },
    {
      q: 'Is ASPIRE the only path into the residency?',
      a: 'No. ASPIRE is one pathway toward the New Graduate RN Residency Program, but it is not the only one. Applicants who meet the requirements of other residency pathways may still apply.',
    },
  ],
}

export const CONTACT = {
  eyebrow: 'Contact',
  title: 'Let’s find your next step.',
  intro: 'Choose the description that fits you best. Each path points you to the fastest route to an answer.',
  cards: [
    {
      icon: 'cap',
      title: 'Students and schools',
      body: 'Start with your school’s placement coordinator. Coordinators work directly with the ASPIRE team on eligibility, requirements, and placement.',
      cta: { path: '/apply', label: 'See how to apply' },
    },
    {
      icon: 'hospital',
      title: 'Cedars-Sinai employees',
      body: 'Current employees pursuing a nursing degree can begin the same way: confirm eligibility with your school, then connect with the ASPIRE team.',
      cta: { path: '/eligibility', label: 'Check eligibility' },
    },
    {
      icon: 'mentor',
      title: 'Preceptors and unit leaders',
      body: 'Interested in precepting or hosting ASPIRE students on your unit? Learn what the preceptor experience involves and how to get started.',
      cta: { path: '/preceptors', label: 'Explore precepting' },
    },
    {
      icon: 'handshake',
      title: 'Participants and partners',
      body: 'Already part of ASPIRE, or partnering with us as a school or unit? Sign in to your ASPIRE Intelligence account to continue your work.',
      cta: { path: '/login', label: 'Sign in' },
    },
  ],
  // aspire@cshs.org is approved for public use (Owner approval, 2026-07-12).
  emailHeading: 'Email the ASPIRE team',
  emailBody:
    'For anything that does not fit a path above, including preceptor and unit ' +
    'participation questions, reach the ASPIRE team directly.',
  email: 'aspire@cshs.org',
  note: 'For eligibility and placement questions, your school’s placement coordinator remains the fastest route to an answer.',
}

export const FOOTER = {
  brandBlurb:
    'A nursing workforce pathway at Cedars-Sinai, connecting senior nursing students with ' +
    'hands-on clinical experience and professional growth.',
  columns: [
    {
      heading: 'Program',
      links: [
        { path: '/about',       label: 'About' },
        { path: '/eligibility', label: 'Eligibility' },
        { path: '/apply',       label: 'How to Apply' },
        { path: '/experience',  label: 'The Experience' },
      ],
    },
    {
      heading: 'Partners',
      links: [
        { path: '/preceptors', label: 'For Preceptors' },
        { path: '/contact',    label: 'Unit Leaders' },
        { path: '/contact',    label: 'Academic Partners' },
      ],
    },
    {
      heading: 'Resources',
      links: [
        { path: '/faq',     label: 'FAQ' },
        { path: '/contact', label: 'Contact' },
        { path: '/login',   label: 'Log in' },
      ],
    },
  ],
  contactHeading: 'Get started',
  contactBody: 'Work with your school’s placement coordinator to begin, or email the ASPIRE team.',
  contactCta: { path: '/apply', label: 'How to apply' },
  // aspire@cshs.org is approved for public use (Owner approval, 2026-07-12).
  contactEmail: 'aspire@cshs.org',
  disclaimer:
    'Program details are subject to change and are confirmed through your school’s ' +
    'placement coordinator.',
  // Institute naming, team bios, partner schools, and metrics remain withheld
  // pending approval (Owner decision list, Phase 1).
  attribution: '© Cedars-Sinai. ASPIRE is a nursing workforce pathway at Cedars-Sinai.',
}
