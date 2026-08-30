// WS2.0: application header container, extracted from App.jsx. Composes the existing
// header zones with NO behavior change. All state/handlers/refs remain owned by App.jsx
// and are passed in via the grouped `cohort` / `search` / `actions` props.
// ASPIRE-CHART: layout moved from inline styles to the .chart-header classes
// (chartTokens.css) so the band wraps into rows below 980px instead of clipping.
import HeaderBrand from './HeaderBrand'
import CohortPicker from './CohortPicker'
import NgrpCyclePicker from './NgrpCyclePicker'
import UniversalSearch from './UniversalSearch'
import HeaderActions from './HeaderActions'
import WorkspaceSwitcher from './WorkspaceSwitcher'

export default function Header({ cohort, search, actions, workspace, ngrpCycle }) {
  const inNgrp = workspace?.active === 'ngrp'
  return (
    <header className="chart-header">
      {/* Zone 1: Brand */}
      <HeaderBrand />

      {/* NGRP-WORKSPACE-1: explicit ASPIRE | NGRP switcher, brand-adjacent so
          the active workspace is legible before any content. The prop is
          passed ONLY for callers whose profile holds the ngrp_access
          capability - absent, the header renders exactly as before. */}
      {workspace && <WorkspaceSwitcher active={workspace.active} onSwitch={workspace.onSwitch} />}

      <div className="chart-header-spacer" />

      {/* Zone 2: the workspace's PRIMARY scope selector. ASPIRE keeps its
          cohort picker unchanged; NGRP swaps in the residency-cycle picker
          (a cycle is not a cohort - the two selections are separate state,
          and switching workspaces never changes the other side's pick). */}
      {inNgrp && ngrpCycle
        ? <NgrpCyclePicker {...ngrpCycle} />
        : <CohortPicker {...cohort} />}

      {/* Zone 3: Search */}
      <UniversalSearch {...search} />

      {/* Zone 4: Actions - connect + catalog + bell + user menu */}
      <div className="chart-header-actions">
        <HeaderActions {...actions} />
      </div>
    </header>
  )
}
