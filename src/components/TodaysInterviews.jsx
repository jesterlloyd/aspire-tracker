import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ClipboardList, Clock } from 'lucide-react'

const FLAG_STYLES = {
  no_show:          { bg: '#fef2f2', color: '#991b1b', label: 'No Show' },
  cancelled:        { bg: '#f3f4f6', color: '#6b7280', label: 'Cancelled' },
  rescheduled:      { bg: '#fffbeb', color: '#92400e', label: 'Rescheduled' },
  needs_reschedule: { bg: '#fff7ed', color: '#c2410c', label: 'Needs Reschedule' },
}

export default function TodaysInterviews({ cohortId, onStartRubric }) {
  const [sessions, setSessions]   = useState([])
  const [collapsed, setCollapsed] = useState(false)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    if (!cohortId) return
    fetchToday()
  }, [cohortId])

  const fetchToday = async () => {
    setLoading(true)
    const today = new Date()
    const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
    try {
      const { data, error } = await supabase
        .from('interview_sessions')
        .select(`
          id, scheduled_date, scheduled_time,
          status, interview_flag, interviewer_name,
          students ( id, first_name, last_name, school )
        `)
        .eq('cohort_id', cohortId)
        .eq('scheduled_date', localDate)
        .order('scheduled_time', { ascending: true })
      if (!error && data) setSessions(data)
    } catch (err) {
      console.error('TodaysInterviews:', err.message)
    } finally {
      setLoading(false)
    }
  }

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  if (loading || sessions.length === 0) return null

  return (
    <div style={{
      background: '#fff', border: '1px solid #e0e7ff',
      borderRadius: '14px', marginBottom: '10px',
      overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(29,37,103,0.07)',
    }}>
      <div
        onClick={() => setCollapsed(p => !p)}
        style={{
          padding: '10px 16px',
          background: 'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Clock size={13} color="rgba(255,255,255,0.8)" />
          <span style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', color: '#fff' }}>
            Today's Interviews
          </span>
          <span style={{
            background: 'rgba(255,255,255,0.15)', color: '#fff',
            fontFamily: 'DM Sans', fontWeight: 700,
            fontSize: '11px', padding: '2px 8px', borderRadius: '20px',
          }}>
            {sessions.length}
          </span>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
            {todayLabel}
          </span>
        </div>
        <span style={{
          color: 'rgba(255,255,255,0.6)', fontSize: '11px',
          transform: collapsed ? 'rotate(180deg)' : 'rotate(0)',
          transition: 'transform 0.2s ease', display: 'inline-block',
        }}>▼</span>
      </div>

      {!collapsed && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8f9ff' }}>
                {['Time', 'Student', 'School', 'Interviewer', 'Status', ''].map(h => (
                  <th key={h} style={{
                    padding: '8px 14px', textAlign: 'left',
                    fontFamily: 'DM Sans', fontWeight: 600,
                    fontSize: '11px', color: '#6b7280',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    borderBottom: '1px solid #f3f4f6',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => {
                const st   = s.students
                const name = st ? `${st.first_name} ${st.last_name}` : '—'
                const flag = FLAG_STYLES[s.interview_flag]
                const time = s.scheduled_time
                  ? new Date(`2000-01-01T${s.scheduled_time}`)
                      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : '—'

                return (
                  <tr key={s.id} style={{
                    background: i % 2 === 0 ? '#fff' : '#fafbff',
                    borderBottom: '1px solid #f3f4f6',
                  }}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '13px', color: '#1D2567' }}>{time}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '13px', color: '#374151' }}>{name}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#6b7280' }}>{st?.school || '—'}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#374151' }}>{s.interviewer_name || 'ASPIRE Team'}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {flag
                        ? <span style={{
                            background: flag.bg, color: flag.color,
                            fontFamily: 'DM Sans', fontWeight: 700,
                            fontSize: '10px', padding: '3px 8px', borderRadius: '20px',
                          }}>{flag.label}</span>
                        : <span style={{
                            background: s.status === 'completed' ? '#f0fdf4' : '#eff6ff',
                            color: s.status === 'completed' ? '#166534' : '#1e40af',
                            fontFamily: 'DM Sans', fontWeight: 700,
                            fontSize: '10px', padding: '3px 8px', borderRadius: '20px',
                          }}>
                            {s.status === 'completed' ? 'Completed' : 'Scheduled'}
                          </span>
                      }
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <button
                        onClick={() => onStartRubric?.(s)}
                        style={{
                          padding: '5px 12px', background: '#1D2567',
                          border: 'none', borderRadius: '6px', cursor: 'pointer',
                          fontFamily: 'DM Sans', fontWeight: 600,
                          fontSize: '11px', color: '#fff',
                          display: 'flex', alignItems: 'center', gap: '4px',
                        }}
                      >
                        <ClipboardList size={11} /> Rubric
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
