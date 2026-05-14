import { useState } from 'react'
import { ASPIRE_STATUS_CONFIG } from '../lib/constants'
import StudentAvatar from './StudentAvatar'

function getInterviewStatus(s) {
  if (s.auto_recommendation === 'Recommend')
    return { label: 'Recommended',     color: '#166534', bg: '#f0fdf4' }
  if (s.auto_recommendation === 'Do Not Recommend')
    return { label: 'Not Recommended', color: '#991b1b', bg: '#fef2f2' }
  if (parseFloat(s.avg_composite_score) > 0)
    return { label: 'Rubric Submitted',color: '#1e40af', bg: '#eff6ff' }
  if (s.interview_scheduled_date)
    return { label: 'Scheduled',       color: '#92400e', bg: '#fffbeb' }
  return null
}

const PREF_COLORS = {
  '1st': { color: '#166534', bg: '#f0fdf4' },
  '2nd': { color: '#92400e', bg: '#fffbeb' },
  '3rd': { color: '#1e40af', bg: '#eff6ff' },
}

export default function StudentMatchCard({
  student, isSelected, onSelect, isReadOnly, isFading, isFadingIn, units,
}) {
  const classes = [
    'student-match-card',
    isReadOnly  ? 'smc-readonly' : '',
    isFading    ? 'smc-exit'     : '',
    isFadingIn  ? 'smc-enter'    : '',
  ].filter(Boolean).join(' ')

  const ivStatus = getInterviewStatus(student)

  const prefs = [
    { key: '1st', unitName: student.unit_preference_1 },
    { key: '2nd', unitName: student.unit_preference_2 },
    { key: '3rd', unitName: student.unit_preference_3 },
  ].filter(p => p.unitName)

  const getOpenCount = (unitName) => {
    const u = (units||[]).find(u => u.unit_name === unitName)
    return u ? (u.slots_remaining || 0) : null
  }

  return (
    <div
      className={classes}
      onClick={!isReadOnly ? () => onSelect(student) : undefined}
      role={!isReadOnly ? 'button' : undefined}
      style={{
        background:   isSelected ? '#eef1ff' : '#ffffff',
        border:       isSelected ? '2px solid #1D2567' : '1px solid #f3f4f6',
        borderRadius: '12px',
        padding:      '12px 14px',
        cursor:       isReadOnly ? 'default' : 'pointer',
        transition:   'all 0.15s ease',
        marginBottom: '8px',
        boxShadow:    isSelected ? '0 4px 16px rgba(29,37,103,0.18)' : '0 1px 3px rgba(0,0,0,0.04)',
        transform:    isSelected ? 'scale(1.01)' : 'scale(1)',
        position:     'relative',
      }}
    >
      {/* Selected badge */}
      {isSelected && (
        <div style={{ position:'absolute', top:'8px', right:'8px', background:'#1D2567', borderRadius:'20px', padding:'2px 8px', fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', color:'#ffffff' }}>
          Selected
        </div>
      )}

      {/* Top row: avatar + name + pills */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:'10px' }}>
        <StudentAvatar student={student} size={34} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'13px', color:'#1D2567', marginBottom:'2px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {student.last_name}, {student.first_name}
          </div>
          <div style={{ fontFamily:'DM Sans', fontSize:'10px', color:'#6b7280', marginBottom:'5px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
          </div>
          {/* Pills */}
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            {student.status && (
              <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', background:'#f0f3ff', color:'#1D2567', padding:'2px 7px', borderRadius:'20px' }}>
                {student.status}
              </span>
            )}
            {student.cumulative_gpa && (
              <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', background:'#f0fdf4', color:'#166534', padding:'2px 7px', borderRadius:'20px' }}>
                GPA {parseFloat(student.cumulative_gpa).toFixed(2)}
              </span>
            )}
            {ivStatus && (
              <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', background:ivStatus.bg, color:ivStatus.color, padding:'2px 7px', borderRadius:'20px' }}>
                {ivStatus.label}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Preferences */}
      {prefs.length > 0 && (
        <div style={{ marginTop:'8px', paddingTop:'8px', borderTop:'1px solid #f3f4f6', display:'flex', flexDirection:'column', gap:'3px' }}>
          {prefs.map(pref => {
            const open = getOpenCount(pref.unitName)
            const cfg  = PREF_COLORS[pref.key]
            return (
              <div key={pref.key} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', background:cfg.bg, color:cfg.color, padding:'1px 5px', borderRadius:'20px', flexShrink:0 }}>
                  {pref.key}
                </span>
                <span style={{ fontFamily:'DM Sans', fontSize:'10px', color:'#374151', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {pref.unitName}
                </span>
                {open !== null && (
                  <span style={{ fontFamily:'DM Sans', fontSize:'10px', fontWeight:600, color: open > 0 ? '#16a34a' : '#dc2626', flexShrink:0 }}>
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
