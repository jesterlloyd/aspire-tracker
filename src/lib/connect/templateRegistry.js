// src/lib/connect/templateRegistry.js
//
// CONNECT-TEMPLATE-REGISTRY-1 — single source of truth for ASPIRE Connect Outreach templates
// (Send-to-one "message types" and Send-to-many "message types"). Phase 1 is a behavior-neutral
// foundation: it CENTRALIZES the existing entries + adds audience metadata, but it does NOT yet
// drive audience-aware filtering or the "Other templates" disclosure (deferred to later phases).
//
// TWO CONCEPTS, kept explicit via `templateKind`:
//   • 'manual' — editable email starters. NO token generation. Sent through the existing manual
//                paths (Send-to-one → /api/connect-send-direct-email; Send-to-many → the bulk
//                manual composer / /api/connect-send-bulk-message). Always fully editable.
//   • 'survey' — tokenized survey workflow (currently the student-only Casey-Fink invitation).
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

// ── Send-to-one templates (drop-in for the former MSG_TYPES) ─────────────────────────────────────
// Reads-compatible with OutreachView: each entry has key/label/active/kind. Extra metadata
// (surface/templateKind/audiences/builderKey/composerMode) is additive and currently advisory.
export const SEND_TO_ONE_TEMPLATES = [
  {
    key: 'message', label: 'Custom Message', active: true, kind: 'mode',
    surface: 'one', templateKind: 'manual', composerMode: 'message', audiences: ALL_AUDIENCES,
  },
  {
    key: 'survey', label: 'Survey Invitation', active: true, kind: 'mode',
    surface: 'one', templateKind: 'survey', composerMode: 'survey', audiences: [AUDIENCES.STUDENT],
  },
  {
    key: 'preceptor_assignment', label: 'Preceptor Assignment', active: true, kind: 'hydrate',
    surface: 'one', templateKind: 'manual', builderKey: 'preceptor_assignment', audiences: [AUDIENCES.PRECEPTOR],
  },
  {
    key: 'coordinator_acceptance', label: 'Coordinator Acceptance Update', active: true, kind: 'hydrate',
    surface: 'one', templateKind: 'manual', builderKey: 'coordinator_acceptance', audiences: [AUDIENCES.ACADEMIC_PARTNER],
  },
]

// ── Send-to-many templates (drop-in for the former BULK_MSG_TYPES) ───────────────────────────────
// Reads-compatible with OutreachView (key/label). The four 'manual' entries also carry the bulk
// composer defaults (defaultSource / defaultContactCategory) that BulkManualComposer consumed as
// local maps; deriving those maps below keeps a single source of truth.
export const SEND_TO_MANY_TEMPLATES = [
  {
    key: 'survey_invitation', label: 'Survey Invitation',
    surface: 'many', templateKind: 'survey', composerMode: 'survey', audiences: [AUDIENCES.STUDENT],
  },
  {
    key: 'academic_partner_placement', label: 'Academic Partner Placement Request',
    surface: 'many', templateKind: 'manual', builderKey: 'academic_partner_placement',
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
    key: 'announcement_broadcast', label: 'Announcement / Broadcast',
    surface: 'many', templateKind: 'manual', builderKey: 'announcement_broadcast',
    defaultSource: 'students', audiences: [AUDIENCES.GENERIC],
  },
]

// ── Derived maps for BulkManualComposer (single source of truth; values are byte-identical to the
//    former local literals). Only 'manual' bulk templates participate — the survey entry is handled
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
