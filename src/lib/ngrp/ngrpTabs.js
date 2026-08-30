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
