import SharedFeedbackPanel from './shared/SharedFeedbackPanel'
import { openOutlookCompose } from '../lib/outlookCompose'

export default function FeedbackPanel({ activeTab, cohortName, isAuthenticated }) {
  const handleSend = async ({ category, message, bugFields, activeTab: tabLabel }) => {
    const bugDetail = category === 'Bug Report'
      ? `\nExpected behavior: ${bugFields.expected_behavior}\nActual behavior: ${bugFields.actual_behavior}\nReproduction steps: ${bugFields.reproduction_steps}\n`
      : ''
    const subject = `[${category}] ASPIRE Intelligence - ${tabLabel}`
    const body = `Category: ${category}\nReported from: ${tabLabel} · ${cohortName || 'Unknown cohort'}${bugDetail}\n\n${message}\n\n---\nSent via ASPIRE Intelligence feedback panel`

    openOutlookCompose({ to: 'JesterLloyd.Bautista@cshs.org', subject, body })
  }

  return (
    <SharedFeedbackPanel
      activeTab={activeTab}
      cohortName={cohortName}
      isAuthenticated={isAuthenticated}
      submitLabel="Send to Jester"
      onSubmit={handleSend}
    />
  )
}
