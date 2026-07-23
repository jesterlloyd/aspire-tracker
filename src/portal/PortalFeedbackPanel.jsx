import SharedFeedbackPanel from '../components/shared/SharedFeedbackPanel'
import { BUILD_ENV, BUILD_SHA } from '../lib/buildInfo'
import {
  PortalFeedbackApiError,
  clearPortalFeedbackRequestId,
  createPortalFeedbackRequestId,
  submitPortalFeedbackReport,
  validatePortalFeedbackClientPayload,
} from '../lib/portalFeedbackApiClient'

const INTENT_KEY = 'unit_leader:utility'

function errorText(code) {
  switch (code) {
    case 'request_id_payload_conflict':
      return 'This submission could not be safely retried. Please close this panel and start a new report.'
    case 'rate_limited':
      return 'Too many reports were sent recently. Please try again later.'
    case 'message_required':
      return 'Please enter a message.'
    case 'expected_behavior_required':
      return 'Please describe what you expected to happen.'
    case 'actual_behavior_required':
      return 'Please describe what actually happened.'
    case 'reproduction_steps_required':
      return 'Please add the steps to reproduce the issue.'
    default:
      return 'Something went wrong. Your text is still here so you can try again.'
  }
}

function typeForCategory(category) {
  return category === 'Bug Report' ? 'bug' : 'feedback'
}

function messageWithCategory(category, message) {
  return `[${category}]\n\n${message}`
}

export default function PortalFeedbackPanel({
  open,
  onOpenChange,
  hidden,
  launcherRef,
  pathname,
  section,
}) {
  const submit = async ({ category, message, bugFields }) => {
    const requestId = createPortalFeedbackRequestId(INTENT_KEY)
    const type = typeForCategory(category)
    const payload = {
      request_id: requestId,
      type,
      message: messageWithCategory(category, message),
      pathname,
      section,
      build_sha: BUILD_SHA,
      environment: BUILD_ENV,
      ...(type === 'bug' ? {
        expected_behavior: bugFields.expected_behavior,
        actual_behavior: bugFields.actual_behavior,
        reproduction_steps: bugFields.reproduction_steps,
        viewport_width: Math.max(1, Math.round(window.innerWidth || 1)),
        viewport_height: Math.max(1, Math.round(window.innerHeight || 1)),
      } : {}),
    }
    const checked = validatePortalFeedbackClientPayload(payload)
    if (!checked.ok) throw new Error(errorText(checked.error))
    try {
      await submitPortalFeedbackReport(payload)
      clearPortalFeedbackRequestId(INTENT_KEY)
    } catch (err) {
      const code = err instanceof PortalFeedbackApiError ? err.code : null
      throw new Error(errorText(code), { cause: err })
    }
  }

  return (
    <SharedFeedbackPanel
      activeTab={section}
      cohortName="Unit Leader Portal"
      isAuthenticated
      launcherRef={launcherRef}
      open={open}
      onOpenChange={onOpenChange}
      hidden={hidden}
      submitLabel="Send to ASPIRE"
      contextNote={`Will include: ${section || 'current section'} · Unit Leader Portal`}
      onSubmit={submit}
    />
  )
}
