import SharedFeedbackPanel from './shared/SharedFeedbackPanel'
import { openOutlookCompose } from '../lib/outlookCompose'

// HOME-1: `hidden` keeps the launcher off At a Glance (the home page has no floating chrome).
export default function FeedbackPanel({
  activeTab,
  cohortName,
  isAuthenticated,
  hidden = false,
  open,
  onOpenChange,
}) {
  const handleSend = async ({ category, message, activeTab: tabLabel }) => {
    const subject = `[${category}] ASPIRE Intelligence - ${tabLabel}`
    const body = `Category: ${category}\nReported from: ${tabLabel} · ${cohortName || 'Unknown cohort'}\n\n${message}\n\n---\nSent via ASPIRE Intelligence feedback panel`

    openOutlookCompose({ to: 'JesterLloyd.Bautista@cshs.org', subject, body })
  }

  return (
    <SharedFeedbackPanel
      activeTab={activeTab}
      cohortName={cohortName}
      isAuthenticated={isAuthenticated}
      submitLabel="Send Feedback"
      showBugDetails={false}
      hidden={hidden}
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={handleSend}
    />
  )
}
