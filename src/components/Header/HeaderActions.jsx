// WS2.0: extracted verbatim from App.jsx header (Zone 3 — Connect + Action Center + user
// menu). No behavior change. State/handlers/refs remain owned by App.jsx and arrive as
// props. Navigation mechanism preserved exactly (Connect uses the passed react-router
// `navigate`). UserMenu and the floating Keith assistant are unchanged (Keith stays
// floating in App.jsx; it is NOT part of these header actions).
import { MessagesSquare, Settings } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import UserMenu from '../UserMenu'

export default function HeaderActions({
  cohorts, navigate, activeTab, bellRef, setShowActionCenter, actionBadgeCount,
  onRestartTour,
}) {
  return (
    <>
      {cohorts.length > 0 && (
        <Tooltip label="ASPIRE Connect" placement="bottom">
        <button
          data-tour="connect"
          aria-label="ASPIRE Connect"
          onClick={() => {
            const saved = localStorage.getItem('aspire.connect.lastTab')
            const tab = (['contacts','outreach','broadcasts'].includes(saved)) ? saved : 'contacts'
            navigate(`/connect/${tab}`)
          }}
          style={{
            position: 'relative', flexShrink: 0,
            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: activeTab === 'connect' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${activeTab === 'connect' ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.10)'}`,
            borderRadius: 8,
            color: activeTab === 'connect' ? '#fff' : 'rgba(255,255,255,0.75)',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
            overflow: 'visible',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
          onMouseLeave={e => e.currentTarget.style.background = activeTab === 'connect' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)'}
        >
          <MessagesSquare size={15} strokeWidth={1.9} />
          {activeTab === 'connect' && (
            <span style={{
              position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '5px solid rgba(255,255,255,0.65)',
              display: 'block',
            }} />
          )}
        </button>
        </Tooltip>
      )}
      {cohorts.length > 0 && (
        <Tooltip label="Action Center" placement="bottom">
        <button
          ref={bellRef}
          id="keith-bell-trigger"
          aria-label="Action Center"
          data-tour="action-center"
          onClick={() => setShowActionCenter(p => !p)}
          style={{
            position:'relative', flexShrink:0,
            width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center',
            background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.10)',
            borderRadius:8, color:'rgba(255,255,255,0.75)', cursor:'pointer',
            transition:'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}
          onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.06)'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {actionBadgeCount > 0 && (
            <span style={{ position:'absolute', top:-3, right:-3, minWidth:16, height:16, borderRadius:8, background:'#930045', color:'#fff', fontSize:10, fontWeight:700, fontFamily:'DM Sans', display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px', lineHeight:1, border:'1.5px solid #1D2567' }}>
              {actionBadgeCount >= 10 ? '9+' : actionBadgeCount}
            </span>
          )}
        </button>
        </Tooltip>
      )}

      {/* WS2.1: Settings utility — placed immediately before UserMenu. Same nav
          mechanism as ASPIRE Connect (react-router navigate). */}
      <Tooltip label="Settings" placement="bottom">
        <button
          aria-label="Settings"
          data-tour="settings"
          onClick={() => navigate('/settings/general')}
          style={{
            position:'relative', flexShrink:0,
            width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center',
            background: activeTab === 'settings' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${activeTab === 'settings' ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.10)'}`,
            borderRadius:8,
            color: activeTab === 'settings' ? '#fff' : 'rgba(255,255,255,0.75)',
            cursor:'pointer', transition:'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.14)'}
          onMouseLeave={e => e.currentTarget.style.background = activeTab === 'settings' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)'}
        >
          <Settings size={15} strokeWidth={1.9} />
        </button>
      </Tooltip>

      <UserMenu
        onRestartTour={onRestartTour}
      />
    </>
  )
}
