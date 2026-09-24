import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import MatchingTab from './MatchingTab'
import PreceptorsTable from './PreceptorsTable'
import StudentCoverage from './StudentCoverage'
import RotationActivity from './RotationActivity'
import SegmentedPicker from './shared/SegmentedPicker'

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

  return (
    <div className="rotation-workspace">
      {/* UI canon: a section nav sits --aspire-page-top (24px) above the first card,
          and a card carries --aspire-gap-card (16px) itself - so the nav contributes 8. */}
      <div className="rotation-view-picker">
        {/* SEGMENTED-PICKER-1: the shared control. The ASPIRE-CHART approved rename
            stands - the visible label is honest, this is a click-to-place board and not
            a matrix - and the route is unchanged. */}
        <SegmentedPicker
          ariaLabel="Rotation views"
          value={activeSubTab}
          onChange={key => navigate(`/rotation/${key}`)}
          options={[
            { value: 'matrix', label: 'Placement Board' },
            { value: 'preceptors', label: 'Preceptors' },
            ...(canEdit ? [{ value: 'activity', label: 'Activity' }] : []),
          ]}
        />
      </div>

      <div className="rotation-matrix-view" style={{ display: activeSubTab === 'matrix' ? 'block' : 'none' }}>
        <MatchingTab {...props} />
      </div>
      <div style={{ display: activeSubTab === 'preceptors' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        {/* Routed inner views: /rotation/preceptors and /rotation/preceptors/coverage */}
        <div style={{ padding: '0 20px 10px', flexShrink: 0 }}>
          <SegmentedPicker
            ariaLabel="Preceptor views"
            value={precView}
            onChange={v => navigate(v === 'coverage' ? '/rotation/preceptors/coverage' : '/rotation/preceptors')}
            options={[
              { value: 'directory', label: 'Preceptor Directory' },
              { value: 'coverage', label: 'Student Coverage' },
            ]}
          />
        </div>
        <div style={{ display: precView === 'directory' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <PreceptorsTable
            students={props.students}
            units={props.units}
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
