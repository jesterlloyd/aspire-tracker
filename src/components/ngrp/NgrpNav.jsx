// NGRP-WORKSPACE-1: the NGRP workspace's six-tab navigation. Same .chart-nav
// primitives, spacing, and mnemonic-chip treatment as UnifiedNav, so the two
// workspaces read as one application. The six tabs spell ASPIRE:
//   A Applicants · S Support · P Planning · I Interviews · R Residency · E Evaluation
import { RefreshHint } from '../UnifiedNav'
import { NGRP_TABS } from '../../lib/ngrp/ngrpTabs'

export default function NgrpNav({ activeTab, onSwitchTab }) {
  return (
    <nav className="chart-nav" aria-label="NGRP workspace">
      {NGRP_TABS.map(({ id, label, chip }) => {
        const isActive = activeTab === id
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
            <span className="chart-nav-chip" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              height: 20, minWidth: 20, padding: 0,
              borderRadius: 4, border: '1px solid #8B8F99',
              fontSize: 10, fontWeight: 600, letterSpacing: '0.01em',
              color: '#8B8F99', background: 'transparent',
              flexShrink: 0, lineHeight: 1,
            }}>
              {chip}
            </span>
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
