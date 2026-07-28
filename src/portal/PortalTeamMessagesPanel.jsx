import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, RefreshCw, RotateCcw, Send } from 'lucide-react'
import PortalMessagesThread from './messages/PortalMessagesThread'
import PortalReplyComposer from './messages/PortalReplyComposer'
import usePortalDialogFocus from './usePortalDialogFocus'
import {
  listPortalConversations,
  markPortalConversationRead,
  startGeneralTeamConversation,
} from '../lib/messages/portalMessagesApiClient'
import { appendPage, normalizeCursor } from '../lib/messages/inboxState'
import { PORTAL_ACTIVE_POLL_MS, PORTAL_INBOX_PAGE_SIZE } from '../lib/messages/portalMessagesPolling'
import { MESSAGE_MAX_BODY_CHARS, normalizeBody, validateBodyValue } from '../lib/messages/messagesConstants'
import {
  PORTAL_SEND_CONFIRMATION,
  PORTAL_SAFETY_NOTICE,
  mapPortalMessagesError,
  mapPortalConflict,
} from '../lib/messages/portalMessagesConstants'
import { portalThreadQueryKey } from '../lib/messages/portalThreadState'

function createRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isGeneralTeamConversation(row) {
  return row?.thread_kind === 'team_general'
}

export default function PortalTeamMessagesPanel({
  open,
  onClose,
  launcherRef,
  unread = 0,
  onOpenFullMessages,
  variant = 'student',
  // Academic Partner authorized schools (server-derived). Only used to let a MULTI-school AP pick the
  // school a NEW thread belongs to; the server verifies the choice. Single-school and non-AP ignore it.
  schools = [],
  api = { startGeneralTeamConversation },
}) {
  const qc = useQueryClient()
  const panelRef = useRef(null)
  const composeRef = useRef(null)
  const startRef = useRef(false)
  const [conversation, setConversation] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [composeMode, setComposeMode] = useState(false)
  const [requestId, setRequestId] = useState(null)
  const [draft, setDraft] = useState('')
  const [pendingStart, setPendingStart] = useState(false)
  const [err, setErr] = useState('')
  const [announcement, setAnnouncement] = useState('')
  // Multi-school Academic Partner: which authorized school a NEW thread is for. Defaults to the first.
  const apMultiSchool = variant === 'academic_partner' && Array.isArray(schools) && schools.length > 1
  const [schoolChoice, setSchoolChoice] = useState('')
  const effectiveSchool = apMultiSchool ? (schoolChoice || schools[0]) : null

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

  const latestGeneralConversation = useMemo(() => {
    const rows = (data?.pages || []).reduce(
      (acc, page) => appendPage(acc, page?.conversations || []),
      [],
    )
    return rows.find(isGeneralTeamConversation) || null
  }, [data])

  const activeConversationId = composeMode ? null : selectedId || latestGeneralConversation?.id || null
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

  const beginFreshCompose = useCallback(({ resetDraft = true } = {}) => {
    setConversation(null)
    setSelectedId(null)
    setComposeMode(true)
    setRequestId(createRequestId())
    setErr('')
    if (resetDraft) setDraft('')
    setTimeout(() => composeRef.current?.focus?.(), 30)
  }, [])

  useEffect(() => {
    if (!open) return
    if (!isLoading && !latestGeneralConversation && !selectedId && !composeMode && !requestId) {
      const timer = window.setTimeout(() => {
        setComposeMode(true)
        setRequestId(createRequestId())
      }, 0)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [composeMode, isLoading, latestGeneralConversation, open, requestId, selectedId])

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
    const stableRequestId = requestId || createRequestId()
    if (!requestId) setRequestId(stableRequestId)
    startRef.current = true
    setPendingStart(true)
    setErr('')
    try {
      const out = await api.startGeneralTeamConversation({
        requestId: stableRequestId,
        body: normalized,
        // Only a multi-school AP sends a school; the server verifies it and single-school auto-resolves.
        schoolKey: effectiveSchool || undefined,
      })
      setDraft('')
      setRequestId(null)
      setComposeMode(false)
      setSelectedId(out?.conversation_id || null)
      announce(out?.confirmation || 'Your message was sent to the ASPIRE Team.')
      refreshMessages()
    } catch (e) {
      setErr(e?.status === 409 ? mapPortalConflict(e?.reason) : mapPortalMessagesError(e?.status))
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
          <div className="ptl-team-message-title-block">
            <div className="ptl-team-message-icon" aria-hidden="true">
              <MessageCircle size={18} />
            </div>
            <div>
              <h2 id="ptl-team-message-title">Messages</h2>
              <p id="ptl-team-message-subtitle">ASPIRE Team</p>
            </div>
          </div>
          <div className="ptl-team-message-actions">
            {unread > 0 && <span className="ptl-team-message-unread">{unread > 99 ? '99+' : unread}</span>}
            <button
              type="button"
              className="ptl-keith-head-action ptl-team-message-new"
              onClick={() => beginFreshCompose()}
              aria-label="Start a new conversation"
            >
              <RotateCcw size={14} aria-hidden="true" /> New
            </button>
            <button type="button" className="ptl-keith-head-close ptl-team-message-close" onClick={onClose} aria-label="Close Messages">
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </header>

        <div className="ptl-team-message-body" aria-label="Messages with the ASPIRE Team">
          <p className="ptl-msg-guidance" id="ptl-team-message-guidance">{PORTAL_SAFETY_NOTICE}</p>
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
              variant={variant}
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
              {apMultiSchool && (
                <div className="ptl-team-start-school">
                  <label className="ptl-label" htmlFor="ptl-team-start-school">School</label>
                  <select id="ptl-team-start-school" className="ptl-input ptl-input-full"
                    value={effectiveSchool} onChange={(e) => setSchoolChoice(e.target.value)}>
                    {schools.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <label className="ptl-label" htmlFor="ptl-team-start-body">Message</label>
              <div className="ptl-msg-compose-row">
                <textarea
                  id="ptl-team-start-body"
                  ref={composeRef}
                  className="ptl-input ptl-input-full ptl-msg-textarea"
                  rows={2}
                  value={draft}
                  maxLength={MESSAGE_MAX_BODY_CHARS}
                  onChange={(e) => { setDraft(e.target.value); setErr('') }}
                  aria-describedby="ptl-team-start-help"
                />
                <button type="submit" className="ptl-msg-send-circle" disabled={!canStart} aria-label="Send message">
                  <Send size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="ptl-small" id="ptl-team-start-help">
                {`${normalized.length} of ${MESSAGE_MAX_BODY_CHARS} characters`}
              </div>
              {err && <p className="ptl-form-error" role="alert">{err}</p>}
              {pendingStart && <p className="ptl-small" role="status">Sending...</p>}
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
