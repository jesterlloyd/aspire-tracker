import { useNavigate, useLocation } from 'react-router-dom'
import MatchingTab from './MatchingTab'

function PreceptorsPlaceholder() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 320, gap: 12, fontFamily: 'DM Sans, sans-serif', padding: '48px 24px',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: 'var(--color-bg-elevated,#EDEEF4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 4,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>Preceptors</div>
      <div style={{ fontSize: 13, color: '#9ca3af', maxWidth: 320, textAlign: 'center', lineHeight: 1.6 }}>
        Preceptor management is coming soon. You'll be able to manage preceptor assignments and availability here.
      </div>
    </div>
  )
}

export default function RotationTab(props) {
  const navigate     = useNavigate()
  const location     = useLocation()
  const activeSubTab = location.pathname === '/rotation/preceptors' ? 'preceptors' : 'matrix'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', gap: 4, padding: '10px 24px 0',
        fontFamily: 'DM Sans, sans-serif', flexShrink: 0,
      }}>
        {[{ id: 'matrix', label: 'Matrix' }, { id: 'preceptors', label: 'Preceptors' }].map(({ id, label }) => {
          const isActive = activeSubTab === id
          return (
            <button
              key={id}
              onClick={() => navigate(`/rotation/${id}`)}
              style={{
                padding: '4px 14px', border: 'none', borderRadius: 999,
                background: isActive ? 'var(--color-accent-primary,#1D2567)' : 'var(--color-bg-elevated,#EDEEF4)',
                color: isActive ? '#fff' : 'var(--color-text-primary,#374151)',
                fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(29,37,103,0.08)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg-elevated,#EDEEF4)' }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div style={{ display: activeSubTab === 'matrix' ? 'block' : 'none', flex: 1, minHeight: 0 }}>
        <MatchingTab {...props} />
      </div>
      <div style={{ display: activeSubTab === 'preceptors' ? 'block' : 'none', flex: 1, minHeight: 0 }}>
        <PreceptorsPlaceholder />
      </div>
    </div>
  )
}
