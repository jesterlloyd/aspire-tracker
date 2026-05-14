import React from 'react'

const CHOICE_CONFIG = {
  '1st': { label: '1st', color: '#166534', bg: '#f0fdf4', border: '#86efac' },
  '2nd': { label: '2nd', color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  '3rd': { label: '3rd', color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe' },
}

export default function MatchingBanner({ student, units }) {
  if (!student) {
    return (
      <div style={{
        padding:'12px 18px', background:'#f8f9ff',
        border:'1px dashed #c7d2fe', borderRadius:'10px', marginBottom:'12px',
        textAlign:'center', fontFamily:'DM Sans', fontSize:'12px', color:'#9ca3af',
      }}>
        Select a student from the Student Pool to view compatible units.
      </div>
    )
  }

  const prefs = [
    { key:'1st', unitName: student.unit_preference_1 },
    { key:'2nd', unitName: student.unit_preference_2 },
    { key:'3rd', unitName: student.unit_preference_3 },
  ].filter(p => p.unitName)

  const getUnit = (unitName) => (units||[]).find(u => u.unit_name === unitName)

  const recommended = prefs.find(p => {
    const u = getUnit(p.unitName)
    return u && (u.slots_remaining || 0) > 0
  })
  const recommendedUnit = recommended ? getUnit(recommended.unitName) : null

  const interviewStatus =
    student.auto_recommendation === 'Recommend' ? 'Recommended' :
    student.auto_recommendation === 'Do Not Recommend' ? 'Not Recommended' :
    parseFloat(student.avg_composite_score) > 0 ? 'Rubric Submitted' :
    student.interview_scheduled_date ? 'Interview Scheduled' :
    'Pending'

  return (
    <div style={{
      background:'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)',
      borderRadius:'12px', padding:'14px 18px', marginBottom:'12px',
    }}>
      {/* Student info row */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px', marginBottom:'10px' }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'14px', color:'#ffffff', marginBottom:'3px' }}>
            Matching: {student.last_name}, {student.first_name}
          </div>
          <div style={{ fontFamily:'DM Sans', fontSize:'11px', color:'rgba(255,255,255,0.65)', display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
            <span>{student.school}</span>
            {student.cumulative_gpa && (
              <>
                <span style={{ opacity:0.4 }}>·</span>
                <span style={{ background:'rgba(255,255,255,0.15)', padding:'1px 7px', borderRadius:'20px', fontWeight:700, color:'#ffffff' }}>
                  GPA {parseFloat(student.cumulative_gpa).toFixed(2)}
                </span>
              </>
            )}
            <span style={{ opacity:0.4 }}>·</span>
            <span style={{ color:'rgba(255,255,255,0.75)' }}>{interviewStatus}</span>
          </div>
        </div>
        {recommendedUnit && (
          <div style={{ background:'#f0fdf4', borderRadius:'8px', padding:'6px 12px', flexShrink:0, textAlign:'right' }}>
            <div style={{ fontFamily:'DM Sans', fontSize:'9px', fontWeight:700, color:'#16a34a', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'2px' }}>
              Recommended
            </div>
            <div style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'12px', color:'#166534' }}>
              {recommendedUnit.unit_name}
            </div>
          </div>
        )}
      </div>

      {/* Preferences */}
      {prefs.length > 0 && (
        <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
          {prefs.map(pref => {
            const unit = getUnit(pref.unitName)
            if (!unit) return null
            const cfg  = CHOICE_CONFIG[pref.key]
            const open = unit.slots_remaining || 0
            return (
              <div key={pref.key} style={{ display:'flex', alignItems:'center', gap:'6px', background:'rgba(255,255,255,0.1)', borderRadius:'7px', padding:'5px 10px' }}>
                <span style={{ fontFamily:'DM Sans', fontWeight:700, fontSize:'9px', textTransform:'uppercase', letterSpacing:'0.05em', background:cfg.bg, color:cfg.color, padding:'1px 6px', borderRadius:'20px' }}>
                  {pref.key}
                </span>
                <span style={{ fontFamily:'DM Sans', fontWeight:600, fontSize:'11px', color:'#ffffff' }}>
                  {unit.unit_name}
                </span>
                <span style={{ fontFamily:'DM Sans', fontSize:'10px', color: open > 0 ? '#86efac' : '#fca5a5', fontWeight:600 }}>
                  {open > 0 ? `${open} open` : 'Full'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop:'10px', paddingTop:'8px', borderTop:'1px solid rgba(255,255,255,0.1)', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
        <span style={{ fontFamily:'DM Sans', fontSize:'10px', color:'rgba(255,255,255,0.45)', fontStyle:'italic' }}>
          Highlighted units reflect preferences:
        </span>
        {[{color:'#16a34a',label:'1st choice'},{color:'#d97706',label:'2nd choice'},{color:'#3b82f6',label:'3rd choice'}].map(item => (
          <div key={item.label} style={{ display:'flex', alignItems:'center', gap:'4px' }}>
            <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:item.color, flexShrink:0 }} />
            <span style={{ fontFamily:'DM Sans', fontSize:'10px', color:'rgba(255,255,255,0.55)' }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
