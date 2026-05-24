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
      <div style={{ padding: '10px 24px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', borderRadius: 7, border: '1px solid var(--border-input,rgba(29,37,103,0.10))', overflow: 'hidden', width: 'fit-content' }}>
          <button
            onClick={() => navigate('/rotation/matrix')}
            style={{ height: 32, padding: '0 13px', display: 'flex', alignItems: 'center', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'DM Sans,sans-serif', fontWeight: 500,
              background: activeSubTab === 'matrix' ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
              color: activeSubTab === 'matrix' ? '#fff' : 'var(--text-secondary,#4A5560)', transition: 'all 0.12s' }}
          >
            Matrix
          </button>
          <button
            onClick={() => navigate('/rotation/preceptors')}
            style={{ height: 32, padding: '0 13px', display: 'flex', alignItems: 'center', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'DM Sans,sans-serif', fontWeight: 500,
              background: activeSubTab === 'preceptors' ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
              color: activeSubTab === 'preceptors' ? '#fff' : 'var(--text-secondary,#4A5560)', transition: 'all 0.12s' }}
          >
            Preceptors
          </button>
        </div>
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
