// INTERVIEWS-TODAY-COMPACT-1: the large StudentCard portraits are replaced by
// the SHARED OnCampusNow card system, so Interviews Today and On Campus Now use
// one compact visual language with no second card component and no duplicated
// CSS. Scoping, sorting and row mapping live in src/lib/interviewsToday.js and
// are shared with the At a Glance band.
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import OnCampusNow from './oncampus/OnCampusNow'
import StudentAvatar from './StudentAvatar'
import { scopeInterviewsForViewer, sortInterviews, buildInterviewRows } from '../lib/interviewsToday'

export default function TodaysInterviews({ cohortId, onStartRubric }) {
  const { userProfile, isAdmin } = useAuth()
  const localDate = new Date().toLocaleDateString('en-CA')

  const { data: sessions = [], isLoading: loading, refetch: fetchToday } = useQuery({
    queryKey: ['todays_interviews', cohortId, localDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interview_slots')
        .select(`
          id, slot_date, slot_time, duration_minutes, block_id,
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

  // Interviewers catalog - one query per session, cached 5 min, provides strip tint colors
  const { data: interviewerCatalog = [] } = useQuery({
    queryKey: ['interviewers_catalog'],
    queryFn: async () => {
      const { data } = await supabase.from('interviewers').select('name, color').order('name')
      return data || []
    },
    staleTime: 5 * 60 * 1000,
  })
  // ACCOUNTS-ACCESS-PEOPLE-MODEL-2A: account interviewer colors (user_profiles.interviewer_color -
  // the single source of truth), keyed by full name. New (non-protected) query key.
  const { data: activeInterviewerAccounts = [] } = useQuery({
    queryKey: ['active_interviewer_colors'],
    queryFn: async () => {
      const { data } = await supabase.rpc('get_active_interviewers')
      return data || []
    },
    staleTime: 5 * 60 * 1000,
  })
  // Prefer the account color; fall back to the legacy directory color for names without an account.
  const colorByName = {}
  for (const i of interviewerCatalog) { if (i.name) colorByName[i.name] = i.color }
  for (const p of activeInterviewerAccounts) { if (p.full_name) colorByName[p.full_name] = p.interviewer_color || '#1D2567' }

  // CANONICAL SCOPING: the interviewer identity lives on the parent availability
  // block (interviewer_profile_id), never on the slot, so the blocks for today's
  // cohort are resolved once and keyed by id. Display names are used only as
  // card text; they are never compared.
  const { data: blocks = [] } = useQuery({
    queryKey: ['todays_interview_blocks', cohortId, localDate],
    queryFn: async () => {
      const { data } = await supabase
        .from('interview_availability_blocks')
        .select('id, interviewer_profile_id, interviewer_name')
        .eq('cohort_id', cohortId)
        .eq('block_date', localDate)
      return data || []
    },
    enabled: !!cohortId,
    staleTime: 5 * 60 * 1000,
  })
  const blocksById = Object.fromEntries(blocks.map(b => [b.id, b]))

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

  // Scope by canonical profile id, sort by the shared rule, then map into the
  // existing OnCampusNow row contract.
  const scoped = scopeInterviewsForViewer(sessions, {
    blocksById, viewerProfileId: userProfile?.id, isAdmin,
  })
  const rows = buildInterviewRows(sortInterviews(scoped), {
    avatarFor: (student) => <StudentAvatar student={student} size={34} />,
    interviewerNameFor: (slot) => blocksById[slot.block_id]?.interviewer_name || slot.interviewer_name || '',
    onOpen: (slot) => {
      const student = Array.isArray(slot.students) ? slot.students[0] : slot.students
      const session = Array.isArray(slot.interview_sessions) ? slot.interview_sessions[0] : slot.interview_sessions
      onStartRubric?.({ slotId: slot.id, sessionId: session?.id, student, slot })
    },
  })

  // Full collapse - zero interviews today (or none of the viewer's) → nothing renders
  if (loading || rows.length === 0) return null

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
          {todayShort} · {rows.length} scheduled
        </span>
      </div>

      {/* Compact cards: the SHARED OnCampusNow renderer, so this workspace and
          the At a Glance band are visually identical by construction. */}
      <OnCampusNow title="Interviews Today" rows={rows} />
    </div>
  )
}
