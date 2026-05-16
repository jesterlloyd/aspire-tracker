import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ClipboardList, Clock } from 'lucide-react'

const FLAG_STYLES = {
  no_show:          { bg: '#fef2f2', color: '#991b1b', label: 'No Show' },
  cancelled:        { bg: '#f3f4f6', color: '#6b7280', label: 'Cancelled' },
  rescheduled:      { bg: '#fffbeb', color: '#92400e', label: 'Rescheduled' },
  needs_reschedule: { bg: '#fff7ed', color: '#c2410c', label: 'Needs Reschedule' },
}

export default function TodaysInterviews({ cohortId, onStartRubric }) {
  const [collapsed, setCollapsed] = useState(false)

  const localDate = new Date().toLocaleDateString('en-CA')

  const { data: sessions = [], isLoading: loading, refetch: fetchToday } = useQuery({
    queryKey: ['todays_interviews', cohortId, localDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interview_slots')
        .select(`
          id, slot_date, slot_time, duration_minutes,
          interviewer_name, is_booked, booked_by_student_id,
          students!booked_by_student_id (
            id, first_name, last_name, school
          ),
          interview_sessions!slot_id (
            id, interview_flag
          )
        `)
        .eq('cohort_id', cohortId)
        .eq('slot_date', localDate)
        .eq('is_booked', true)
        .order('slot_time', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!cohortId,
  })

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
                const student = Array.isArray(s.students) ? s.students[0] : s.students
                const session = Array.isArray(s.interview_sessions) ? s.interview_sessions[0] : s.interview_sessions
                const name    = student ? `${student.first_name} ${student.last_name}` : '—'
                const flag    = FLAG_STYLES[session?.interview_flag]
                const time    = s.slot_time
                  ? new Date(`2000-01-01T${s.slot_time}`)
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
                      <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#6b7280' }}>{student?.school || '—'}</span>
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
                            background: '#eff6ff', color: '#1e40af',
                            fontFamily: 'DM Sans', fontWeight: 700,
                            fontSize: '10px', padding: '3px 8px', borderRadius: '20px',
                          }}>Booked</span>
                      }
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <button
                        onClick={() => onStartRubric?.({ slotId: s.id, sessionId: session?.id, student, slot: s })}
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
