import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { CheckCircle, Circle, ChevronDown } from 'lucide-react'

export default function InterviewSetupChecklist({ cohortId, cohort }) {
  const [checks, setChecks]       = useState(null)
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => {
    if (!cohortId) return
    runChecks()
  }, [cohortId])

  const runChecks = async () => {
    try {
      const [
        { count: iCount },
        { count: bCount },
        { count: sCount },
        { count: eCount },
        { count: rCount },
      ] = await Promise.all([
        supabase.from('interviewers')
          .select('*', { count: 'exact', head: true }),
        supabase.from('interview_availability_blocks')
          .select('*', { count: 'exact', head: true })
          .eq('cohort_id', cohortId),
        supabase.from('interview_sessions')
          .select('*', { count: 'exact', head: true })
          .eq('cohort_id', cohortId),
        supabase.from('students')
          .select('*', { count: 'exact', head: true })
          .eq('cohort_id', cohortId)
          .eq('status', 'Form Received'),
        supabase.from('interview_rubrics')
          .select('*', { count: 'exact', head: true })
          .eq('cohort_id', cohortId),
      ])

      setChecks([
        {
          label: 'Interviewers added',
          done: (iCount || 0) > 0,
          detail: `${iCount || 0} interviewer${iCount !== 1 ? 's' : ''}`,
        },
        {
          label: 'Availability blocks created',
          done: (bCount || 0) > 0,
          detail: `${bCount || 0} block${bCount !== 1 ? 's' : ''}`,
        },
        {
          label: 'Student scheduling link active',
          done: !!cohort?.accepting_submissions,
          detail: cohort?.accepting_submissions ? 'Link is live' : 'Link inactive',
        },
        {
          label: 'Students awaiting interview',
          done: (eCount || 0) > 0,
          detail: `${eCount || 0} eligible`,
        },
        {
          label: 'Interviews scheduled',
          done: (sCount || 0) > 0,
          detail: `${sCount || 0} scheduled`,
        },
        {
          label: 'Rubrics submitted',
          done: (rCount || 0) > 0,
          detail: `${rCount || 0} submitted`,
        },
      ])
    } catch (err) {
      console.error('Checklist:', err.message)
    }
  }

  if (!checks) return null

  const doneCount = checks.filter(c => c.done).length
  const allDone   = doneCount === checks.length

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${allDone ? '#bbf7d0' : '#e0e7ff'}`,
      borderRadius: '14px', marginBottom: '10px', overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(29,37,103,0.06)',
    }}>
      <div
        onClick={() => setCollapsed(p => !p)}
        style={{
          padding: '10px 16px', cursor: 'pointer',
          background: allDone ? '#f0fdf4' : '#f8f9ff',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontFamily: 'DM Sans', fontWeight: 700, fontSize: '12px',
            color: allDone ? '#166534' : '#1D2567',
          }}>
            Interview Setup Checklist
          </span>
          <span style={{
            background: allDone ? '#dcfce7' : '#e0e7ff',
            color: allDone ? '#166534' : '#1D2567',
            fontFamily: 'DM Sans', fontWeight: 700,
            fontSize: '10px', padding: '2px 8px', borderRadius: '20px',
          }}>
            {doneCount} / {checks.length}
          </span>
        </div>
        <ChevronDown
          size={14}
          color={allDone ? '#166534' : '#1D2567'}
          style={{
            transform: collapsed ? 'rotate(0)' : 'rotate(180deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      </div>

      {!collapsed && (
        <div style={{
          padding: '12px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: '8px',
        }}>
          {checks.map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              padding: '8px 10px', borderRadius: '8px',
              background: c.done ? '#f0fdf4' : '#fafafa',
              border: `1px solid ${c.done ? '#bbf7d0' : '#f3f4f6'}`,
            }}>
              {c.done
                ? <CheckCircle size={14} color="#16a34a" style={{ flexShrink: 0, marginTop: '2px' }} />
                : <Circle     size={14} color="#d1d5db" style={{ flexShrink: 0, marginTop: '2px' }} />
              }
              <div>
                <div style={{
                  fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px',
                  color: c.done ? '#166534' : '#374151',
                }}>{c.label}</div>
                <div style={{
                  fontFamily: 'DM Sans', fontSize: '11px', marginTop: '1px',
                  color: c.done ? '#16a34a' : '#9ca3af',
                }}>{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
