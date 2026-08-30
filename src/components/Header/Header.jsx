// WS2.0: application header container, extracted from App.jsx. Composes the existing
// header zones with NO behavior change. All state/handlers/refs remain owned by App.jsx
// and are passed in via the grouped `cohort` / `search` / `actions` props.
// ASPIRE-CHART: layout moved from inline styles to the .chart-header classes
// (chartTokens.css) so the band wraps into rows below 980px instead of clipping.
import HeaderBrand from './HeaderBrand'
import CohortPicker from './CohortPicker'
import UniversalSearch from './UniversalSearch'
import HeaderActions from './HeaderActions'
import WorkspaceSwitcher from './WorkspaceSwitcher'

export default function Header({ cohort, search, actions, workspace }) {
  return (
    <header className="chart-header">
      {/* Zone 1: Brand */}
      <HeaderBrand />

      {/* NGRP-WORKSPACE-1: explicit ASPIRE | NGRP switcher, brand-adjacent so
          the active workspace is legible before any content. Optional prop -
          absent, the header renders exactly as before. */}
      {workspace && <WorkspaceSwitcher active={workspace.active} onSwitch={workspace.onSwitch} />}

      <div className="chart-header-spacer" />

      {/* Zone 2: Status - cohort picker */}
      <CohortPicker {...cohort} />

      {/* Zone 3: Search */}
      <UniversalSearch {...search} />

      {/* Zone 4: Actions - connect + catalog + bell + user menu */}
      <div className="chart-header-actions">
        <HeaderActions {...actions} />
      </div>
    </header>
  )
}
