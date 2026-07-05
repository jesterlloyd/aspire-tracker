// KT-3a-1 → UI-1: governance lifecycle state badge. The pill mechanics moved to
// the shared ui/StatusBadge primitive (extracted verbatim); this file now owns
// only the DOMAIN color map for the four KT-1 lifecycle states
// (draft | active | deprecated | archived) and stays the import for Knowledge
// Center (and Templates in KT-3b). Colors unchanged - drawn from the existing
// Cedars-Sinai status palette. No other lifecycle state is used in this system.
import StatusBadge from '../ui/StatusBadge'

export const GOVERNANCE_STATE_STYLES = {
  draft:      { label: 'Draft',      bg: '#eef2fb', color: '#1D2567', dot: '#6b7fd7' },
  active:     { label: 'Active',     bg: '#EDF2E2', color: '#166534', dot: '#3f9142' },
  deprecated: { label: 'Deprecated', bg: '#FEF3C7', color: '#78350F', dot: '#d08700' },
  archived:   { label: 'Archived',   bg: '#f3f4f6', color: '#6b7280', dot: '#9ca3af' },
}

export default function StateBadge({ state }) {
  return <StatusBadge value={state} colorMap={GOVERNANCE_STATE_STYLES} />
}
