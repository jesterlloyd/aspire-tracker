import React from 'react'
import StudentAvatar from './StudentAvatar'
import { unitOpenSlots } from '../lib/placementDisplay'

const ORDINAL_COLORS = { '1st': '#059669', '2nd': '#B5895A', '3rd': '#7C8FD9' }
const LEGEND_DOTS    = [
  { color: '#059669', label: '1st choice' },
  { color: '#B5895A', label: '2nd choice' },
  { color: '#7C8FD9', label: '3rd choice' },
]

export default function MatchingBanner({ student, units, matches, onClearSelection }) {
  if (!student) return null  // guidance shown by subheader strip when no student selected

  const prefs = [
    { key: '1st', unitName: student.unit_preference_1 },
    { key: '2nd', unitName: student.unit_preference_2 },
    { key: '3rd', unitName: student.unit_preference_3 },
  ].filter(p => p.unitName)

  const getUnit = (unitName) => (units || []).find(u => u.unit_name === unitName)

  // ASPIRE-CHART one capacity source: live match count, same as the guard.
  const recommended = prefs.find(p => { const u = getUnit(p.unitName); return u && (unitOpenSlots(u, matches) || 0) > 0 })
  const recommendedUnit = recommended ? getUnit(recommended.unitName) : null

  const interviewStatus =
    student.auto_recommendation === 'Recommend'        ? 'Recommended' :
    student.auto_recommendation === 'Do Not Recommend' ? 'Not Recommended' :
    parseFloat(student.avg_composite_score) > 0        ? 'Rubric Submitted' :
    student.interview_scheduled_date                   ? 'Interview Scheduled' :
    'Pending'

  return (
    <div style={{
      background: '#ffffff', borderRadius: '12px',
      border: '1px solid #1D2567',
      boxShadow: '0 2px 12px rgba(29,37,103,0.1)',
      padding: '20px', marginBottom: '12px', position: 'relative',
    }}>
      {/* Close button */}
      {onClearSelection && (
        <button
          onClick={onClearSelection}
          title="Clear selection"
          style={{ position: 'absolute', top: '12px', right: '12px', background: '#f3f4f6', border: 'none', borderRadius: '6px', width: '26px', height: '26px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#6b7280', transition: 'background 0.15s ease' }}
          onMouseEnter={e => e.currentTarget.style.background = '#e5e7eb'}
          onMouseLeave={e => e.currentTarget.style.background = '#f3f4f6'}
        >×</button>
      )}

      <div style={{ display: 'flex', gap: '20px', paddingRight: onClearSelection ? '32px' : '0' }}>
        {/* ── Left zone: avatar + identity + pills ── */}
        <div style={{ flex: '0 0 50%', display: 'flex', gap: '12px', minWidth: 0 }}>
          <StudentAvatar student={student} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '16px', color: '#1D2567', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {student.last_name}, {student.first_name}
            </div>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '12px', color: '#6b7280', marginBottom: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
            </div>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {student.status && (
                <span style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: '11px', background: '#f0f3ff', color: '#1D2567', padding: '2px 8px', borderRadius: '20px' }}>
                  {student.status}
                </span>
              )}
              {student.cumulative_gpa && (
                <span style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: '11px', background: '#f0fdf4', color: '#166534', padding: '2px 8px', borderRadius: '20px' }}>
                  GPA {parseFloat(student.cumulative_gpa).toFixed(2)}
                </span>
              )}
              <span style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: '11px', background: '#f9fafb', color: '#6b7280', padding: '2px 8px', borderRadius: '20px' }}>
                {interviewStatus}
              </span>
            </div>
          </div>
        </div>

        {/* ── Right zone: Top 3 Unit Choices ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', marginBottom: '8px' }}>
            Top 3 Unit Choices
          </div>
          {prefs.length > 0 ? prefs.map(pref => {
            const unit = getUnit(pref.unitName)
            const open = unit ? (unitOpenSlots(unit, matches) || 0) : null
            return (
              <div key={pref.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '12px', color: ORDINAL_COLORS[pref.key], flexShrink: 0, width: '28px' }}>
                  {pref.key}
                </span>
                <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '13px', color: '#374151', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pref.unitName}
                </span>
                {open !== null && (
                  <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '12px', fontWeight: 600, color: open > 0 ? '#16a34a' : '#9ca3af', flexShrink: 0 }}>
                    {open > 0 ? `${open} open` : 'Full'}
                  </span>
                )}
              </div>
            )
          }) : (
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '12px', color: '#9ca3af' }}>No preferences set</div>
          )}
          {recommendedUnit && (
            <div style={{ marginTop: '6px', fontFamily: 'Plus Jakarta Sans', fontSize: '11px', color: '#059669', fontWeight: 600 }}>
              ✓ Recommended: {recommendedUnit.unit_name}
            </div>
          )}
        </div>
      </div>

      {/* Legend row */}
      <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        {LEGEND_DOTS.map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.color, flexShrink: 0 }} />
            <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '11px', color: '#6b7280' }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
