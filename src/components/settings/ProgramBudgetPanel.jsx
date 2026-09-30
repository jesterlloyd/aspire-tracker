// Settings > Program Budget (PROGRAM-BUDGET, 2026-09-27).
//
// The same view the Nursing Education & Leadership portal shows, fed by the staff endpoint: the
// Owner edits, an Admin reads the reader view (Owner decision, 2026-09-27). The header band is
// the Settings canon (SETTINGS-BAND-1): one subtitle line, and the page's actions beside the
// title. api/budget-staff.js is the authority; nothing here decides access.
import SettingsPageHeader from './SettingsPageHeader'
import ProgramBudgetView from '../budget/ProgramBudgetView'
import { STAFF_SOURCE } from '../budget/budgetApi'

export default function ProgramBudgetPanel() {
  return (
    <ProgramBudgetView
      source={STAFF_SOURCE}
      // BUDGET-POLISH-1 (Owner, 2026-09-29): the year's line is the subtitle, to save a line.
      yearLineInBand
      renderBand={(actions, accessNote, yearLine) => (
        <SettingsPageHeader
          id="program-budget-heading"
          title="Budget Tracker"
          subtitle={yearLine || 'One budget per fiscal year: its expenses, subscriptions and category plan.'}
          accessNote={accessNote}
          actions={actions}
        />
      )}
    />
  )
}
