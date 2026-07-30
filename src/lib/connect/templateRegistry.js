// src/lib/connect/templateRegistry.js
//
// CONNECT-TEMPLATE-REGISTRY-1 - single source of truth for ASPIRE Connect Outreach templates
// (Send-to-one "message types" and Send-to-many "message types"). Phase 1 is a behavior-neutral
// foundation: it CENTRALIZES the existing entries + adds audience metadata, but it does NOT yet
// drive audience-aware filtering or the "Other templates" disclosure (deferred to later phases).
//
// TWO CONCEPTS, kept explicit via `templateKind`:
//   • 'manual' - editable email starters. NO token generation. Sent through the existing manual
//                paths (Send-to-one → /api/connect-send-direct-email; Send-to-many → the bulk
//                manual composer / /api/connect-send-bulk-message). Always fully editable.
//   • 'survey' - tokenized survey workflow (currently the student-only Casey-Fink invitation).
//                Respondent-locked; the survey backend is OWNED ELSEWHERE and untouched here.
//
// COMPATIBILITY NOTE: the Send-to-one entries intentionally keep the legacy `kind` field
// ('mode' | 'hydrate') that OutreachView already switches on (composer radio vs. draft hydration).
// The new product concept lives in the SEPARATE `templateKind` field so existing call sites that
// read `.key` / `.label` / `.active` / `.kind` keep working unchanged. Only one label changed in
// Phase 1: Send-to-one "Direct Message" → "Custom Message" (same key 'message', same behavior).

import { getPrimaryCategory } from '../contactCategories'

// ── Audience model (prepared for later phases; not yet used for filtering) ───────────────────────
export const AUDIENCES = {
  STUDENT:          'student',
  PRECEPTOR:        'preceptor',
  UNIT_LEADER:      'unit_leader',
  ACADEMIC_PARTNER: 'academic_partner',
  INTERVIEWER:      'interviewer',
  GENERIC:          'generic',
}

// Every audience, used as the "applies to anyone" set (e.g. Custom Message).
const ALL_AUDIENCES = [
  AUDIENCES.STUDENT, AUDIENCES.PRECEPTOR, AUDIENCES.UNIT_LEADER,
  AUDIENCES.ACADEMIC_PARTNER, AUDIENCES.INTERVIEWER, AUDIENCES.GENERIC,
]

// CAPACITY-RESPONSE-OUTREACH-2 (Owner correction): the Unit Leader Capacity Request is now a LIVE
// Send-to-many template - the outreach that makes a unit an expected responder through the approved
// launch -> Connect -> return -> confirm loop. The roster entry lives in SEND_TO_MANY_TEMPLATES below
// (single source of truth); this named export is a convenience reference for the launch flow and
// tests. See docs/product/CAPACITY_RESPONSE_OUTREACH.md.
export const CAPACITY_RESPONSE_TEMPLATE_KEY = 'unit_capacity_response_request'

// Canonical contact-category → audience map (categories come from lib/contactCategories.js).
// Nursing Executives / Other / unknown all fall through to 'generic'.
export const CATEGORY_TO_AUDIENCE = {
  'Academic Partners':  AUDIENCES.ACADEMIC_PARTNER,
  'Unit Leadership':    AUDIENCES.UNIT_LEADER,
  'Preceptors':         AUDIENCES.PRECEPTOR,
  'BNI Team':           AUDIENCES.INTERVIEWER,
  'Nursing Executives': AUDIENCES.GENERIC,
  'Other':              AUDIENCES.GENERIC,
}

// Map a contact category string to an audience. Unknown/null → 'generic'.
export function audienceFromCategory(category) {
  return CATEGORY_TO_AUDIENCE[category] || AUDIENCES.GENERIC
}

// Infer the audience for a contact row (uses the canonical primary-category resolver, which
// honors stored contacts.category and falls back to role inference). Null contact → 'generic'.
export function audienceForContact(contact) {
  if (!contact) return AUDIENCES.GENERIC
  return audienceFromCategory(getPrimaryCategory(contact))
}

// Infer the audience for a Send-to-one recipient. A student recipient is always 'student';
// a contact recipient is resolved from its category.
export function audienceForRecipient({ recipientType, contact } = {}) {
  if (recipientType === 'student') return AUDIENCES.STUDENT
  return audienceForContact(contact)
}

// Infer the audience for a Send-to-many bulk selection (source + optional contact category).
//   students source          → student
//   contacts source + category → mapped audience ('All'/none → generic)
//   paste / manual / mixed   → generic
export function audienceForBulkSelection({ source, contactCategory } = {}) {
  if (source === 'students') return AUDIENCES.STUDENT
  if (source === 'contacts') {
    if (!contactCategory || contactCategory === 'All') return AUDIENCES.GENERIC
    return audienceFromCategory(contactCategory)
  }
  return AUDIENCES.GENERIC
}

// ── Audience-aware template filtering (CONNECT-TEMPLATE-AUDIENCE-UX-2) ────────────────────────────

// Human label for a primary section. 'generic' (and unknown) → null so the heading falls back to
// the plain "Templates".
export const AUDIENCE_LABELS = {
  [AUDIENCES.STUDENT]:          'Students',
  [AUDIENCES.PRECEPTOR]:        'Preceptors',
  [AUDIENCES.UNIT_LEADER]:      'Unit Leaders',
  [AUDIENCES.ACADEMIC_PARTNER]: 'Academic Partners',
  [AUDIENCES.INTERVIEWER]:      'Interviewers',
  [AUDIENCES.GENERIC]:          null,
}
export function getAudienceLabel(audience) {
  return AUDIENCE_LABELS[audience] ?? null
}
export function getPrimarySectionTitle(audience) {
  const label = getAudienceLabel(audience)
  return label ? `Templates for ${label}` : 'Templates'
}

// Does a MANUAL template belong in the primary list for this audience? A template matches when its
// audiences include the inferred audience OR it is 'generic' (cross-audience, e.g. Custom Message /
// Announcement). A null audience (no inference yet) matches everything. Survey templates are handled
// separately in splitTemplatesForAudience (respondent-locked).
export function templateMatchesAudience(template, audience) {
  if (!template) return false
  if (!audience) return true
  const auds = template.audiences || []
  return auds.includes(audience) || auds.includes(AUDIENCES.GENERIC)
}

// Split a template list into { primary, other } for an inferred audience.
//   • audience == null            → no inference yet; show the whole list as primary (preserves the
//                                   pre-filtering UX, e.g. Send-to-one before a recipient is chosen).
//   • templateKind === 'survey'   → respondent-locked: appears in PRIMARY only when its declared
//                                   audiences include the inferred audience; otherwise fully hidden
//                                   (never relegated to "Other" - a survey must not look cross-audience).
//   • manual templates            → primary when they match the audience (or are listed in
//                                   alwaysPrimaryKeys, e.g. Custom Message); otherwise → other.
export function splitTemplatesForAudience(templates, audience, options = {}) {
  const { alwaysPrimaryKeys = [] } = options
  const list = Array.isArray(templates) ? templates : []
  if (!audience) return { primary: [...list], other: [] }
  const primary = []
  const other = []
  for (const t of list) {
    if (t.templateKind === 'survey') {
      if ((t.audiences || []).includes(audience)) primary.push(t)
      continue
    }
    if (alwaysPrimaryKeys.includes(t.key) || templateMatchesAudience(t, audience)) primary.push(t)
    else other.push(t)
  }
  return { primary, other }
}

// ── Send-to-one templates (drop-in for the former MSG_TYPES) ─────────────────────────────────────
// Reads-compatible with OutreachView: each entry has key/label/active/kind. Extra metadata
// (surface/templateKind/audiences/builderKey/composerMode) is additive and currently advisory.
export const SEND_TO_ONE_TEMPLATES = [
  {
    key: 'message', label: 'Custom Message', active: true, kind: 'mode',
    surface: 'one', templateKind: 'manual', composerMode: 'message', audiences: ALL_AUDIENCES,
  },
  {
    // CONNECT-SURVEY-RELABEL-4: visible label clarifies the student-only tokenized Casey-Fink workflow.
    // KEY preserved as 'survey' (composer mode / route / draft assumptions unchanged).
    key: 'survey', label: 'Student Casey-Fink Survey', active: true, kind: 'mode',
    surface: 'one', templateKind: 'survey', composerMode: 'survey', audiences: [AUDIENCES.STUDENT],
  },
  {
    key: 'preceptor_assignment', label: 'Preceptor Assignment', active: true, kind: 'hydrate',
    surface: 'one', templateKind: 'manual', builderKey: 'preceptor_assignment', audiences: [AUDIENCES.PRECEPTOR],
  },
  {
    key: 'preceptor_details_request', label: 'Preceptor Details Request', active: true, kind: 'hydrate',
    surface: 'one', templateKind: 'manual', builderKey: 'preceptor_details_request', audiences: [AUDIENCES.PRECEPTOR],
  },
  {
    // CONNECT-MANUAL-TEMPLATES-3: relabeled "Coordinator Acceptance Update" → "Academic Partner Update".
    // KEY preserved ('coordinator_acceptance') for draft/routing compatibility; builder copy repurposed.
    key: 'coordinator_acceptance', label: 'Academic Partner Update', active: true, kind: 'hydrate',
    surface: 'one', templateKind: 'manual', builderKey: 'coordinator_acceptance', audiences: [AUDIENCES.ACADEMIC_PARTNER],
  },
  {
    key: 'unit_leader_support_request', label: 'Unit Leader Support Request', active: true, kind: 'hydrate',
    surface: 'one', templateKind: 'manual', builderKey: 'unit_leader_support_request', audiences: [AUDIENCES.UNIT_LEADER],
  },
  {
    key: 'interviewer_availability_request', label: 'Interviewer Availability Request', active: true, kind: 'hydrate',
    surface: 'one', templateKind: 'manual', builderKey: 'interviewer_availability_request', audiences: [AUDIENCES.INTERVIEWER],
  },
]

// ── Send-to-many templates (drop-in for the former BULK_MSG_TYPES) ───────────────────────────────
// Reads-compatible with OutreachView (key/label). The four 'manual' entries also carry the bulk
// composer defaults (defaultSource / defaultContactCategory) that BulkManualComposer consumed as
// local maps; deriving those maps below keeps a single source of truth.
export const SEND_TO_MANY_TEMPLATES = [
  {
    // CONNECT-SURVEY-RELABEL-4: visible label clarifies the student-only bulk Casey-Fink workflow.
    // KEY preserved as 'survey_invitation' (composer mode / route / draft assumptions unchanged).
    key: 'survey_invitation', label: 'Student Casey-Fink Survey Invitation',
    surface: 'many', templateKind: 'survey', composerMode: 'survey', audiences: [AUDIENCES.STUDENT],
  },
  {
    key: 'academic_partner_placement', label: 'Academic Partner Placement Request',
    surface: 'many', templateKind: 'manual', builderKey: 'academic_partner_placement',
    defaultSource: 'contacts', defaultContactCategory: 'Academic Partners', audiences: [AUDIENCES.ACADEMIC_PARTNER],
  },
  {
    key: 'academic_partner_acceptance_orientation', label: 'Academic Partner Acceptance / Orientation Update',
    surface: 'many', templateKind: 'manual', builderKey: 'academic_partner_acceptance_orientation',
    defaultSource: 'contacts', defaultContactCategory: 'Academic Partners', audiences: [AUDIENCES.ACADEMIC_PARTNER],
  },
  {
    key: 'student_profile_invitation', label: 'Student Profile Form Invitation',
    surface: 'many', templateKind: 'manual', builderKey: 'student_profile_invitation',
    defaultSource: 'students', audiences: [AUDIENCES.STUDENT],
  },
  {
    key: 'student_interview_scheduling', label: 'Student Interview Scheduling Invitation',
    surface: 'many', templateKind: 'manual', builderKey: 'student_interview_scheduling',
    defaultSource: 'students', audiences: [AUDIENCES.STUDENT],
  },
  {
    key: 'interviewer_availability_bulk', label: 'Interviewer Availability / App Access Request',
    surface: 'many', templateKind: 'manual', builderKey: 'interviewer_availability_bulk',
    defaultSource: 'contacts', defaultContactCategory: 'BNI Team', audiences: [AUDIENCES.INTERVIEWER],
  },
  {
    // CAPACITY-RESPONSE-OUTREACH-2: asks unit leaders to submit the cohort capacity-response form
    // (/unit-form). Launched from At a Glance (Send capacity request) with the cohort, Unit Leadership
    // recipients, and this template preselected; a unit becomes an expected responder only after the
    // Owner's return confirmation records it as a cohort response target.
    key: 'unit_capacity_response_request', label: 'Unit Leader Capacity Request',
    surface: 'many', templateKind: 'manual', builderKey: 'unit_capacity_response_request',
    defaultSource: 'contacts', defaultContactCategory: 'Unit Leadership', audiences: [AUDIENCES.UNIT_LEADER],
  },
  {
    key: 'announcement_broadcast', label: 'Announcement / Broadcast',
    surface: 'many', templateKind: 'manual', builderKey: 'announcement_broadcast',
    defaultSource: 'students', audiences: [AUDIENCES.GENERIC],
  },
]

// ── Derived maps for BulkManualComposer (single source of truth; values are byte-identical to the
//    former local literals). Only 'manual' bulk templates participate - the survey entry is handled
//    by OutreachView's own survey zone, never by the manual composer. ────────────────────────────
const BULK_MANUAL_TEMPLATES = SEND_TO_MANY_TEMPLATES.filter(t => t.templateKind === 'manual')

export const BULK_DEFAULT_SOURCE = Object.fromEntries(
  BULK_MANUAL_TEMPLATES.filter(t => t.defaultSource).map(t => [t.key, t.defaultSource]),
)
export const BULK_DEFAULT_CONTACT_CATEGORY = Object.fromEntries(
  BULK_MANUAL_TEMPLATES.filter(t => t.defaultContactCategory).map(t => [t.key, t.defaultContactCategory]),
)
export const BULK_TEMPLATE_LABEL = Object.fromEntries(
  BULK_MANUAL_TEMPLATES.map(t => [t.key, t.label]),
)
