// WS2.0: application header container, extracted from App.jsx. Composes the existing
// header zones with NO behavior change. All state/handlers/refs remain owned by App.jsx
// and are passed in via the grouped `cohort` / `search` / `actions` props.
// ASPIRE-CHART: layout moved from inline styles to the .chart-header classes
// (chartTokens.css) so the band wraps into rows below 980px instead of clipping.
//
// SCOPE-PICKER-1: Zone 2 was three components (ExperiencePicker, CohortPicker,
// ResidencyCohortPicker) rendering as two adjacent pills, with the cohort pill swapped
// by experience. It is now ONE Scope pill whose dropdown carries both dimensions.
// Assembling which cohort pane belongs to the current experience happens here, because
// the header is where "which experience am I in" is already known; ScopePicker itself
// stays presentational and knows nothing about NGRP.
import HeaderBrand from './HeaderBrand'
import ScopePicker from './scope/ScopePicker'
import InternshipCohortList from './scope/InternshipCohortList'
import ResidencyCohortList from './scope/ResidencyCohortList'
import UniversalSearch from './UniversalSearch'
import HeaderActions from './HeaderActions'
import {
  residencyCohortLabel, residencyCohortLive, residencyLabelIsState,
} from '../../lib/scopePickerLabels'

// Residency is offered only to callers who hold it; everyone else has exactly one
// experience, and the pane says so honestly rather than being hidden.
const INTERNSHIP = { id: 'internship', label: 'Internship', sub: 'ASPIRE student pathway' }
const RESIDENCY  = { id: 'residency',  label: 'Residency',  sub: 'New-graduate RN residency (NGRP)' }

export default function Header({ cohort, search, actions, experience, residencyCohort }) {
  const hasResidency = Boolean(experience)
  const activeExperience = experience?.active || 'internship'
  const inResidency = activeExperience === 'residency'

  // The cohort half of the pill, and the pane beneath it, both describe the experience
  // the user is ALREADY in. Nothing here reads the other experience's cohorts.
  const scope = inResidency && residencyCohort
    ? {
        cohortLabel: residencyCohortLabel(residencyCohort),
        cohortLive: residencyCohortLive(residencyCohort.activeCycle),
        cohortLabelDimmed: residencyLabelIsState(residencyCohort),
        pane: <ResidencyCohortList {...residencyCohort} />,
      }
    : {
        cohortLabel: cohort.activeCohort?.name || 'Select cohort',
        cohortLive: Boolean(cohort.activeCohort?.accepting_submissions),
        cohortLabelDimmed: !cohort.activeCohort,
        pane: (
          <InternshipCohortList
            cohorts={cohort.cohorts}
            sortedCohorts={cohort.sortedCohorts}
            activeCohort={cohort.activeCohort}
            activeCohortId={cohort.activeCohortId}
            onSelectCohort={cohort.handleCohortSwitch}
            canEdit={cohort.canEdit}
            onManageCohort={() => cohort.setShowManageCohort(true)}
            onNewCohort={() => cohort.setShowNewCohort(true)}
          />
        ),
      }

  return (
    <header className="chart-header">
      {/* Zone 1: Brand */}
      <HeaderBrand />

      <div className="chart-header-spacer" />

      {/* Zone 2: Scope (experience + cohort). Rendered whenever there is anything to
          scope: an ASPIRE cohort list, or the residency experience. A brand-new
          instance with no cohorts and no residency access has nothing to say and
          renders nothing, which is what the old CohortPicker did. */}
      {(cohort.cohorts.length > 0 || hasResidency) && (
        <ScopePicker
          experiences={hasResidency ? [INTERNSHIP, RESIDENCY] : [INTERNSHIP]}
          activeExperience={activeExperience}
          onSwitchExperience={experience?.onSwitch}
          cohortLabel={scope.cohortLabel}
          cohortLive={scope.cohortLive}
          cohortLabelDimmed={scope.cohortLabelDimmed}
          cohortPane={scope.pane}
        />
      )}

      {/* Zone 3: Search */}
      <UniversalSearch {...search} />

      {/* Zone 4: Actions - connect + catalog + bell + user menu */}
      <div className="chart-header-actions">
        <HeaderActions {...actions} />
      </div>
    </header>
  )
}
