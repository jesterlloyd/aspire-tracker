import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function usePreceptors() {
  return useQuery({
    queryKey: ['preceptors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('preceptors')
        .select(`
          *,
          preceptor_cohort_participation (
            id,
            cohort_id,
            status,
            started_at,
            ended_at,
            cohorts ( id, name )
          )
        `)
        .order('full_name', { ascending: true })
      if (error) throw error
      return data || []
    },
  })
}

export function usePreceptorById(id) {
  return useQuery({
    queryKey: ['preceptors', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('preceptors')
        .select(`
          *,
          preceptor_cohort_participation (
            id,
            cohort_id,
            status,
            started_at,
            ended_at,
            cohorts ( id, name )
          )
        `)
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

export function useStudentPreceptor(studentId, preceptorId) {
  return useQuery({
    queryKey: ['student-preceptor', studentId],
    queryFn: async () => {
      if (!preceptorId) return null
      const { data, error } = await supabase
        .from('preceptors')
        .select('*')
        .eq('id', preceptorId)
        .single()
      if (error) return null
      return data
    },
    enabled: !!studentId && !!preceptorId,
  })
}

export function findPreceptorByEmail(email, preceptors) {
  if (!email || !preceptors) return null
  const normalized = email.toLowerCase().trim()
  return preceptors.find(p => p.email?.toLowerCase().trim() === normalized) || null
}

export function preceptorDisplayName(preceptor) {
  return preceptor?.full_name || 'Unknown'
}

export function preceptorActiveCohort(preceptor) {
  if (!preceptor?.preceptor_cohort_participation) return null
  return preceptor.preceptor_cohort_participation.find(p => p.status === 'active') || null
}
