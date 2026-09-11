// RESIDENCY-PORTAL-1: Residency Portal chrome.
//
// The section nav is the staff Residency workspace's five tabs in the shared
// .ptl-nav language every portal uses (the attached Nightfall taskbar row). The
// tab list is NGRP_TABS itself, so the portal and the staff app can never offer
// different tabs. The cohort picker is NOT here: it is the staff header's own
// ScopePicker, placed in the portal header by ResidencyPortal.
import { LayoutDashboard, Handshake, Users, Hospital, ChartColumn } from 'lucide-react'
import { PortalNavRefresh } from '../PortalRefresh'
import { NGRP_TABS } from '../../lib/ngrp/ngrpTabs'

const TAB_ICONS = {
  overview: LayoutDashboard,
  support: Handshake,
  profiles: Users,
  residency: Hospital,
  evaluation: ChartColumn,
}

export function ResidencyNav({ tab, onNavigate }) {
  return (
    <nav className="ptl-nav" aria-label="Residency Portal sections">
      {NGRP_TABS.map(({ id, label }) => {
        const Icon = TAB_ICONS[id] || LayoutDashboard
        return (
          <button
            key={id}
            type="button"
            className={`ptl-nav-item${tab === id ? ' ptl-nav-item-active' : ''}`}
            aria-current={tab === id ? 'page' : undefined}
            data-tour={`portal-nav-${id}`}
            onClick={() => onNavigate?.(id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="ptl-nav-label">{label}</span>
          </button>
        )
      })}
      <PortalNavRefresh tooltipLabel="Refresh" />
    </nav>
  )
}
