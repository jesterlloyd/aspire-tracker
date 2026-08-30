// WS2.0: application header container, extracted from App.jsx. Composes the existing
// header zones with NO behavior change. All state/handlers/refs remain owned by App.jsx
// and are passed in via the grouped `cohort` / `search` / `actions` props.
// ASPIRE-CHART: layout moved from inline styles to the .chart-header classes
// (chartTokens.css) so the band wraps into rows below 980px instead of clipping.
import HeaderBrand from './HeaderBrand'
import CohortPicker from './CohortPicker'
import ResidencyCohortPicker from './ResidencyCohortPicker'
import ExperiencePicker from './ExperiencePicker'
import UniversalSearch from './UniversalSearch'
import HeaderActions from './HeaderActions'

export default function Header({ cohort, search, actions, experience, residencyCohort }) {
  const inResidency = experience?.active === 'residency'
  return (
    <header className="chart-header">
      {/* Zone 1: Brand */}
      <HeaderBrand />

      <div className="chart-header-spacer" />

      {/* Zone 2: the Experience picker (Internship | Residency) beside the
          Cohort picker - two adjacent pills in the same treatment, before
          search. The experience prop is passed ONLY for callers whose profile
          holds the ngrp_access capability; absent, the header renders exactly
          as before NGRP existed. Internship keeps the ASPIRE cohort picker
          unchanged; Residency swaps in the residency COHORT picker (each row
          is an ngrp_cycles record internally - presentation language only).
          The two cohort selections are separate state, and switching
          experiences never changes the other side's pick. */}
      {experience && <ExperiencePicker active={experience.active} onSwitch={experience.onSwitch} />}
      {inResidency && residencyCohort
        ? <ResidencyCohortPicker {...residencyCohort} />
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
