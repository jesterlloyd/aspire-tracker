// ASPIRE MESSAGES, PHASE 5B-i: the student's conversation thread.
//
// DORMANT: mounted only by PortalMessagesWorkspace.
//
// Uses the Phase 5A v2 endpoint through portalMessagesApiClient. The newest
// bounded page opens first and "Load earlier messages" pages BACKWARD, so the
// student lands on the message they were notified about rather than the first
// message ever sent.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import MessageBubble from '../../components/shared/MessageBubble'
import { getPortalThreadPage, portalSetMessageReaction } from '../../lib/messages/portalMessagesApiClient'
import {
  portalThreadQueryKey, prependOlderPage, nextThreadCursor, threadPageIsCurrent,
  PORTAL_THREAD_LIMIT_DEFAULT,
} from '../../lib/messages/portalThreadState'
import {
  PORTAL_NO_SELECTION, UL_PORTAL_NO_SELECTION, portalStatusIsClosed, portalStatusLabel, mapPortalMessagesError,
} from '../../lib/messages/portalMessagesConstants'
// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS
import { applyOptimisticReaction } from '../../lib/messages/reactionConstants'
import { useThreadAutoScroll } from '../../lib/messages/useThreadAutoScroll'
// A refused load because access ended is handed to the shell, which shows the
// no-access card instead of this view's Try again.
import { useReportAccessFailureEffect } from '../portalAccessSignal'

export default function PortalMessagesThread({
  variant = 'student',
  conversationId,
  onBack,
  showBack,
  refreshMs,
  onConversation,
  onMarkRead,
  // False while Messages is mounted but not the active portal view. The
  // workspace stays mounted so drafts and selection survive a view switch, so
  // this is what stops a hidden view from marking anything read.
  active = true,
  api = { getPortalThreadPage, portalSetMessageReaction },
}) {
  const markedRef = useRef(null)
  const queryClient = useQueryClient()

  const {
    data, isLoading, isError, error, refetch,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    // Conversation-scoped: React Query caches and cancels per conversation, so a
    // late response from a previous selection cannot land in this one.
    queryKey: portalThreadQueryKey(conversationId),
    queryFn: ({ pageParam, signal }) => api.getPortalThreadPage({
      conversationId, limit: PORTAL_THREAD_LIMIT_DEFAULT, cursor: pageParam, signal,
    }),
    initialPageParam: null,
    // has_more is authoritative. Inferring "more history" from a full page would
    // falsely offer another page whenever the oldest page is exactly limit long.
    getNextPageParam: (lastPage) => nextThreadCursor(lastPage) ?? undefined,
    enabled: Boolean(conversationId),
    refetchInterval: refreshMs || false,
    staleTime: 5 * 1000,
  })
  useReportAccessFailureEffect(isError, { status: error?.status, error: error?.code })

  const pages = useMemo(() => data?.pages || [], [data])
  const newestPage = pages[0] || null
  const conversation = newestPage?.conversation || null

  // Pages arrive newest-first; each page is chronological within itself. Older
  // pages are PREPENDED so the merged thread stays chronological, with no
  // duplicate and no re-sort.
  const messages = useMemo(
    () => pages.reduce((acc, p) => prependOlderPage(acc, p?.messages || []), []),
    [pages],
  )

  // MESSAGES-AUTOSCROLL-1: shared bottom-anchor management (same hook as the
  // staff workspace). Called before the early returns below per the rules of
  // hooks; `ready` is false until the thread has rendered data.
  const newestId = messages.length ? messages[messages.length - 1].id : null
  const {
    scrollRef: threadScrollRef, onScroll: onThreadScroll,
    showNewIndicator, jumpToLatest,
  } = useThreadAutoScroll({
    threadId: conversationId,
    ready: !isLoading && pages.length > 0,
    newestKey: newestId,
  })

  // MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: fails closed, matching the
  // archiveAvailable convention elsewhere - until a page confirms the
  // migration is applied, no reaction UI renders at all.
  const reactionsAvailable = pages.some((p) => p?.reactions_available === true)
  const reactionBusyRef = useRef(new Set())
  const [busyReactionIds, setBusyReactionIds] = useState(() => new Set())
  const [reactionError, setReactionError] = useState('')

  const setReaction = useCallback(async (messageId, nextKey) => {
    if (!messageId || reactionBusyRef.current.has(messageId)) return
    const threadQueryKey = portalThreadQueryKey(conversationId)
    reactionBusyRef.current.add(messageId)
    setBusyReactionIds(new Set(reactionBusyRef.current))
    setReactionError('')

    const previous = queryClient.getQueryData(threadQueryKey)
    const applyToMessages = (msgs, reactions) => (msgs || []).map((m) => (
      m.id === messageId ? { ...m, reactions } : m
    ))

    // Optimistic flip first; the caller sees the change immediately.
    queryClient.setQueryData(threadQueryKey, (old) => (old ? {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        messages: applyToMessages(page.messages, applyOptimisticReaction(
          page.messages?.find((m) => m.id === messageId)?.reactions, nextKey,
        )),
      })),
    } : old))

    try {
      const result = await api.portalSetMessageReaction({ messageId, reaction: nextKey })
      // Authoritative reconciliation: the server's fresh aggregation wins over
      // the optimistic guess.
      queryClient.setQueryData(threadQueryKey, (old) => (old ? {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          messages: applyToMessages(page.messages, result?.reactions),
        })),
      } : old))
    } catch (err) {
      // Revert to the exact pre-optimistic snapshot rather than guessing.
      queryClient.setQueryData(threadQueryKey, previous)
      setReactionError(mapPortalMessagesError(err?.status))
    } finally {
      reactionBusyRef.current.delete(messageId)
      setBusyReactionIds(new Set(reactionBusyRef.current))
    }
  }, [api, conversationId, queryClient])

  useEffect(() => {
    if (conversation) onConversation?.(conversation)
  }, [conversation, onConversation])

  // Mark read ONLY after the newest page loads successfully, and only while this
  // conversation is still the selected one. Loading an older page must never
  // mark read, so the token is keyed on the newest message rather than on any
  // fetch completing.
  const newestAt = newestPage?.messages?.length
    ? newestPage.messages[newestPage.messages.length - 1]?.created_at
    : null

  useEffect(() => {
    // Gate BEFORE the token is recorded. Gating in the callback instead would
    // burn the token while hidden, so returning to Messages would never mark the
    // conversation read. `active` is a dependency, so the effect re-runs and
    // marks read once the view becomes visible again.
    if (!active) return
    if (!conversationId || !newestPage) return
    if (!threadPageIsCurrent(newestPage, conversationId)) return
    const token = `${conversationId}:${newestAt || 'empty'}`
    if (markedRef.current === token) return
    markedRef.current = token
    onMarkRead?.(conversationId)
  }, [active, conversationId, newestPage, newestAt, onMarkRead])

  if (!conversationId) {
    return <div className="ptl-empty ptl-msg-noselect"><p className="ptl-muted">{variant === 'unit_leader' ? UL_PORTAL_NO_SELECTION : PORTAL_NO_SELECTION}</p></div>
  }

  if (isLoading) {
    return <div className="ptl-muted ptl-loading">Loading this conversation...</div>
  }

  if (isError) {
    return (
      <div className="ptl-card ptl-error">
        <p>{mapPortalMessagesError(error?.status)}</p>
        <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => refetch()}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  }

  const closed = portalStatusIsClosed(conversation?.status)

  return (
    <div className="ptl-msg-thread">
      <div className="ptl-msg-thread-head">
        {showBack && (
          <button type="button" className="ptl-icon-btn ptl-msg-back" onClick={onBack}>
            <ChevronLeft size={16} aria-hidden="true" /> Back to messages
          </button>
        )}
        <h3 className="ptl-msg-thread-subject">{conversation?.subject}</h3>
        <div className="ptl-msg-thread-meta">
          <span className={`ptl-chip ${closed ? 'ptl-chip-soft' : 'ptl-chip-ok'}`}>
            {portalStatusLabel(conversation?.status)}
          </span>
          {conversation?.category && (
            <span className="ptl-msg-row-cat">{conversation.category}</span>
          )}
        </div>
      </div>

      {/* MESSAGES-AUTOSCROLL-1: the wrapper anchors the floating "New messages"
          affordance; .ptl-msg-scroll remains the ONLY scrolling element (the hook
          only ever moves the container's own scrollTop, never the page - so on
          phone widths, where this container intentionally does not scroll, the
          hook is a natural no-op). */}
      <div className="ptl-msg-scrollwrap">
      <div className="ptl-msg-scroll" ref={threadScrollRef} onScroll={onThreadScroll}>
        {hasNextPage && (
          <button
            type="button"
            className="ptl-btn-outline ptl-btn-sm ptl-msg-loadearlier"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading...' : 'Load earlier messages'}
          </button>
        )}

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            perspective="portal"
            reactionsEnabled={reactionsAvailable}
            onSetReaction={setReaction}
            reactionsDisabled={busyReactionIds.has(m.id)}
          />
        ))}
        {reactionError && <p className="ptl-form-error" role="alert">{reactionError}</p>}
      </div>
      {showNewIndicator && (
        <button type="button" className="ptl-msg-newer-chip" onClick={jumpToLatest}>
          New messages ↓
        </button>
      )}
      </div>
    </div>
  )
}
