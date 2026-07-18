// src/public-site/publicContent.js
//
// PHASE1-PUBLIC-SITE (elevated): every string on the public site lives here, in
// one reviewable module, so copy changes never touch layout code and a future
// governed content interface (Phase 5) can replace this file wholesale.
//
// Copy discipline (approved consolidated revision):
//   - "ASPIRE" is never written as "ASPIRE Program".
//   - The formal residency name is always "New Graduate RN Residency Program".
//   - No language implies guaranteed placement, employment, or residency
//     admission, or a single preceptor for every shift.
//   - No em dash character is used anywhere.
//   - The whole site ships noindex until Cedars-Sinai communications approves
//     public indexing (meta tag in index.html).

export const SITE_NAME = 'ASPIRE at Cedars-Sinai'
export const SITE_TITLE = 'Cedars-Sinai ASPIRE Program | Nursing Student Clinical Experience'

// ── Search metadata ──────────────────────────────────────────────────────────
// Route-specific titles and descriptions. The primary public identity is
// "Cedars-Sinai ASPIRE Program" (with "ASPIRE at Cedars-Sinai" as the natural
// variation); "ASPIRE Intelligence" remains the platform identity. Every
// description is drawn from approved on-page copy: no outcomes, guarantees,
// or requirements beyond what the pages already state. Consumed both by the
// client-side head manager and the build-time prerender.
export const META = {
  home: {
    title: SITE_TITLE,
    description:
      'Explore the Cedars-Sinai ASPIRE Program, a structured senior clinical experience that ' +
      'helps eligible nursing students build confidence, strengthen readiness, and prepare for ' +
      'professional nursing practice.',
  },
  about: {
    title: 'About the Cedars-Sinai ASPIRE Program',
    description:
      'Learn how ASPIRE, the Affiliate Students’ Pathway from Internship to Residency ' +
      'Experience, pairs senior nursing students with experienced preceptors for a hands-on ' +
      'bedside clinical rotation at Cedars-Sinai.',
  },
  eligibility: {
    title: 'ASPIRE Program Eligibility | Cedars-Sinai',
    description:
      'Review eligibility for the Cedars-Sinai ASPIRE Program: eligible nursing program ' +
      'pathways, participating schools, the bedside rotation requirement, and a quick ' +
      'self-check to see whether ASPIRE may be right for you.',
  },
  apply: {
    title: 'How to Apply to the Cedars-Sinai ASPIRE Program',
    description:
      'Applying to ASPIRE begins with your school’s clinical placement coordinator, followed ' +
      'by the ASPIRE intake form and an interview with the ASPIRE Team at Cedars-Sinai.',
  },
  experience: {
    title: 'The ASPIRE Clinical Experience | Cedars-Sinai',
    description:
      'Inside the ASPIRE experience at Cedars-Sinai: hands-on bedside practice, one-to-one ' +
      'preceptorship, meaningful unit immersion, and support from Nursing Professional ' +
      'Development practitioners.',
  },
  preceptors: {
    title: 'ASPIRE Preceptors | Cedars-Sinai',
    description:
      'Experienced Cedars-Sinai nurses guide senior nursing students through ASPIRE ' +
      'rotations, with preceptor preparation, Nursing Professional Development support, and ' +
      'room to grow as a leader.',
  },
  faq: {
    title: 'Cedars-Sinai ASPIRE Program FAQ',
    description:
      'Frequently asked questions about the Cedars-Sinai ASPIRE Program: eligibility, ' +
      'applying through your school, unit and preceptor matching, clinical hours, and what ' +
      'comes after the rotation.',
  },
  contact: {
    title: 'Contact the Cedars-Sinai ASPIRE Team',
    description:
      'Find the right starting point for nursing students, school coordinators, Cedars-Sinai ' +
      'employees, preceptors, and unit leaders, or email the ASPIRE Team directly.',
  },
}

// ── The pathway route ────────────────────────────────────────────────────────
// The public pages presented as stops along one route: powers the waypoint
// map in each page header and the "Next on the pathway" band. Teasers reuse
// each page's approved headline language.
export const PATHWAY = {
  mapLabel: 'The ASPIRE pathway',
  nextEyebrow: 'Next on the pathway',
  nextOverrides: { contact: 'apply' },
  stops: [
    { page: 'about',       path: '/about',       label: 'The story',      nav: 'About ASPIRE',                     teaser: 'A supported bridge from nursing school to professional practice.' },
    { page: 'eligibility', path: '/eligibility', label: 'Eligibility',    nav: 'ASPIRE eligibility',               teaser: 'See whether ASPIRE may be right for you.' },
    { page: 'apply',       path: '/apply',       label: 'How to apply',   nav: 'Apply to ASPIRE',                  teaser: 'Applying begins with your school.' },
    { page: 'experience',  path: '/experience',  label: 'The experience', nav: 'Explore the clinical experience',  teaser: 'Hands-on practice, one-to-one mentorship, and unit immersion.' },
    { page: 'preceptors',  path: '/preceptors',  label: 'Preceptors',     nav: 'Learn about ASPIRE precepting',    teaser: 'Mentor a future colleague. Grow as a leader.' },
    { page: 'faq',         path: '/faq',         label: 'Questions',      nav: 'ASPIRE program FAQ',               teaser: 'Answers about eligibility, applying, and placement.' },
    { page: 'contact',     path: '/contact',     label: 'Contact',        nav: 'Contact the ASPIRE team',          teaser: 'Find the right place to start.' },
  ],
}

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
  heroEyebrow: 'The Cedars-Sinai ASPIRE Program',
  // The headline renders in two parts so the closing phrase can carry the
  // italic editorial voice and drawn underline. Read together, the sentence
  // is unchanged from the approved headline.
  heroTitleLead: 'Complete your senior clinical rotation where you hope to ',
  heroTitleEmphasis: 'begin your nursing career.',
  heroNote: 'Applying begins with your school’s clinical placement coordinator.',
  scrollCueLabel: 'Follow the pathway',
  heroBody:
    'ASPIRE, the Affiliate Students’ Pathway from Internship to Residency Experience, gives ' +
    'eligible senior nursing students the opportunity to complete a hands-on bedside clinical ' +
    'rotation at Cedars-Sinai. Students learn alongside an experienced preceptor and receive ' +
    'support from Nursing Professional Development practitioners as they prepare for the ' +
    'transition into professional practice.',
  heroPrimaryCta:   { path: '/eligibility', label: 'See if you are eligible' },
  heroSecondaryCta: { path: '/apply',       label: 'How to apply' },

  audienceEyebrow: 'One connected ecosystem',
  audienceTitle: 'Find your pathway',
  audienceIntro:
    'ASPIRE brings four groups together around one shared goal: helping nursing students build ' +
    'a confident, well-supported transition into professional practice.',
  audiences: [
    {
      icon: 'cap',
      title: 'Nursing Students',
      body: 'Complete a hands-on bedside clinical rotation, strengthen your clinical confidence, and prepare for the transition from student to professional nurse.',
      cta: { path: '/eligibility', label: 'Explore the student pathway' },
    },
    {
      icon: 'mentor',
      title: 'Preceptors',
      body: 'Guide a future colleague through a structured clinical experience while strengthening your mentorship and leadership skills.',
      cta: { path: '/preceptors', label: 'Learn about precepting' },
    },
    {
      icon: 'hospital',
      title: 'Unit Leaders',
      body: 'Partner with ASPIRE to support student learning, engage future nurses, and strengthen the nursing workforce pipeline.',
      cta: { path: '/contact', label: 'Partner with ASPIRE' },
    },
    {
      icon: 'handshake',
      title: 'Academic Partners',
      body: 'Collaborate with Cedars-Sinai to support student preparation, clinical learning, and a successful transition into professional practice.',
      cta: { path: '/contact', label: 'Work with ASPIRE' },
    },
  ],

  glanceEyebrow: 'What to expect',
  glanceTitle: 'ASPIRE at a glance',
  glanceIntro: 'What students can expect from a senior clinical rotation through ASPIRE.',
  glanceCards: [
    {
      icon: 'clock',
      title: 'At least 90 bedside clinical hours',
      body: 'Build hands-on experience through direct patient care in a Cedars-Sinai unit. Your nursing school may require additional hours.',
    },
    {
      icon: 'compass',
      title: 'Personalized unit and preceptor matching',
      body: 'ASPIRE considers your clinical interests, goals, and readiness alongside unit and preceptor availability to identify a placement where you can feel engaged, supported, and positioned to grow. If you are unsure which area is right for you, Nursing Professional Development practitioners help you explore your options.',
    },
    {
      icon: 'stethoscope',
      title: 'Dedicated preceptor support',
      body: 'Learn alongside an experienced preceptor who supports your clinical development, with additional guidance from the unit team as needed.',
    },
    {
      icon: 'heart',
      title: 'Support beyond the rotation',
      body: 'Receive support from Nursing Professional Development practitioners throughout onboarding, placement, and your clinical rotation. For students who are hired, that guidance may continue through the transition into Cedars-Sinai’s New Graduate RN Residency Program.',
    },
  ],

  journeyEyebrow: 'Six steps',
  journeyTitle: 'The ASPIRE journey',
  journeyIntro: 'Six steps from eligibility through your clinical rotation and preparation for what comes next.',
  journey: [
    { icon: 'school', title: 'Your school confirms eligibility and submits a request', body: 'Your school’s clinical placement coordinator confirms your eligibility and clinical requirements, then submits a placement request through the ASPIRE portal.' },
    { icon: 'form',   title: 'You complete the ASPIRE intake form', body: 'Share your clinical interests, professional goals, learning needs, placement preferences, and scheduling information.' },
    { icon: 'chat',   title: 'You interview with the ASPIRE Team', body: 'Discuss your interests, readiness, learning objectives, and the clinical environments where you may be positioned to grow.' },
    { icon: 'match',  title: 'ASPIRE coordinates your unit and preceptor match', body: 'Your interests, goals, and readiness are considered alongside unit capacity and preceptor availability to identify an appropriate placement.' },
    { icon: 'pulse',  title: 'You complete your clinical rotation', body: 'Build hands-on bedside experience with preceptor mentorship, support from the unit team, and guidance from Nursing Professional Development practitioners.' },
    { icon: 'cap',    title: 'You prepare for your next step',    body: 'Reflect on your growth, strengthen your readiness for professional practice, and prepare to apply to Cedars-Sinai’s New Graduate RN Residency Program.' },
  ],
  journeyNote: 'Participation in ASPIRE does not guarantee a specific unit or preceptor placement, employment, or admission to the New Graduate RN Residency Program.',

  preceptorBandEyebrow: 'For Preceptors',
  preceptorBandTitle: 'Help shape a future colleague.',
  preceptorBandBody:
    'Share your clinical expertise, guide a senior nursing student through meaningful bedside ' +
    'learning, and strengthen your mentorship and leadership skills with structured support from ' +
    'Nursing Professional Development practitioners.',
  preceptorBandCta: { path: '/preceptors', label: 'Become a preceptor' },

  faqEyebrow: 'Good to know',
  faqTitle: 'Frequently asked questions',
  faqCtaLabel: 'View all FAQs',
  // Homepage FAQ preview: friendly question labels paired with the shared FAQ
  // answers (referenced by index into FAQ.items, so the answer copy never
  // duplicates or drifts).
  faqPreview: [
    {
      // The homepage question ("How do I apply") differs from the full FAQ
      // question ("Can I apply directly"), so it carries its own dedicated
      // answer and does NOT reuse the FAQ answer that opens with "No.".
      q: 'How do I apply to ASPIRE?',
      i: 0,
      a: 'Applying begins with your school’s clinical placement coordinator. After confirming your eligibility, your coordinator submits a placement request through the ASPIRE portal. You will then receive the ASPIRE intake form and an invitation to interview with the ASPIRE Team.',
    },
    // These two homepage questions match their FAQ questions exactly, so they
    // reuse the shared FAQ answers by index.
    { q: 'How are the unit and preceptor selected?', i: 3 },
    { q: 'Can current Cedars-Sinai employees participate in ASPIRE?', i: 2 },
  ],

  // Closing invitation at the end of the homepage journey.
  closingTitle: 'Your pathway starts at your school.',
  closingBody:
    'Talk with your school’s clinical placement coordinator about completing your senior ' +
    'clinical rotation at Cedars-Sinai through ASPIRE, and bring your questions to the ' +
    'ASPIRE Team anytime.',
  closingPrimaryCta:   { path: '/apply',   label: 'See how to apply' },
  closingSecondaryCta: { path: '/contact', label: 'Contact the ASPIRE Team' },
}

export const ABOUT = {
  eyebrow: 'About',
  title: 'A supported bridge from nursing school to professional practice.',
  intro: [
    'ASPIRE, the Affiliate Students’ Pathway from Internship to Residency Experience, gives ' +
    'eligible senior nursing students the opportunity to complete a hands-on bedside clinical ' +
    'rotation at Cedars-Sinai. Each placement is thoughtfully coordinated around the student’s ' +
    'interests, goals, and readiness, together with unit capacity and preceptor availability.',
    'Through a structured one-to-one preceptorship model and sustained immersion in an assigned ' +
    'unit, students gain more than clinical hours. They begin to understand the patient population, ' +
    'team relationships, daily workflows, communication practices, policies, and standards that ' +
    'shape nursing care in that environment.',
  ],
  alt: 'A senior nursing student discussing clinical learning with a nurse and members of the care team.',
  // Pull statement between the two ledgers; the emphasized phrase comes
  // directly from the approved intro copy ("students gain more than clinical
  // hours").
  pullLead: 'Through one-to-one preceptorship and sustained unit immersion, students gain ',
  pullEmphasis: 'more than clinical hours',
  pullTail: '.',
  setsApartHeading: 'What sets ASPIRE apart',
  setsApart: [
    { icon: 'mentor',      title: 'One-to-one preceptorship',       body: 'Each student’s experience is centered around a primary preceptor who provides individualized teaching, feedback, and guidance at the bedside, with support from other members of the unit team when needed.' },
    { icon: 'compass',     title: 'Personalized placement',         body: 'ASPIRE considers each student’s interests, goals, readiness, and learning needs alongside unit capacity and preceptor availability. Students who are unsure of their preferred area receive guidance as they explore where they may be positioned to grow.' },
    { icon: 'hospital',    title: 'Meaningful unit immersion',      body: 'Students become familiar with the people and practices of their assigned unit, including its patient population, workflows, interdisciplinary team, communication norms, policies, and expectations for professional nursing practice.' },
    { icon: 'handshake',   title: 'Early professional enculturation', body: 'By participating as a supported member of the unit, students begin developing an understanding of Cedars-Sinai’s professional culture, standards, and approach to patient care before entering practice as a registered nurse.' },
  ],
  buildHeading: 'What students build through ASPIRE',
  build: [
    { icon: 'compass',     title: 'Build clinical confidence',  body: 'Develop greater confidence caring for patients in a real-world clinical environment before graduation.' },
    { icon: 'stethoscope', title: 'Strengthen bedside practice', body: 'Apply classroom learning through direct patient care while receiving individualized guidance from an experienced preceptor.' },
    { icon: 'heart',       title: 'Develop a sense of belonging', body: 'Build relationships with nurses, leaders, and interdisciplinary team members while learning how to contribute within a professional care environment.' },
    { icon: 'cap',         title: 'Prepare for what comes next', body: 'Build readiness for the transition into professional nursing practice and a future application to Cedars-Sinai’s New Graduate RN Residency Program. For students who are later hired, prior familiarity with the unit environment and organizational culture can support a more confident and well-supported transition into residency.' },
  ],
  sections: [
    {
      heading: 'Why Cedars-Sinai offers ASPIRE',
      body:
        'Strong academic-practice partnerships help students connect classroom learning with the ' +
        'realities of bedside care. ASPIRE combines personalized placement, one-to-one preceptorship, ' +
        'unit immersion, and Nursing Professional Development support to help students enter ' +
        'professional practice with greater confidence, clarity, and readiness.',
    },
    {
      heading: 'Support throughout and beyond the rotation',
      body:
        'ASPIRE students receive support from Nursing Professional Development practitioners, unit ' +
        'leadership, a primary preceptor, and other members of the unit team. Support may include ' +
        'onboarding guidance, coaching, unit rounding, progress check-ins, and help navigating what ' +
        'comes next. For students who are later hired into Cedars-Sinai’s New Graduate RN Residency ' +
        'Program, that support can continue as they transition into professional practice.',
    },
  ],
}

export const ELIGIBILITY = {
  eyebrow: 'Eligibility',
  title: 'See whether ASPIRE may be right for you.',
  intro:
    'Applicants must meet all applicable eligibility and clinical placement requirements. Your ' +
    'school’s clinical placement coordinator works with the ASPIRE Team to confirm your eligibility.',
  checklistHeading: 'Quick eligibility self-check',
  checklistIntro:
    'Select each statement that applies to you. This self-check is for guidance only. Official ' +
    'eligibility is confirmed by your school and the ASPIRE Team.',
  checklist: [
    'I am in the final term of an eligible nursing program at a school currently participating in ASPIRE.',
    'I am enrolled in one of the eligible nursing program pathways listed below.',
    'My required rotation includes hands-on bedside care and direct patient care.',
    'I have a cumulative GPA of at least 3.0 on a 4.0 scale.',
    'I can complete at least 90 bedside clinical hours, or the greater number required by my nursing school.',
    'I can meet the applicable educational, health, safety, background, and onboarding requirements established by Cedars-Sinai and my nursing school.',
  ],
  // Completion card, revealed only when every self-check item is checked.
  ready: {
    heading: 'Ready to take the next step?',
    body:
      'Based on your responses, you may be eligible to participate in ASPIRE. Final eligibility is ' +
      'confirmed by your school and the ASPIRE Team.',
    support: 'Applying to ASPIRE begins with your school, not through a public application portal.',
    ctaLabel: 'See how to apply',
    ctaPath: '/apply',
    announce: 'All self-check items complete. Based on your responses, you may be eligible to take the next step.',
  },
  programsHeading: 'Eligible nursing program pathways',
  programs: [
    'Bachelor of Science in Nursing, including semester, trimester, and quarter formats',
    'Accelerated Bachelor of Science in Nursing',
    'Licensed Vocational Nurse to Bachelor of Science in Nursing',
    'Master’s Entry Clinical Nurse',
    'Entry-Level Master’s in Nursing',
  ],
  schoolsHeading: 'Current ASPIRE-eligible schools',
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
    'Participation and program eligibility may vary by school, campus, academic term, and clinical ' +
    'placement agreement. Your school’s clinical placement coordinator confirms whether your program is ' +
    'currently eligible for ASPIRE.',
  rotationHeading: 'Clinical rotation requirement',
  rotationBody:
    'ASPIRE is designed for hands-on bedside clinical rotations that include direct patient care. ' +
    'Leadership, administrative, and observation-only rotations do not meet ASPIRE eligibility criteria.',
  finalHeading: 'Final eligibility verification',
  requirementsNote:
    'Detailed educational, onboarding, health, safety, and background requirements are provided ' +
    'through your school’s clinical placement coordinator during the eligibility process. Requirements may ' +
    'change based on Cedars-Sinai policy, school requirements, and clinical placement standards.',
}

export const APPLY = {
  eyebrow: 'How to Apply',
  title: 'Applying to ASPIRE begins with your school.',
  intro:
    'Your school’s clinical placement coordinator is your first point of contact and helps confirm ' +
    'whether you can move forward.',
  steps: [
    {
      title: 'Contact your clinical placement coordinator',
      body:
        'Let your school’s clinical placement coordinator know that you are interested in completing ' +
        'your senior clinical rotation at Cedars-Sinai through ASPIRE. After confirming your ' +
        'eligibility, your coordinator submits a placement request through the ASPIRE portal.',
    },
    {
      title: 'Complete the ASPIRE intake form',
      body:
        'After the placement request is submitted, you receive an intake form from the ASPIRE Team. ' +
        'Complete the form with your clinical interests, preferred practice areas, professional goals, ' +
        'learning needs, scheduling information, and other details used to support placement planning.',
    },
    {
      title: 'Interview with the ASPIRE Team',
      body:
        'Meet with the ASPIRE Team to discuss your interests, goals, readiness, learning needs, and ' +
        'the clinical environments where you may be positioned to grow. The interview also provides an ' +
        'opportunity to discuss placement considerations and ask questions.',
    },
  ],
  placementNote:
    'Placement is coordinated based on confirmed eligibility, the student’s interests and readiness, ' +
    'unit capacity, and preceptor availability. A specific placement is not guaranteed.',
}

export const EXPERIENCE = {
  eyebrow: 'The Experience',
  title: 'Hands-on practice, one-to-one mentorship, and meaningful unit immersion.',
  intro:
    'ASPIRE is designed to offer more than the completion of clinical hours. Through personalized ' +
    'placement, one-to-one preceptorship, and support from Nursing Professional Development ' +
    'practitioners, students gain bedside experience while becoming familiar with the people, ' +
    'practices, and expectations of their assigned unit.',
  alt: 'A Nursing Professional Development practitioner, an RN preceptor, and a senior nursing student discussing clinical learning together at a clinical workstation.',
  items: [
    { icon: 'stethoscope', title: 'Hands-on bedside practice',            body: 'Apply classroom learning through direct patient care in a Cedars-Sinai unit.' },
    { icon: 'compass',     title: 'Personalized unit and preceptor matching', body: 'Your interests, goals, readiness, and learning needs are considered alongside unit capacity and preceptor availability.' },
    { icon: 'mentor',      title: 'One-to-one preceptorship',             body: 'Learn alongside an experienced RN preceptor who provides individualized teaching, feedback, and clinical guidance.' },
    { icon: 'hospital',    title: 'Meaningful unit immersion',            body: 'Become familiar with the unit’s patient population, staff, workflows, interdisciplinary team, communication practices, policies, and standards of care.' },
    { icon: 'heart',       title: 'NPD coaching and unit rounding',       body: 'Receive ongoing check-ins, coaching, and support from Nursing Professional Development practitioners throughout the rotation.' },
    { icon: 'handshake',   title: 'Professional relationships',           body: 'Build connections with nurses, leaders, peers, and interdisciplinary team members while learning how to contribute within a professional care environment.' },
  ],
  continuityHeading: 'Preceptor continuity',
  continuityBody:
    'Each student is paired with a primary preceptor whenever possible to support continuity, ' +
    'progressive learning, and consistent feedback. A secondary preceptor may assist when scheduling ' +
    'or staffing needs require it. Any change is coordinated with Nursing Professional Development ' +
    'practitioners to preserve a coherent and well-supported learning experience.',
}

export const PRECEPTORS = {
  eyebrow: 'For Preceptors',
  title: 'Mentor a future colleague. Grow as a leader.',
  intro:
    'ASPIRE welcomes experienced registered nurses who are committed to helping senior nursing ' +
    'students build confidence, strengthen clinical judgment, and develop a strong foundation for ' +
    'professional practice.',
  alt: 'A Cedars-Sinai registered nurse teaching at a clinical workstation while a senior nursing student listens and takes notes.',
  benefitsHeading: 'What precepting can offer you',
  benefits: [
    { icon: 'mentor',    title: 'Preceptor preparation',            body: 'Receive training, practical tools, and clear expectations to help you guide a student effectively.' },
    { icon: 'heart',     title: 'Dedicated Nursing Professional Development support', body: 'Partner with Nursing Professional Development practitioners for coaching, resources, and support throughout the preceptorship experience.' },
    { icon: 'compass',   title: 'Leadership growth',                body: 'Strengthen your teaching, feedback, coaching, communication, and leadership skills.' },
    { icon: 'handshake', title: 'Lasting impact',                   body: 'Help a future nurse connect classroom learning with bedside practice while contributing to a stronger nursing workforce pipeline.' },
    { icon: 'match',     title: 'Potential additional compensation', body: 'Cedars-Sinai nurses may be eligible for additional compensation for qualifying preceptor assignments, in accordance with applicable policy.' },
  ],
  ctaHeading: 'Interested in becoming an ASPIRE preceptor?',
  ctaBody: 'Let your unit leadership know that you are interested, or contact the ASPIRE Team directly at aspire@cshs.org.',
  ctaSupport: 'For questions about preceptor training, expectations, resources, or support, email preceptor@cshs.org.',
  emailAspire: 'aspire@cshs.org',
  emailPreceptor: 'preceptor@cshs.org',
  ctaAspireLabel: 'Email the ASPIRE Team',
  ctaPreceptorLabel: 'Ask a preceptor question',
}

export const FAQ = {
  eyebrow: 'FAQ',
  title: 'Frequently asked questions',
  intro: 'Answers about eligibility, applying, personalized placement, preceptorship, and what comes after the rotation.',
  items: [
    {
      q: 'Can I apply directly to ASPIRE?',
      a: 'No. Applying begins with your school’s clinical placement coordinator. After confirming your eligibility, your coordinator submits a placement request through the ASPIRE portal. You will then receive the ASPIRE intake form and an invitation to interview with the ASPIRE Team.',
    },
    {
      q: 'My program requires a leadership, administrative, or observation-only rotation. Can I participate in ASPIRE?',
      a: 'ASPIRE is designed for hands-on bedside clinical rotations that include direct patient care. Leadership, administrative, and observation-only rotations do not meet ASPIRE eligibility criteria.',
    },
    {
      q: 'Can current Cedars-Sinai employees participate in ASPIRE?',
      a: 'Yes. Current Cedars-Sinai employees may participate when they meet all applicable eligibility requirements and their school’s clinical placement coordinator confirms that they can proceed. Current employment does not replace the school placement process or guarantee an ASPIRE placement.',
    },
    {
      q: 'How are the unit and preceptor selected?',
      a: 'ASPIRE coordinates a personalized match by considering your clinical interests, professional goals, readiness, and learning needs alongside unit capacity and preceptor availability. A particular unit or preceptor cannot be guaranteed.',
    },
    {
      q: 'What if I am unsure which clinical area is right for me?',
      a: 'The ASPIRE Team can help you explore your interests, experiences, goals, and learning needs during the intake and interview process. Nursing Professional Development practitioners will guide you toward clinical environments where you may be positioned to grow.',
    },
    {
      q: 'Will I work with the same preceptor throughout my rotation?',
      a: 'You will be paired with a primary preceptor whenever possible to support continuity, progressive learning, and consistent feedback. A secondary preceptor may assist when scheduling or staffing needs require it. Changes are coordinated with Nursing Professional Development practitioners to preserve a coherent learning experience.',
    },
    {
      q: 'How many clinical hours must I complete?',
      a: 'ASPIRE requires at least 90 hours of hands-on bedside clinical practice. You must complete the greater number of hours when your nursing school requires more than 90.',
    },
    {
      q: 'Can I participate if my school is not listed on the website?',
      a: 'The schools shown are those currently participating in ASPIRE. Participation may vary by school, campus, academic term, and clinical placement agreement. Ask your school’s clinical placement coordinator to confirm whether your program is currently eligible.',
    },
    {
      q: 'Can I participate if I have already graduated or hold an RN license?',
      a: 'No. ASPIRE is a prelicensure senior clinical experience for eligible nursing students completing their final academic term. Students who have already graduated or obtained an RN license, including licensed nurses enrolled in an RN-to-BSN program, are not eligible for an ASPIRE rotation. Graduates may explore the New Graduate RN Residency Program or other Cedars-Sinai employment opportunities for which they qualify.',
    },
    {
      q: 'Can I participate in ASPIRE if I do not plan to apply to the New Graduate RN Residency Program?',
      a: 'Applying to the New Graduate RN Residency Program is not a requirement for completing an ASPIRE rotation. However, ASPIRE is intentionally designed as a pathway from senior clinical experience into professional nursing practice and potential residency participation. Because placement opportunities are limited, ASPIRE is best suited for students who are genuinely interested in exploring a future nursing career at Cedars-Sinai. Interest in joining the Cedars-Sinai workforce may be considered along with eligibility, readiness, placement fit, unit capacity, and preceptor availability.',
    },
    {
      q: 'Can I complete my rotation in more than one unit?',
      a: 'No. ASPIRE is designed as an immersive experience in one assigned unit, ideally with one primary preceptor. Remaining in the same clinical environment allows you to become familiar with the patient population, staff, workflows, interdisciplinary team, policies, and expectations of the unit while building progressively on your learning. Your ASPIRE placement does not require you to apply to that same unit after graduation. You may apply to another unit that better aligns with your interests or career goals.',
    },
    {
      q: 'What happens if my ASPIRE unit is not hiring new graduate nurses?',
      a: 'You may apply to other Cedars-Sinai units that are accepting New Graduate RN Residency applicants. Your ASPIRE experience can still help you demonstrate familiarity with Cedars-Sinai’s care environment, professional expectations, interdisciplinary practice, and organizational culture. Completing your rotation in a particular unit does not guarantee that the unit will have an opening or that you will be selected for employment.',
    },
    {
      q: 'Does ASPIRE guarantee a specific placement, employment, or residency admission?',
      a: 'No. ASPIRE provides a supported senior clinical experience and helps students prepare for the transition into professional practice and a future residency application. Participation does not guarantee a particular unit or preceptor, employment at Cedars-Sinai, or admission to the New Graduate RN Residency Program.',
    },
    {
      q: 'Is ASPIRE the only pathway to the New Graduate RN Residency Program?',
      a: 'No. ASPIRE is one pathway that can help eligible senior nursing students prepare for professional practice. Participation in ASPIRE is not required to apply through other available New Graduate RN Residency pathways.',
    },
  ],
}

export const CONTACT = {
  eyebrow: 'Contact',
  title: 'Find the right place to start.',
  intro: 'Choose the option that best describes you. Each path will guide you to the most appropriate next step.',
  cards: [
    {
      icon: 'cap',
      title: 'Students and school coordinators',
      body: 'Prospective students should begin with their school’s clinical placement coordinator. Coordinators confirm eligibility, review clinical requirements, and submit placement requests to ASPIRE through the portal.',
      cta: { path: '/apply', label: 'See how to apply' },
    },
    {
      icon: 'hospital',
      title: 'Cedars-Sinai employees',
      body: 'Current employees completing an eligible prelicensure nursing program also begin with their school’s clinical placement coordinator. Participation requirements may vary by school, campus, and academic program.',
      cta: { path: '/eligibility', label: 'Check eligibility' },
    },
    {
      icon: 'mentor',
      title: 'Preceptors and unit leaders',
      body: 'Interested in precepting an ASPIRE student or exploring participation for your unit? Learn about the preceptor experience, available preparation and support, and how to express your interest.',
      cta: { path: '/preceptors', label: 'Explore precepting' },
    },
  ],
  signin: {
    heading: 'Already part of ASPIRE?',
    body: 'Students, preceptors, unit leaders, and academic partners with an active account can sign in to access their portal and continue their work.',
    ctaLabel: 'Sign in to ASPIRE',
    ctaPath: '/login',
  },
  // aspire@cshs.org is approved for public use (Owner approval, 2026-07-12).
  direct: {
    aspire: {
      heading: 'Contact the ASPIRE Team',
      body: 'For general questions, student support, school coordination, unit participation, or anything that does not fit the paths above.',
      email: 'aspire@cshs.org',
      ctaLabel: 'Email the ASPIRE Team',
    },
    preceptor: {
      heading: 'Preceptor support',
      body: 'For questions about preceptor preparation, expectations, resources, training, or support.',
      email: 'preceptor@cshs.org',
      ctaLabel: 'Ask a preceptor question',
    },
  },
  guidance: 'For prospective student eligibility and placement questions, your school’s clinical placement coordinator remains the best first point of contact.',
}

export const FOOTER = {
  // Editorial sign-off above the footer columns; drawn from the approved
  // program purpose (building the future nursing workforce before graduation).
  tagline: 'Helping build the future nursing workforce, before graduation.',
  columns: [
    {
      heading: 'Explore',
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
  contactHeading: 'Get Started',
  contactCta: { path: '/apply', label: 'How to Apply' },
  contactEmail: 'aspire@cshs.org',
  disclaimer:
    'ASPIRE details are subject to change and are confirmed through your school’s clinical placement coordinator.',
  attribution: '© Cedars-Sinai. ASPIRE is a nursing workforce pathway at Cedars-Sinai.',
}
