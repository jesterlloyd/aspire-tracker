// NGRP-PLANNING-2: the residency-cohort form vocabulary, shared by every
// surface that reads or writes an ngrp_cycles row.
//
// DATA-ONLY MODULE (no JSX), for the same reason ngrpTabs.js is: the shapers
// and style tokens below are imported by three components, and keeping them
// out of a component file leaves react-refresh with component-only exports.
//
// The shapers are the ONE definition of "what the form thinks this cohort
// currently is". Dirty-checking works by comparing a form state to the shaper
// run over the server row, so a shaper that drifts from its form silently
// makes a card permanently dirty. There is exactly one copy of each.

export const F = 'DM Sans, sans-serif'

export const inputStyle = {
  height: 34, padding: '0 10px', border: '1px solid rgba(29,37,103,0.14)', borderRadius: 8,
  fontFamily: F, fontSize: 13, background: '#fff', color: '#191919', width: '100%', boxSizing: 'border-box',
}
export const labelStyle = { fontSize: 11.5, fontWeight: 600, color: '#4A5560', display: 'block', marginBottom: 4 }

export const btn = (primary = false, danger = false) => ({
  height: 32, padding: '0 14px', borderRadius: 8, fontFamily: F, fontSize: 12.5, fontWeight: 600,
  cursor: 'pointer', border: primary || danger ? 'none' : '1px solid rgba(29,37,103,0.15)',
  background: danger ? '#B3282D' : primary ? '#1D2567' : '#fff',
  color: primary || danger ? '#fff' : '#1D2567',
  display: 'inline-flex', alignItems: 'center', gap: 6,
})

export const errText = errors => (errors || []).map(e => e.message).join(' ')

export const cycleBasics = c => ({
  name: c?.name || '',
  status: c?.status || 'Planning',
  application_open_date: c?.application_open_date || '',
  application_deadline: c?.application_deadline || '',
  interview_window_start: c?.interview_window_start || '',
  interview_window_end: c?.interview_window_end || '',
  licensure_deadline: c?.licensure_deadline || '',
  residency_start_date: c?.residency_start_date || '',
  notes: c?.notes || '',
})

export const rulesOf = c => {
  const r = c?.qualification_rules || {}
  return {
    gpa_min: r.gpa_min ?? 3.0,
    max_paid_rn_months: r.max_paid_rn_months ?? 9,
    completion_window_months: r.completion_window_months ?? 12,
    require_accreditation: r.require_accreditation === true,
    nclex_exception_enabled: r.nclex_exception_enabled !== false,
    license_deadline_override: r.conditional?.license?.deadline || '',
  }
}

export const checklistOf = c => (Array.isArray(c?.application_checklist) && c.application_checklist.length
  ? c.application_checklist.map(i => ({ key: i.key, label: i.label, required: i.required !== false }))
  : null)

export const benchmarksOf = c => ({
  traditional_pct: c?.retention_benchmarks?.traditional_pct ?? '',
  organization_pct: c?.retention_benchmarks?.organization_pct ?? '',
})

export const unitsOf = data => (data?.units || []).map(u => ({
  unit_name: u.unit_name, is_active: u.is_active, capacity: u.capacity ?? '',
}))
