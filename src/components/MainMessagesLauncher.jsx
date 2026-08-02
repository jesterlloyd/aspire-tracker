// MESSAGES-AUTOSCROLL-1 (Goal 2): the canonical Messages shortcut for the MAIN
// app's lower-right floating stack, directly above the Keith orb (Send Feedback
// stays lower-left). Same visual language as the portal launcher - a 52px navy
// circle with the MessageCircle icon, red unread badge, and hover tooltip - and
// the SAME Messages surface underneath: it deep-links to Connect > Messages
// (the staff MessagesWorkspace), gated by the same owner/admin + active rule
// and fed by the same shared ['messages_staff_unread'] query the header pin and
// Connect tab already observe. No second Messages implementation exists.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useStaffUnreadCount, IDLE_UNREAD_POLL_MS } from '../lib/messages/messagesPolling'
import { formatUnread, unreadLabel } from '../lib/messages/messagesConstants'

const F = 'DM Sans, sans-serif'

export default function MainMessagesLauncher() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [hover, setHover] = useState(false)
  // Same authorization the Connect Messages tab and header pin use.
  const canUseMessages = ['owner', 'admin'].includes(userProfile?.role) && userProfile?.is_active !== false
  const unread = useStaffUnreadCount({ intervalMs: IDLE_UNREAD_POLL_MS, enabled: canUseMessages })

  if (!canUseMessages) return null

  return (
    <>
      {hover && (
        <div style={{
          position: 'fixed', bottom: '158px', right: '28px',
          background: '#1D2567', color: '#fff', fontFamily: F, fontSize: 12, fontWeight: 500,
          padding: '6px 12px', borderRadius: 8, whiteSpace: 'nowrap',
          zIndex: 1001, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(29,37,103,0.25)',
        }}>
          Messages
        </div>
      )}
      <button
        type="button"
        data-tour="main-messages-launcher"
        aria-label={unreadLabel(unread)}
        onClick={() => navigate('/connect/messages')}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(false)}
        style={{
          // Directly above the 60px Keith orb (bottom 24): 24 + 60 + 12 gap.
          position: 'fixed', bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))', right: '28px',
          width: 52, height: 52, borderRadius: '50%',
          background: '#1D2567', color: '#fff', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(29,37,103,0.30)', zIndex: 1000,
        }}
      >
        <MessageCircle size={24} aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" style={{
            position: 'absolute', top: -5, right: -5,
            minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10,
            background: '#DC1E34', color: '#fff', fontFamily: F, fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #fff', boxSizing: 'border-box',
          }}>
            {formatUnread(unread)}
          </span>
        )}
      </button>
    </>
  )
}
