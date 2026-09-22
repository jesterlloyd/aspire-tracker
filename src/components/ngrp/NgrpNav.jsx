// NGRP-WORKSPACE-2: the Residency workspace's five-tab navigation. Same
// .chart-nav primitives and spacing as UnifiedNav, so
// the two workspaces read as one application.
import { RefreshHint } from '../UnifiedNav'
import { NGRP_TABS } from '../../lib/ngrp/ngrpTabs'
import { NAV_ICONS } from '../../lib/navigationCanon'

const TAB_ICONS = {
  overview: NAV_ICONS.atAGlance,
  support: NAV_ICONS.support,
  profiles: NAV_ICONS.profilesInterest,
  residency: NAV_ICONS.residency,
  evaluation: NAV_ICONS.evaluation,
}

export default function NgrpNav({ activeTab, onSwitchTab }) {
  return (
    <nav className="chart-nav" aria-label="Residency workspace">
      {NGRP_TABS.map(({ id, label }) => {
        const isActive = activeTab === id
        const Icon = TAB_ICONS[id]
        return (
          <button
            key={id}
            onClick={() => onSwitchTab(id)}
            aria-label={`${label} tab`}
            aria-current={isActive ? 'page' : undefined}
            data-tour={`ngrp-tab-${id}`}
            className="chart-nav-tab"
            style={{
              borderBottom: isActive ? '2px solid var(--color-accent-primary,#1D2567)' : '2px solid transparent',
              color: isActive ? 'var(--color-accent-primary,#1D2567)' : 'var(--text-muted,#6B7280)',
              fontWeight: isActive ? 600 : 500,
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-caption,#374151)' }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-muted,#6B7280)' }}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        )
      })}

      <div className="chart-nav-refresh">
        <RefreshHint />
      </div>
    </nav>
  )
}
