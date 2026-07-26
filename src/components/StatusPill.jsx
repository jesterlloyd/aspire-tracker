// Shared ASPIRE status pill. Reuses the canonical status -> color map (ASPIRE_STATUS_CONFIG in
// src/lib/constants.js), the same source the main-app Student Profiles pills use, so no new status
// palette is introduced. Presentational and role-neutral: it renders the EXACT status text (labels
// preserved) with the canonical background/text/border, and never touches disposition detail.

import { ASPIRE_STATUS_CONFIG } from '../lib/constants'

export default function StatusPill({ status }) {
  const cfg = ASPIRE_STATUS_CONFIG[status] || ASPIRE_STATUS_CONFIG['Pending Outreach']
  return (
    <span className="aspire-status-pill" style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border }}>
      {status}
    </span>
  )
}
