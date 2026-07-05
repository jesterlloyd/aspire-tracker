// KT-3a-2a: shared Knowledge Center domain constants (leaf module - no imports -
// so both KnowledgeCenterPanel and KnowledgeEntryDrawer can use them without an
// import cycle). Mirrors the KT-1 schema vocabularies and the api/knowledge-admin.js
// validation caps so client-side validation matches the backend authority.

export const KNOWLEDGE_STATES = ['draft', 'active', 'deprecated', 'archived']

// Eight KT-1 categories (snake_case enum → display label).
export const CATEGORY_LABELS = {
  program_overview: 'Program Overview',
  eligibility_placement: 'Eligibility & Placement',
  interview_selection: 'Interview & Selection',
  rotations_matching: 'Rotations & Matching',
  student_requirements: 'Student Requirements',
  communication_guidance: 'Communication Guidance',
  terminology_navigation: 'Terminology & Navigation',
  faq: 'FAQ',
}
export const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS)

// Field caps - must match api/knowledge-admin.js.
export const CAPS = { title: 200, body: 50000, source: 2000 }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function isValidDateStr(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  return !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
}

export function fmtDate(value) {
  if (!value) return '-'
  const t = Date.parse(value)
  if (Number.isNaN(t)) return '-'
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
