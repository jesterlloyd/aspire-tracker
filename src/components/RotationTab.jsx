import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import MatchingTab from './MatchingTab'
import PreceptorsTable from './PreceptorsTable'
import StudentCoverage from './StudentCoverage'
import RotationActivity from './RotationActivity'

export default function RotationTab(props) {
  const navigate     = useNavigate()
  const location     = useLocation()
  const { canEdit }  = useAuth()

  // ASPIRE-CHART: the Preceptors inner view is now ROUTED (deep-linkable,
  // back-button friendly) instead of component state that reset on reload.
  const activeSubTab = location.pathname.startsWith('/rotation/preceptors')
    ? 'preceptors'
    : location.pathname === '/rotation/activity'
      ? 'activity'
      : 'matrix'
  const precView = location.pathname === '/rotation/preceptors/coverage' ? 'coverage' : 'directory'

  const btnStyle = (key) => ({
    height: 32, padding: '0 13px', display: 'flex', alignItems: 'center',
    border: 'none', cursor: 'pointer', fontSize: 12,
    fontFamily: 'DM Sans,sans-serif', fontWeight: 500,
    background: activeSubTab === key ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
    color: activeSubTab === key ? '#fff' : 'var(--text-secondary,#4A5560)',
    transition: 'all 0.12s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', borderRadius: 7, border: '1px solid var(--border-input,rgba(29,37,103,0.10))', overflow: 'hidden', width: 'fit-content' }}>
          {/* ASPIRE-CHART approved rename: the visible label is honest - this
              is a click-to-place board, not a matrix. Route unchanged. */}
          <button onClick={() => navigate('/rotation/matrix')} style={btnStyle('matrix')}>
            Placement Board
          </button>
          <button onClick={() => navigate('/rotation/preceptors')} style={btnStyle('preceptors')}>
            Preceptors
          </button>
          {canEdit && (
            <button onClick={() => navigate('/rotation/activity')} style={btnStyle('activity')}>
              Activity
            </button>
          )}
        </div>
      </div>

      <div style={{ display: activeSubTab === 'matrix' ? 'block' : 'none', flex: 1, minHeight: 0 }}>
        <MatchingTab {...props} />
      </div>
      <div style={{ display: activeSubTab === 'preceptors' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        {/* Routed inner views: /rotation/preceptors and /rotation/preceptors/coverage */}
        <div style={{ padding: '0 20px 10px', flexShrink: 0 }}>
          <div style={{ display: 'flex', borderRadius: 7, border: '1px solid var(--border-input,rgba(29,37,103,0.10))', overflow: 'hidden', width: 'fit-content' }}>
            <button onClick={() => navigate('/rotation/preceptors')} style={btnStyle(precView === 'directory' ? 'preceptors' : '_x')}>
              Preceptor Directory
            </button>
            <button onClick={() => navigate('/rotation/preceptors/coverage')} style={btnStyle(precView === 'coverage' ? 'preceptors' : '_x')}>
              Student Coverage
            </button>
          </div>
        </div>
        <div style={{ display: precView === 'directory' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <PreceptorsTable
            students={props.students}
            cohortId={props.cohortId || props.activeCohort?.id}
            toast={props.toast}
          />
        </div>
        <div style={{ display: precView === 'coverage' ? 'block' : 'none', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <StudentCoverage
            students={props.students}
            units={props.units}
            cohortId={props.cohortId || props.activeCohort?.id}
            onNavigateToStudent={props.onNavigateToStudent}
          />
        </div>
      </div>
      {canEdit && (
        <div style={{ display: activeSubTab === 'activity' ? 'block' : 'none', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <RotationActivity
            students={props.students}
            units={props.units}
            cohortId={props.cohortId || props.activeCohort?.id}
            onNavigateToStudent={props.onNavigateToStudent}
            onReviewDecided={props.onReviewDecided}
            focusStudentId={props.focusActivityStudentId}
            onFocusConsumed={props.onFocusActivityConsumed}
            focusShiftLogId={props.focusActivityShiftLogId}
            onFocusShiftConsumed={props.onFocusActivityShiftConsumed}
          />
        </div>
      )}
    </div>
  )
}
