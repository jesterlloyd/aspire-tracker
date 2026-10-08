// PORTAL-CONNECT-1 (Owner, 2026-10-07): the ASPIRE Connect header icon, as one component.
//
// HeaderActions.jsx draws the staff app's button inline (its state, its destinations); this is
// the SAME drawing (36px nightfall control, MessagesSquare, the pin badge, the active caret) for a
// portal header, where the destinations are the portal's own. Keep the two visually identical: a
// change to the look lands here and in HeaderActions together.
import { MessagesSquare } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { pinBadgeStyle } from '../../lib/badgeTokens'
import { formatUnread } from '../../lib/messages/messagesConstants'

export default function ConnectIconButton({ active = false, badge = 0, ariaLabel = 'ASPIRE Connect', onClick, dataTour = 'portal-connect' }) {
  const rest = active ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)'
  return (
    <Tooltip label="Connect" placement="bottom">
      <button
        type="button"
        data-tour={dataTour}
        aria-label={ariaLabel}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        style={{
          position: 'relative', flexShrink: 0,
          width: 'var(--header-control-height, 36px)', height: 'var(--header-control-height, 36px)', boxSizing: 'border-box', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: rest,
          border: `1px solid ${active ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.10)'}`,
          borderRadius: 8,
          color: active ? '#fff' : 'rgba(255,255,255,0.75)',
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
          overflow: 'visible',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
        onMouseLeave={e => { e.currentTarget.style.background = rest }}
      >
        <MessagesSquare size={15} strokeWidth={1.9} />
        {badge > 0 && <span aria-hidden="true" style={pinBadgeStyle}>{formatUnread(badge)}</span>}
        {active && (
          <span aria-hidden="true" style={{
            position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '6px solid rgba(255,255,255,0.92)', display: 'block',
          }} />
        )}
      </button>
    </Tooltip>
  )
}
