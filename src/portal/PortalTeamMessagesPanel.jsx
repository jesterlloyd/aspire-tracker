import { useCallback, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, RefreshCw, Send, X } from 'lucide-react'
import PortalMessagesThread from './messages/PortalMessagesThread'
import PortalReplyComposer from './messages/PortalReplyComposer'
import usePortalDialogFocus from './usePortalDialogFocus'
import { listPortalConversations, markPortalConversationRead } from '../lib/messages/portalMessagesApiClient'
import { appendPage, normalizeCursor } from '../lib/messages/inboxState'
import { PORTAL_ACTIVE_POLL_MS, PORTAL_INBOX_PAGE_SIZE } from '../lib/messages/portalMessagesPolling'
import { MESSAGE_MAX_BODY_CHARS, normalizeBody, validateBodyValue } from '../lib/messages/messagesConstants'
import {
  PORTAL_SEND_CONFIRMATION,
  PORTAL_SAFETY_NOTICE,
  mapPortalMessagesError,
  mapPortalConflict,
} from '../lib/messages/portalMessagesConstants'
import { startUnitConversation } from './unit/unitLeaderApi'
import { portalThreadQueryKey } from '../lib/messages/portalThreadState'

const TEAM_SUBJECT = 'Message to the ASPIRE Team'
const TEAM_CATEGORY = 'Question'

function isAspireTeamConversation(row) {
  return row && !row.direct_student_name
}

export default function PortalTeamMessagesPanel({
  open,
  onClose,
  launcherRef,
  unread = 0,
  onOpenFullMessages,
}) {
  const qc = useQueryClient()
  const panelRef = useRef(null)
  const startRef = useRef(false)
  const [conversation, setConversation] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState('')
  const [pendingStart, setPendingStart] = useState(false)
  const [err, setErr] = useState('')
  const [announcement, setAnnouncement] = useState('')

  usePortalDialogFocus({
    open,
    dialogRef: panelRef,
    returnFocusRef: launcherRef,
    onEscape: onClose,
  })

  const {
    data, isLoading, isError, error, refetch,
  } = useInfiniteQuery({
    queryKey: ['portal_messages_list'],
    queryFn: ({ pageParam, signal }) =>
      listPortalConversations({ limit: PORTAL_INBOX_PAGE_SIZE, cursor: pageParam, signal }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => normalizeCursor(lastPage?.next_cursor) ?? undefined,
    enabled: open,
    refetchInterval: open ? PORTAL_ACTIVE_POLL_MS : false,
    staleTime: 10 * 1000,
  })

  const teamConversation = useMemo(() => {
    const rows = (data?.pages || []).reduce(
      (acc, page) => appendPage(acc, page?.conversations || []),
      [],
    )
    return rows.find(isAspireTeamConversation) || null
  }, [data])

  const activeConversationId = selectedId || teamConversation?.id || null
  const closed = conversation?.status === 'Closed'
  const normalized = normalizeBody(draft)
  const draftCheck = validateBodyValue(draft)
  const canStart = Boolean(!activeConversationId && draftCheck.ok && !pendingStart)

  const announce = useCallback((text) => {
    setAnnouncement('')
    setTimeout(() => setAnnouncement(text), 30)
  }, [])

  const refreshMessages = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['portal_messages_list'] })
    qc.invalidateQueries({ queryKey: ['portal_messages_unread'] })
    if (activeConversationId) qc.invalidateQueries({ queryKey: portalThreadQueryKey(activeConversationId) })
  }, [activeConversationId, qc])

  const handleMarkRead = useCallback(async (id) => {
    try {
      await markPortalConversationRead({ conversationId: id })
      qc.invalidateQueries({ queryKey: ['portal_messages_unread'] })
      qc.invalidateQueries({ queryKey: ['portal_messages_list'] })
    } catch {
      // Leave unread intact. The next successful newest-page render retries.
    }
  }, [qc])

  const handleSent = useCallback((out, opts) => {
    if (!opts?.refreshOnly) announce(out?.confirmation || PORTAL_SEND_CONFIRMATION)
    refreshMessages()
  }, [announce, refreshMessages])

  const startTeamConversation = async (event) => {
    event?.preventDefault?.()
    if (!canStart || startRef.current) return
    startRef.current = true
    setPendingStart(true)
    setErr('')
    try {
      const out = await startUnitConversation({
        destination: 'aspire',
        subject: TEAM_SUBJECT,
        category: TEAM_CATEGORY,
        body: normalized,
      })
      if (!out.ok) {
        const reason = out.status === 409 ? mapPortalConflict(out.data?.reason) : mapPortalMessagesError(out.status)
        throw new Error(reason)
      }
      setDraft('')
      setSelectedId(out.data?.conversation_id || null)
      announce('Your message was sent to the ASPIRE Team.')
      refreshMessages()
    } catch (e) {
      setErr(e?.message || 'Something went wrong loading your messages. Try again.')
    } finally {
      startRef.current = false
      setPendingStart(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="ptl-corner-backdrop" onClick={onClose} />
      <aside
        ref={panelRef}
        className="ptl-team-message-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ptl-team-message-title"
        aria-describedby="ptl-team-message-subtitle"
        tabIndex={-1}
      >
        <header className="ptl-team-message-head">
          <div className="ptl-team-message-icon" aria-hidden="true">
            <MessageCircle size={18} />
          </div>
          <div>
            <h2 id="ptl-team-message-title">ASPIRE Team</h2>
            <p id="ptl-team-message-subtitle">Messages</p>
          </div>
          {unread > 0 && <span className="ptl-team-message-unread">{unread > 99 ? '99+' : unread}</span>}
          <button type="button" className="ptl-team-message-close" onClick={onClose} aria-label="Close ASPIRE Team messages">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="ptl-team-message-body" aria-label="ASPIRE Team conversation history">
          {isLoading && <div className="ptl-muted ptl-loading">Loading your ASPIRE Team conversation...</div>}
          {isError && (
            <div className="ptl-card ptl-error">
              <p>{mapPortalMessagesError(error?.status)}</p>
              <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => refetch()}>
                <RefreshCw size={14} aria-hidden="true" /> Try again
              </button>
            </div>
          )}
          {!isLoading && !isError && activeConversationId && (
            <PortalMessagesThread
              variant="unit_leader"
              conversationId={activeConversationId}
              refreshMs={PORTAL_ACTIVE_POLL_MS}
              onConversation={setConversation}
              onMarkRead={handleMarkRead}
              active={open}
            />
          )}
          {!isLoading && !isError && !activeConversationId && (
            <div className="ptl-team-message-empty">
              <h3>No ASPIRE Team conversation yet</h3>
              <p className="ptl-muted">Send a message to start a conversation with the ASPIRE Team.</p>
            </div>
          )}
        </div>

        <div className="ptl-team-message-compose">
          {activeConversationId ? (
            <PortalReplyComposer
              conversationId={activeConversationId}
              closed={closed}
              announce={announce}
              onSent={handleSent}
            />
          ) : (
            <form onSubmit={startTeamConversation} className="ptl-team-start-form">
              <label className="ptl-label" htmlFor="ptl-team-start-body">Message</label>
              <textarea
                id="ptl-team-start-body"
                className="ptl-input ptl-input-full ptl-msg-textarea"
                rows={4}
                value={draft}
                maxLength={MESSAGE_MAX_BODY_CHARS}
                onChange={(e) => { setDraft(e.target.value); setErr('') }}
                aria-describedby="ptl-team-start-help ptl-team-start-safety"
              />
              <div className="ptl-small" id="ptl-team-start-help">
                {`${normalized.length} of ${MESSAGE_MAX_BODY_CHARS} characters`}
              </div>
              <p className="ptl-compose-note ptl-msg-safety" id="ptl-team-start-safety">{PORTAL_SAFETY_NOTICE}</p>
              {err && <p className="ptl-form-error" role="alert">{err}</p>}
              <button type="submit" className="ptl-btn ptl-msg-btn" disabled={!canStart}>
                <Send size={15} aria-hidden="true" /> {pendingStart ? 'Sending...' : 'Send message'}
              </button>
            </form>
          )}
          <button type="button" className="ptl-team-full-link" onClick={onOpenFullMessages}>
            Open full Messages
          </button>
        </div>

        <div role="status" aria-live="polite" className="ptl-visually-hidden">{announcement}</div>
      </aside>
    </>
  )
}
