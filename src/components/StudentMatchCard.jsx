import StudentAvatar from './StudentAvatar'

function getInterviewStatus(s) {
  if (s.auto_recommendation === 'Recommend')
    return { label: 'Recommended',     color: '#166534', bg: '#f0fdf4' }
  if (s.auto_recommendation === 'Do Not Recommend')
    return { label: 'Not Recommended', color: '#991b1b', bg: '#fef2f2' }
  if (parseFloat(s.avg_composite_score) > 0)
    return { label: 'Rubric Submitted', color: '#1e40af', bg: '#eff6ff' }
  if (s.interview_scheduled_date)
    return { label: 'Scheduled',        color: '#92400e', bg: '#fffbeb' }
  return null
}

const ORDINAL_COLORS = { '1st': '#059669', '2nd': '#B5895A', '3rd': '#7C8FD9' }

const TIER_BADGE = {
  1: { bg: '#059669', label: '1st Choice' },
  2: { bg: '#B5895A', label: '2nd Choice' },
  3: { bg: '#7C8FD9', label: '3rd Choice' },
}

export default function StudentMatchCard({
  student, isSelected, onSelect, isReadOnly, isFading, isFadingIn, units,
  focusedUnit,
}) {
  const classes = [
    'student-match-card',
    isReadOnly ? 'smc-readonly' : '',
    isFading   ? 'smc-exit'     : '',
    isFadingIn ? 'smc-enter'    : '',
  ].filter(Boolean).join(' ')

  const ivStatus = getInterviewStatus(student)

  const choiceTier = focusedUnit
    ? (student.unit_preference_1 === focusedUnit.unit_name ? 1
      : student.unit_preference_2 === focusedUnit.unit_name ? 2
      : student.unit_preference_3 === focusedUnit.unit_name ? 3
      : 4)
    : null

  const prefs = [
    { key: '1st', unitName: student.unit_preference_1 },
    { key: '2nd', unitName: student.unit_preference_2 },
    { key: '3rd', unitName: student.unit_preference_3 },
  ].filter(p => p.unitName)

  const getOpenCount = (unitName) => {
    const u = (units || []).find(u => u.unit_name === unitName)
    return u ? (u.slots_remaining || 0) : null
  }

  return (
    <div
      className={classes}
      onClick={!isReadOnly ? () => onSelect(student) : undefined}
      role={!isReadOnly ? 'button' : undefined}
      style={{
        display:      'flex',
        alignItems:   'stretch',
        background:   isSelected ? '#f8f9ff' : '#ffffff',
        border:       isSelected ? '2px solid #1D2567' : '1px solid #E5E7EB',
        borderRadius: '12px',
        padding:      '14px 16px',
        cursor:       isReadOnly ? 'default' : 'pointer',
        transition:   'all 0.15s ease',
        marginBottom: '8px',
        boxShadow:    isSelected ? '0 4px 16px rgba(29,37,103,0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* ── Left zone: avatar + identity + pills ── */}
      <div style={{ flex: '0 0 55%', display: 'flex', gap: '10px', minWidth: 0 }}>
        <StudentAvatar student={student} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '14px', color: '#1D2567', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {student.last_name}, {student.first_name}
          </div>
          <div style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#6b7280', marginBottom: '5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
          </div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {student.status && (
              <span style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px', background: '#f0f3ff', color: '#1D2567', padding: '2px 7px', borderRadius: '20px' }}>
                {student.status}
              </span>
            )}
            {student.cumulative_gpa && (
              <span style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px', background: '#f0fdf4', color: '#166534', padding: '2px 7px', borderRadius: '20px' }}>
                GPA {parseFloat(student.cumulative_gpa).toFixed(2)}
              </span>
            )}
            {ivStatus && (
              <span style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px', background: ivStatus.bg, color: ivStatus.color, padding: '2px 7px', borderRadius: '20px' }}>
                {ivStatus.label}
              </span>
            )}
            {/* Tier badge — only shown when a unit is focused */}
            {focusedUnit && choiceTier && choiceTier < 4 && (
              <span style={{
                fontFamily: 'DM Sans', fontWeight: 700, fontSize: '10px',
                background: TIER_BADGE[choiceTier].bg, color: '#fff',
                padding: '2px 8px', borderRadius: 999,
              }}>
                {TIER_BADGE[choiceTier].label}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Divider ── */}
      {prefs.length > 0 && (
        <div style={{ width: '1px', background: '#F3F4F6', margin: '0 12px', flexShrink: 0 }} />
      )}

      {/* ── Right zone: top 3 unit choices ── */}
      {prefs.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', minWidth: 0 }}>
          {prefs.map(pref => {
            const open = getOpenCount(pref.unitName)
            return (
              <div key={pref.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '11px', color: ORDINAL_COLORS[pref.key], flexShrink: 0, width: '26px' }}>
                  {pref.key}
                </span>
                <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#374151', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pref.unitName}
                </span>
                {open !== null && (
                  <span style={{ fontFamily: 'DM Sans', fontSize: '11px', fontWeight: 600, color: open > 0 ? '#16a34a' : '#9ca3af', flexShrink: 0 }}>
                    {open > 0 ? `${open} open` : 'Full'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
