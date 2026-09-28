import { formatFullTimestamp, formatInboxTimestamp } from '../../lib/messages/messagesConstants'
import { useState } from 'react'
import { messageAuthorRole, messageBubbleDirection } from '../../lib/messages/messageBubbleDirection'
import { canReactTo } from '../../lib/messages/messagesTriage'
// MESSAGES-SIMPLIFY-1: reactions open by long press, right-click or the
// keyboard and show as a corner badge. Rendered only when reactionsEnabled is
// true; otherwise the bubble's output is unchanged.
import { ReactionBadge, ReactionBar } from './MessageReactions'
import { useReactionTrigger } from './useReactionTrigger'

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

function authorName(message, fromStaff) {
  return message?.author_label || message?.author_name || (fromStaff ? 'ASPIRE Team' : 'Portal participant')
}

export default function MessageBubble({
  message,
  perspective = 'portal',
  container: Container = 'article',
  showDate = false,
  dateLabel,
  className = '',
  dateClassName = '',
  bubbleClassName = '',
  bodyClassName = '',
  timeMode = 'full',
  // MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: all three default to the pre-Phase-3A
  // behavior (no reactions rendered), so a caller that never passes these keeps
  // byte-identical output.
  reactionsEnabled = false,
  onSetReaction,
  reactionsDisabled = false,
  reactionSetVersion = 1,
  // Staff threads name reactors; the viewer's own reads "You".
  viewerId = null,
}) {
  const direction = messageBubbleDirection(message, perspective)
  const fromStaff = messageAuthorRole(message) === 'staff'
  const incoming = direction === 'incoming'
  const outgoing = direction === 'outgoing'
  const neutral = direction === 'neutral'
  const displayName = authorName(message, fromStaff)
  const visibleTime = timeMode === 'short'
    ? formatInboxTimestamp(message?.created_at)
    : formatFullTimestamp(message?.created_at)
  const fullTime = formatFullTimestamp(message?.created_at)
  const directionLabel = outgoing ? 'outgoing' : incoming ? 'incoming' : 'system'
  // Staff react to participant messages, participants to staff messages, and
  // nobody to their own.
  const canReact = reactionsEnabled && !neutral && canReactTo(message, perspective)
  const { open, close, bubbleRef, pressing, triggerProps } = useReactionTrigger({ enabled: canReact })
  const [announcement, setAnnouncement] = useState('')
  const reactLabel = canReact
    ? `Message from ${displayName}, sent ${fullTime}: ${message?.body || ''}. Press Enter to react.`
    : undefined

  return (
    <>
      {showDate && (
        <li aria-hidden="true" className={`msg-date-separator ${dateClassName}`}>
          <span>{dateLabel || formatInboxTimestamp(message?.created_at)}</span>
        </li>
      )}
      <Container
        className={[
          'msg-bubble-row',
          `msg-bubble-row-${direction}`,
          className,
        ].filter(Boolean).join(' ')}
      >
        <div
          ref={bubbleRef}
          className={[
            'msg-bubble',
            `msg-bubble-${direction}`,
            neutral ? 'msg-bubble-neutral' : '',
            canReact ? 'msg-bubble-reactable' : '',
            pressing ? 'msg-bubble-pressing' : '',
            bubbleClassName,
          ].filter(Boolean).join(' ')}
          role={canReact ? 'button' : undefined}
          aria-label={reactLabel}
          {...triggerProps}
        >
          <div className="msg-bubble-meta">
            <span className="msg-bubble-author">{displayName}</span>
            {fromStaff && message?.author_name && message.author_name !== displayName && (
              <span className="msg-bubble-author-detail">{message.author_name}</span>
            )}
            <time
              className="msg-bubble-time"
              dateTime={message?.created_at || undefined}
              title={fullTime}
            >
              <span aria-hidden="true">{visibleTime}</span>
              <span style={srOnly}>{`${directionLabel} message from ${displayName}, sent ${fullTime}`}</span>
            </time>
          </div>
          <div className={`msg-bubble-body ${bodyClassName}`}>{message?.body}</div>
          {reactionsEnabled && (
            <ReactionBadge message={message} viewerId={viewerId} side={outgoing ? 'left' : 'right'} />
          )}
        </div>
        {open && (
          <ReactionBar
            message={message}
            anchorRef={bubbleRef}
            onClose={close}
            onSetReaction={onSetReaction}
            onAnnounce={setAnnouncement}
            disabled={reactionsDisabled}
            reactionSetVersion={reactionSetVersion}
          />
        )}
        {canReact && <span className="msg-reaction-live" role="status" aria-live="polite">{announcement}</span>}
      </Container>
    </>
  )
}
