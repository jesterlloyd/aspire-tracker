// NGRP-WORKSPACE-1: the NGRP workspace's six sub-tabs. The chips spell
// ASPIRE, mirroring the ASPIRE workspace mnemonic. Data-only module (not in
// a component file) so react-refresh stays happy and App.jsx can derive the
// active sub-tab from the URL without importing a component.
export const NGRP_TABS = [
  { id: 'applicants', label: 'Applicants', chip: 'A' },
  { id: 'support',    label: 'Support',    chip: 'S' },
  { id: 'planning',   label: 'Planning',   chip: 'P' },
  { id: 'interviews', label: 'Interviews', chip: 'I' },
  { id: 'residency',  label: 'Residency',  chip: 'R' },
  { id: 'evaluation', label: 'Evaluation', chip: 'E' },
]

export function isNgrpTabId(id) {
  return NGRP_TABS.some(t => t.id === id)
}

// The valid NGRP sub-tab named by a pathname, or null for anything else
// (an unknown segment must never be treated - or persisted - as a tab).
export function ngrpTabFromPath(pathname) {
  const seg = String(pathname || '').split('/')[2] || ''
  return isNgrpTabId(seg) ? seg : null
}

// Where the Residency experience enters: the saved last-used tab when it is
// still a valid tab id, else the Applicants front door.
export function resolveNgrpEntryTab(saved) {
  return isNgrpTabId(saved) ? saved : 'applicants'
}
