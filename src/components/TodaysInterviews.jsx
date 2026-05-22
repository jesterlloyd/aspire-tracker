import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import StudentCard from './StudentCard'

export default function TodaysInterviews({ cohortId, onStartRubric }) {
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
            id, first_name, last_name, school, program_type, headshot_url
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

  // Interviewers catalog — one query per session, cached 5 min, provides strip tint colors
  const { data: interviewerCatalog = [] } = useQuery({
    queryKey: ['interviewers_catalog'],
    queryFn: async () => {
      const { data } = await supabase.from('interviewers').select('name, color').order('name')
      return data || []
    },
    staleTime: 5 * 60 * 1000,
  })
  const colorByName = Object.fromEntries(
    interviewerCatalog.map(i => [i.name, i.color]).filter(([n]) => !!n)
  )

  // Real-time: refresh when any slot in this cohort changes
  useEffect(() => {
    if (!cohortId) return
    const channel = supabase
      .channel(`todays_interviews_${cohortId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'interview_slots', filter: `cohort_id=eq.${cohortId}` },
        () => { fetchToday() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [cohortId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Full collapse — zero interviews today → nothing renders
  if (loading || sessions.length === 0) return null

  const todayShort = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div style={{ marginBottom: 16, fontFamily: 'DM Sans, sans-serif' }}>
      {/* Section eyebrow */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.12em', color: '#0E1428',
        }}>
          Interviews Today
        </span>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>
          {todayShort} · {sessions.length} scheduled
        </span>
      </div>

      {/* Card grid — single row for ≤ 6 interviews at typical content widths */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
        gap: 10,
      }}>
        {sessions.map(s => {
          const student = Array.isArray(s.students) ? s.students[0] : s.students
          const session = Array.isArray(s.interview_sessions) ? s.interview_sessions[0] : s.interview_sessions
          if (!student) return null
          const interviewTime = s.slot_time
            ? new Date(`2000-01-01T${s.slot_time}`)
                .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : '—'
          const interviewerName  = s.interviewer_name || ''
          const interviewerColor = colorByName[interviewerName] || '#1D2567'
          return (
            <StudentCard
              key={s.id}
              variant="interview"
              student={student}
              onClick={() => onStartRubric?.({ slotId: s.id, sessionId: session?.id, student, slot: s })}
              variantProps={{ interviewTime, interviewerName, interviewerColor }}
            />
          )
        })}
      </div>
    </div>
  )
}
