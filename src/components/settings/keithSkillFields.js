// KEITH-SKILLS-1: shared Settings → Keith → Skills display constants. Leaf module
// (no imports) so both KeithSkillsPanel and KeithSkillDrawer can use them without an
// import cycle - the same arrangement knowledgeCategories.js provides for the
// Knowledge Center. Display vocabulary only; the api/keith-skills-admin endpoint is
// the authority for every value and every transition.

// Skill lifecycle states - the same four governance states StateBadge already colors
// (draft | active | deprecated | archived). No other state is used in this system.
export const KEITH_SKILL_STATES = ['draft', 'active', 'deprecated', 'archived']

// Runtime kill-switch pill (skills.enabled). Deliberately reads as a plain Yes/No in
// the table; the drawer carries the "not running" language.
export const ENABLED_STYLES = {
  yes: { label: 'Yes', bg: '#EDF2E2', color: '#166534', dot: '#3f9142' },
  no:  { label: 'No',  bg: '#f3f4f6', color: '#6b7280', dot: '#9ca3af' },
}

// data_classification pill. Confidential uses the chroma accent so it separates from
// the lifecycle greens/grays at a glance; unknown values fall back to StatusBadge's
// neutral gray pill.
export const CLASSIFICATION_STYLES = {
  public:       { label: 'Public',       bg: '#EDF5F4', color: '#275E63' },
  internal:     { label: 'Internal',     bg: '#EDEEF4', color: '#1D2567' },
  confidential: { label: 'Confidential', bg: '#F8EDF2', color: '#930045' },
}

// "Failures" in the list/drawer means hard errors only. denied and missing_data are
// governed outcomes (the skill correctly refused or asked for more), not failures.
export function failureCount(stats) {
  return Number(stats?.error) || 0
}

// snake_case / lowercase enum → readable label ('unit_leader' → 'Unit Leader').
export function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Array of enum values → 'Owner, Admin, Coordinator'; '-' when empty/missing.
export function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) return '-'
  return values.map(titleCase).join(', ')
}

export function fmtDate(value) {
  if (!value) return '-'
  const t = Date.parse(value)
  if (Number.isNaN(t)) return '-'
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtDateTime(value) {
  if (!value) return '-'
  const t = Date.parse(value)
  if (Number.isNaN(t)) return '-'
  return new Date(t).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}
