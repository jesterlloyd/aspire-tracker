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
      renderBand={(actions, accessNote) => (
        <SettingsPageHeader
          id="program-budget-heading"
          title="Program Budget"
          subtitle="One budget per fiscal year: its expenses, subscriptions and category plan."
          accessNote={accessNote}
          actions={actions}
        />
      )}
    />
  )
}
