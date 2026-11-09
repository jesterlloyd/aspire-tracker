// src/lib/portalTerms.js
//
// PORTAL-TERMS-1 (Owner, 2026-11-09): every portal user accepts the ASPIRE Portal Terms of Use
// and Confidentiality Agreement before any portal content renders. Owner decisions, same day:
//   - ONE text for every portal (Student, Unit Leader, Academic Partner, NE&L, Residency).
//   - Accepted again when the text changes (a new PORTAL_TERMS_VERSION) and once a year
//     regardless (REACCEPT_DAYS).
//   - Decline signs the person out; the next sign-in shows the agreement again.
//   - Owner/Admin portal previews skip it (they do not act as the portal user).
//
// The text below is a DRAFT for Legal review, written by Claude on the Owner's request. Changing
// any word of it is a new version: bump PORTAL_TERMS_VERSION (an ISO date) in the same commit,
// and every portal user is asked again. The version is what the acceptance record stores.
//
// Pure module: no React, no network. Read by PortalTermsGate and its hook, and by tests.

export const PORTAL_TERMS_VERSION = '2026-11-09'
export const PORTAL_TERMS_TITLE = 'Terms of Use and Confidentiality'
export const PORTAL_TERMS_DRAFT = true
export const REACCEPT_DAYS = 365
export const PORTAL_TERMS_CONTACT = 'aspire@cshs.org'

export const PORTAL_TERMS_INTRO =
  'ASPIRE Intelligence is operated by the Geri and Richard Brawerman Nursing Institute at ' +
  'Cedars-Sinai to run the ASPIRE program. Please read these terms before you continue. ' +
  'They apply every time you use an ASPIRE portal.'

export const PORTAL_TERMS_SECTIONS = [
  {
    heading: 'Confidential Information',
    body: [
      'The portal may show you information about students, preceptors, units, schools and ' +
      'Cedars-Sinai staff. Treat all of it as confidential.',
      'Use it only for your role in ASPIRE. Do not copy, download, photograph, forward or ' +
      'discuss it with anyone who does not need it for that role.',
    ],
  },
  {
    heading: 'Patient Privacy',
    body: [
      'Never enter patient names, medical record numbers, dates of birth, room numbers or any ' +
      'other detail that could identify a patient anywhere in the portal, including shift logs, ' +
      'messages, forms and uploaded files.',
      'Cedars-Sinai policy and federal law (HIPAA) protect patient information. Those rules ' +
      'apply to you whenever you are on a Cedars-Sinai unit or using a Cedars-Sinai system.',
    ],
  },
  {
    heading: 'Student Records',
    body: [
      'Student records are protected by privacy law, including FERPA, and by the agreements ' +
      'between Cedars-Sinai and each school. Units and schools see only the students they ' +
      'work with. Do not share a student’s information beyond that.',
    ],
  },
  {
    heading: 'Your Account',
    body: [
      'Your sign-in is yours alone. Do not share your password or let anyone use the portal ' +
      'as you. Sign out when you use a shared or public device.',
      `If you think someone else has used your account, email ${PORTAL_TERMS_CONTACT} right away.`,
    ],
  },
  {
    heading: 'Appropriate Use',
    body: [
      'Keep messages professional and respectful. Record shifts, hours and answers accurately: ' +
      'they become part of the program record.',
      'Do not try to reach information or features that your role does not include.',
    ],
  },
  {
    heading: 'Monitoring',
    body: [
      'Portal activity is logged and may be reviewed by the ASPIRE team. Misuse can end your ' +
      'portal access and may be reported to your school, program or employer.',
    ],
  },
  {
    heading: 'Changes to These Terms',
    body: [
      'If these terms change, you will be asked to accept them again. You will also be asked ' +
      'once a year.',
    ],
  },
]

export const PORTAL_TERMS_AGREE_LABEL =
  'I have read and agree to the ASPIRE Portal Terms of Use and Confidentiality Agreement.'

// The portal roles an acceptance may record. Anything else is dropped (the RPC filters too).
export const PORTAL_TERMS_ROLES = ['student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition']

export function termsRoles(roles) {
  const list = Array.isArray(roles) ? roles : []
  return PORTAL_TERMS_ROLES.filter(r => list.includes(r))
}

// Does this person have to accept (again)? `latest` is their newest acceptance of ANY version:
// { terms_version, accepted_at } or null. A different version, a missing or unreadable date,
// or an acceptance older than REACCEPT_DAYS all mean yes.
export function needsAcceptance(latest, now = new Date()) {
  if (!latest || latest.terms_version !== PORTAL_TERMS_VERSION) return true
  const at = Date.parse(latest.accepted_at)
  if (!Number.isFinite(at)) return true
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  return nowMs - at > REACCEPT_DAYS * 24 * 60 * 60 * 1000
}

// A read or write error that means "the table or function is not there yet" (the Owner-gated
// migration has not been applied). The gate stays out of the way then, so the portals keep
// working on either side of the migration.
export function termsNotProvisioned(error) {
  const code = String(error?.code || '')
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883') return true
  const msg = String(error?.message || '')
  return /portal_terms_acceptances|accept_portal_terms/.test(msg) && /does not exist|schema cache|could not find/i.test(msg)
}
