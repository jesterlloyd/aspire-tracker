import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export function useUnreadStudents(cohortId) {
  const { userProfile } = useAuth()
  const userId = userProfile?.id

  return useQuery({
    queryKey: ['unread_students', cohortId, userId],
    queryFn: async () => {
      if (!userId || !cohortId) return { unreadStudentIds: new Set(), count: 0 }

      // All form_received events for this cohort
      const { data: events, error: eventsError } = await supabase
        .from('program_events')
        .select('student_id, created_at')
        .eq('event_type', 'form_received')
        .eq('cohort_id', cohortId)

      if (eventsError) throw eventsError

      // This user's read timestamps
      const { data: reads, error: readsError } = await supabase
        .from('student_reads')
        .select('student_id, last_viewed_at')
        .eq('user_id', userId)

      if (readsError) throw readsError

      const readMap = {}
      ;(reads || []).forEach(r => { readMap[r.student_id] = new Date(r.last_viewed_at) })

      const unread = new Set()
      ;(events || []).forEach(e => {
        const eventTime  = new Date(e.created_at)
        const lastViewed = readMap[e.student_id]
        if (!lastViewed || eventTime > lastViewed) unread.add(e.student_id)
      })

      return { unreadStudentIds: unread, count: unread.size }
    },
    enabled: !!userId && !!cohortId,
    staleTime: 10_000,
  })
}
