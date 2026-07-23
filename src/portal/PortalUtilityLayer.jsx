import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import PortalFeedbackPanel from './PortalFeedbackPanel'
import PortalTeamMessagesPanel from './PortalTeamMessagesPanel'

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

function useUtilitySuppression(panelOpen) {
  const [suppressed, setSuppressed] = useState(false)
  useEffect(() => {
    const compute = () => {
      const active = document.activeElement
      const inputFocused = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      const narrow = window.matchMedia('(max-width: 760px)').matches
      const modalOpen = Boolean(document.querySelector('[aria-modal="true"]:not(.shared-feedback-panel):not(.ptl-team-message-panel), .ptl-drawer, .ptl-sheet, .ptl-asn-manager'))
      setSuppressed(modalOpen || (narrow && inputFocused && !panelOpen))
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
  }, [panelOpen])
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
  const [activePanel, setActivePanel] = useState(null)
  const [sessionDismissedKey, setSessionDismissedKey] = useState(null)
  const [storedDismissedKey, setStoredDismissedKey] = useState(null)
  const feedbackRef = useRef(null)
  const messagesRef = useRef(null)
  const narrow = useNarrowViewport()
  const suppressed = useUtilitySuppression(Boolean(activePanel))
  const onMessagesRoute = pathname.startsWith('/portal/messages')
  const noticeKey = profileId ? storageKey(profileId, portalRole) : null
  const storedDismissed = Boolean(noticeKey && storedDismissedKey === noticeKey) || isDismissed(profileId, portalRole)
  const sessionDismissed = Boolean(noticeKey && sessionDismissedKey === noticeKey)
  const section = useMemo(() => sectionFromPath(pathname), [pathname])

  const noticeVisible = enabled && portalRole === 'unit_leader' && narrow && !onMessagesRoute && !storedDismissed && !sessionDismissed

  const dismissNotice = () => {
    if (!persistDismissal(profileId, portalRole)) setSessionDismissedKey(noticeKey)
    setStoredDismissedKey(noticeKey)
  }

  const openFeedback = useCallback((next) => {
    setActivePanel(next ? 'feedback' : null)
  }, [])

  const openMessages = useCallback(() => {
    setActivePanel(current => (current === 'messages' ? null : 'messages'))
  }, [])

  const openFullMessages = useCallback(() => {
    setActivePanel(null)
    onOpenMessages?.()
  }, [onOpenMessages])

  if (!enabled || portalRole !== 'unit_leader' || portalType !== 'unit_leader') return null

  const utilitiesHidden = suppressed
  const visiblePanel = suppressed ? null : activePanel

  return (
    <>
      {noticeVisible && (
        <div className="ptl-desktop-notice" role="status">
          <span>{NOTICE_COPY}</span>
          <button type="button" className="ptl-desktop-notice-action" onClick={dismissNotice}>Continue anyway</button>
        </div>
      )}

      <PortalFeedbackPanel
        open={visiblePanel === 'feedback'}
        onOpenChange={openFeedback}
        hidden={utilitiesHidden || visiblePanel === 'messages'}
        launcherRef={feedbackRef}
        pathname={pathname}
        section={section}
      />

      {messagesAuthorized && !utilitiesHidden && visiblePanel !== 'feedback' && (
        <div className="ptl-team-message-launcher-wrap">
          <div className={`ptl-team-message-tooltip${visiblePanel === 'messages' ? '' : ' is-visible-on-hover'}`}>
            Messages
          </div>
          <button
            ref={messagesRef}
            type="button"
            className={`ptl-team-message-launcher${visiblePanel === 'messages' ? ' is-open' : ''}`}
            onClick={openMessages}
            aria-label="Open messages with the ASPIRE Team"
            aria-expanded={visiblePanel === 'messages'}
          >
            <MessageCircle size={24} aria-hidden="true" />
            {unread > 0 && <span className="ptl-team-message-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
          </button>
        </div>
      )}

      <PortalTeamMessagesPanel
        open={visiblePanel === 'messages'}
        onClose={() => setActivePanel(null)}
        launcherRef={messagesRef}
        unread={unread}
        onOpenFullMessages={openFullMessages}
      />
    </>
  )
}
