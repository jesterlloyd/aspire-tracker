import { useNavigate, useLocation } from 'react-router-dom'
import MatchingTab from './MatchingTab'
import PreceptorsTable from './PreceptorsTable'

export default function RotationTab(props) {
  const navigate     = useNavigate()
  const location     = useLocation()
  const activeSubTab = location.pathname === '/rotation/preceptors' ? 'preceptors' : 'matrix'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 20px 16px', flexShrink: 0 }}>
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
      <div style={{ display: activeSubTab === 'preceptors' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <PreceptorsTable
          students={props.students}
          cohortId={props.cohortId || props.activeCohort?.id}
          toast={props.toast}
        />
      </div>
    </div>
  )
}
