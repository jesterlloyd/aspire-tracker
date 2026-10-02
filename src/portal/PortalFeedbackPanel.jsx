import SharedFeedbackPanel from '../components/shared/SharedFeedbackPanel'
import { BUILD_ENV, BUILD_SHA } from '../lib/buildInfo'
import {
  PortalFeedbackApiError,
  clearPortalFeedbackRequestId,
  createPortalFeedbackRequestId,
  submitPortalFeedbackReport,
  validatePortalFeedbackClientPayload,
} from '../lib/portalFeedbackApiClient'

function errorText(code) {
  switch (code) {
    case 'request_id_payload_conflict':
      return 'This submission could not be safely retried. Please close this panel and start a new report.'
    case 'rate_limited':
      return 'Too many reports were sent recently. Please try again later.'
    case 'message_required':
      return 'Please enter a message.'
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
  portalType = 'unit_leader',
}) {
  const submit = async ({ category, message }) => {
    const intentKey = `${portalType}:utility`
    const requestId = createPortalFeedbackRequestId(intentKey)
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
        viewport_width: Math.max(1, Math.round(window.innerWidth || 1)),
        viewport_height: Math.max(1, Math.round(window.innerHeight || 1)),
      } : {}),
    }
    const checked = validatePortalFeedbackClientPayload(payload)
    if (!checked.ok) throw new Error(errorText(checked.error))
    try {
      await submitPortalFeedbackReport(payload)
      clearPortalFeedbackRequestId(intentKey)
    } catch (err) {
      const code = err instanceof PortalFeedbackApiError ? err.code : null
      throw new Error(errorText(code), { cause: err })
    }
  }

  const portalLabel = portalType === 'student' ? 'Student Portal'
    : portalType === 'academic_partner' ? 'Academic Partner Portal'
    : portalType === 'nursing_academic' ? 'Nursing Education & Leadership Portal'
    : 'Unit Leader Portal'

  return (
    <SharedFeedbackPanel
      activeTab={section}
      cohortName={portalLabel}
      isAuthenticated
      launcherRef={launcherRef}
      open={open}
      onOpenChange={onOpenChange}
      hidden={hidden}
      submitLabel="Send Feedback"
      showBugDetails={false}
      contextNote={`Will include: ${section || 'current section'} · ${portalLabel}`}
      onSubmit={submit}
    />
  )
}
