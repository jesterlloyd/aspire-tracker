import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PortalFeedbackDialog from './PortalFeedbackDialog'
import PortalUtilityButton from './PortalUtilityButton'

const NOTICE_DAYS = 30
const NOTICE_COPY = 'This portal is optimized for desktop use. For the best experience, open it on a laptop or larger screen.'

function storageKey(profileId, role) {
  return `aspire.portal.desktopNotice.v1:${profileId}:${role}`
}

function isDismissed(profileId, role) {
  if (!profileId) return false
  try {
    const raw = window.localStorage?.getItem(storageKey(profileId, role))
    if (!raw) return false
    const parsed = JSON.parse(raw)
    const at = new Date(parsed.dismissedAt)
    if (Number.isNaN(at.getTime())) return false
    return Date.now() - at.getTime() < NOTICE_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

function persistDismissal(profileId, role) {
  if (!profileId) return false
  try {
    window.localStorage?.setItem(storageKey(profileId, role), JSON.stringify({ dismissedAt: new Date().toISOString() }))
    return true
  } catch {
    return false
  }
}

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])
  return narrow
}

function useUtilitySuppression(dialogOpen) {
  const [suppressed, setSuppressed] = useState(false)
  useEffect(() => {
    const compute = () => {
      const active = document.activeElement
      const inputFocused = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      const narrow = window.matchMedia('(max-width: 760px)').matches
      const modalOpen = Boolean(document.querySelector('[aria-modal="true"]:not(.ptl-feedback-dialog), .ptl-drawer, .ptl-sheet, .ptl-asn-manager'))
      setSuppressed(modalOpen || (narrow && inputFocused) || dialogOpen)
    }
    compute()
    document.addEventListener('focusin', compute)
    document.addEventListener('focusout', compute)
    window.addEventListener('resize', compute)
    return () => {
      document.removeEventListener('focusin', compute)
      document.removeEventListener('focusout', compute)
      window.removeEventListener('resize', compute)
    }
  }, [dialogOpen])
  return suppressed
}

function sectionFromPath(pathname) {
  if (pathname.startsWith('/portal/messages')) return 'Messages'
  const match = /^\/portal\/unit\/([^/]+)/.exec(pathname)
  if (!match) return 'Home'
  return match[1].replace(/-/g, ' ')
}

export default function PortalUtilityLayer({
  enabled = false,
  portalRole,
  portalType,
  profileId,
  pathname,
  unread = 0,
  messagesAuthorized = false,
  onOpenMessages,
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [sessionDismissedKey, setSessionDismissedKey] = useState(null)
  const [storedDismissedKey, setStoredDismissedKey] = useState(null)
  const feedbackRef = useRef(null)
  const narrow = useNarrowViewport()
  const suppressed = useUtilitySuppression(feedbackOpen)
  const onMessagesRoute = pathname.startsWith('/portal/messages')
  const noticeKey = profileId ? storageKey(profileId, portalRole) : null
  const storedDismissed = Boolean(noticeKey && storedDismissedKey === noticeKey) || isDismissed(profileId, portalRole)
  const sessionDismissed = Boolean(noticeKey && sessionDismissedKey === noticeKey)

  const noticeVisible = enabled && portalRole === 'unit_leader' && narrow && !onMessagesRoute && !storedDismissed && !sessionDismissed
  const section = useMemo(() => sectionFromPath(pathname), [pathname])

  const dismissNotice = () => {
    if (!persistDismissal(profileId, portalRole)) setSessionDismissedKey(noticeKey)
    setStoredDismissedKey(noticeKey)
  }

  const openMessages = useCallback(() => {
    if (onMessagesRoute) {
      const heading = document.querySelector('.ptl-msg-head h2, .ptl-section-title, h1, h2')
      if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
      heading?.focus?.()
      return
    }
    onOpenMessages?.()
  }, [onMessagesRoute, onOpenMessages])

  if (!enabled || portalRole !== 'unit_leader' || portalType !== 'unit_leader') return null

  return (
    <>
      {noticeVisible && (
        <div className="ptl-desktop-notice" role="status">
          <span>{NOTICE_COPY}</span>
          <button type="button" className="ptl-desktop-notice-action" onClick={dismissNotice}>Continue anyway</button>
        </div>
      )}

      {!suppressed && (
        <div className="ptl-utility-layer" aria-label="Portal utilities">
          <PortalUtilityButton side="left" label="Feedback / Bug" buttonRef={feedbackRef} onClick={() => setFeedbackOpen(true)} />
          {messagesAuthorized && (
            <PortalUtilityButton
              side="right"
              label="Messages"
              badge={unread}
              current={onMessagesRoute}
              onClick={openMessages}
            />
          )}
        </div>
      )}

      {feedbackOpen && (
        <PortalFeedbackDialog
          open={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          launcherRef={feedbackRef}
          pathname={pathname}
          section={section}
        />
      )}
    </>
  )
}
