import { displayName } from '../lib/utils'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'

const OUTCOME_STYLE = {
  'Accepted':                   { bg:'#dcfce7', color:'#166534' },
  'Accepted with Reservations': { bg:'#fef3c7', color:'#92400e' },
  'Declined':                   { bg:'#fee2e2', color:'#991b1b' },
  'Pending Interview':          { bg:'#f3f4f6', color:'#6b7280' },
}

const PREF_STYLE = {
  '1st': { background: '#1d2567', color: '#ffffff' },
  '2nd': { background: '#dceff8', color: '#1d2567' },
  '3rd': { background: '#f4f1ec', color: '#191919' },
}

export default function StudentMatchCard({
  student, isSelected, onSelect, isReadOnly, isFading, isFadingIn,
}) {
  const outcome     = student.interview_outcome || 'Pending Interview'
  const outcomeCfg  = OUTCOME_STYLE[outcome] || OUTCOME_STYLE['Pending Interview']
  const statusCfg   = ASPIRE_STATUS_CONFIG[student.status] || ASPIRE_STATUS_CONFIG['Pending Outreach']

  const gpa      = student.cumulative_gpa
  const gpaBg    = gpa == null ? 'var(--sand)'  : gpa >= 3.5 ? '#dcfce7' : gpa >= 3.0 ? '#fef3c7' : 'var(--sand)'
  const gpaColor = gpa == null ? 'var(--raven)' : gpa >= 3.5 ? '#166534' : gpa >= 3.0 ? '#92400e' : 'var(--raven)'
  const gpaText  = gpa != null ? `GPA: ${parseFloat(gpa).toFixed(2)}` : 'GPA: N/A'

  const classes = [
    'student-match-card',
    isSelected  ? 'smc-selected'  : '',
    isReadOnly  ? 'smc-readonly'  : '',
    isFading    ? 'smc-exit'      : '',
    isFadingIn  ? 'smc-enter'     : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      onClick={!isReadOnly ? () => onSelect(student) : undefined}
      role={!isReadOnly ? 'button' : undefined}
    >
      {/* Row 1: Name + status pills */}
      <div className="smc-top">
        <span className="smc-name">{displayName(student)}</span>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3, flexShrink:0 }}>
          {student.status && (
            <span style={{ fontSize:10, fontWeight:700, padding:'1px 7px', borderRadius:10, background:statusCfg.bg, color:statusCfg.text, border:`1px solid ${statusCfg.border}`, whiteSpace:'nowrap' }}>
              {student.status}
            </span>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:10, color:'#6b7280' }}>Interview:</span>
            <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background:outcomeCfg.bg, color:outcomeCfg.color, whiteSpace:'nowrap' }}>
              {outcome}
            </span>
          </div>
        </div>
      </div>

      {/* Row 2: School · Shift  |  GPA on right */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:3 }}>
        <div className="smc-school">
          {student.school}
          {student.shift_availability && (
            <span style={{ color:'#9ca3af', fontSize:11 }}> · {student.shift_availability}</span>
          )}
        </div>
        <span style={{ background:gpaBg, color:gpaColor, fontSize:11, fontWeight:600, padding:'1px 6px', borderRadius:4, flexShrink:0, marginLeft:6 }}>
          {gpaText}
        </span>
      </div>

      {/* Row 3: Preference pills */}
      <div className="smc-pref-pills" style={{ marginTop:6 }}>
        <PrefPill rank="1st" name={student.unit_preference_1} />
        <PrefPill rank="2nd" name={student.unit_preference_2} />
        <PrefPill rank="3rd" name={student.unit_preference_3} />
      </div>
    </div>
  )
}

function PrefPill({ rank, name }) {
  const style = PREF_STYLE[rank] || PREF_STYLE['3rd']
  return name ? (
    <span className="smc-pref-pill" style={{ background: style.background, color: style.color }}>
      <span className="smc-pref-rank" style={{ opacity:0.65 }}>{rank}:</span> {name}
    </span>
  ) : (
    <span className="smc-pref-pill" style={{ background:'#f3f4f6', color:'#9ca3af' }}>
      <span className="smc-pref-rank">{rank}:</span> Not set
    </span>
  )
}
