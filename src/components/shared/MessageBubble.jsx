import { formatFullTimestamp, formatInboxTimestamp } from '../../lib/messages/messagesConstants'
import { messageAuthorRole, messageBubbleDirection } from '../../lib/messages/messageBubbleDirection'
// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: rendered only when reactionsEnabled is
// true (see the prop below). When it is false or omitted, this import is
// simply unused and the bubble's output is byte-identical to before.
import MessageReactions from './MessageReactions'

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
          className={[
            'msg-bubble',
            `msg-bubble-${direction}`,
            neutral ? 'msg-bubble-neutral' : '',
            bubbleClassName,
          ].filter(Boolean).join(' ')}
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
            <MessageReactions message={message} onSetReaction={onSetReaction} disabled={reactionsDisabled} />
          )}
        </div>
      </Container>
    </>
  )
}
