// PHASE 2C: the staff in-app reader for durable staff_notifications rows (Owner/Admin preceptor
// activity). Hoisted to App level so the combined bell badge updates whether or not the Action
// Center panel is open. Direct-Supabase + React Query, mirroring useUnreadStudents: RLS restricts
// SELECT to own-or-admin, and this filters to the current user's own fan-out rows. Read state is
// changed ONLY through the mark_staff_notifications_read RPC (granted to authenticated; it touches
// in_app_read_at on the caller's own rows and nothing else).

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const KEY = 'staff_notifications'
const POLL_MS = 60_000   // idle cadence, same order as the messages unread poll
const MAX_ROWS = 50

const SELECT_COLS =
  'id, correlation_id, event_type, actor_name, actor_role, student_id, preceptor_id, unit_key, ' +
  'assignment_role, old_value, new_value, reason, was_override, subject, dest_url, in_app_read_at, created_at'

export function useStaffNotifications({ enabled = true } = {}) {
  const { userProfile } = useAuth()
  const profileId = userProfile?.id
  const qc = useQueryClient()
  const queryKey = [KEY, profileId]

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!profileId) return { items: [], unreadCount: 0 }
      const { data, error } = await supabase
        .from('staff_notifications')
        .select(SELECT_COLS)
        .eq('recipient_profile_id', profileId)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS)
      if (error) throw error
      const items = data || []
      return { items, unreadCount: items.filter(i => !i.in_app_read_at).length }
    },
    enabled: enabled && !!profileId,
    staleTime: 15_000,
    refetchInterval: POLL_MS,
  })

  // Mark specific ids (or, when ids is null/omitted, every unread row) as read. Optimistic, with a
  // rollback-by-refetch on failure. The RPC re-scopes to the caller server-side, so passing ids the
  // caller does not own is a harmless no-op.
  const markRead = useCallback(async (ids) => {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : (ids ? [ids] : null)
    if (list && list.length === 0) return
    const nowIso = new Date().toISOString()
    qc.setQueryData(queryKey, (prev) => {
      if (!prev) return prev
      const items = prev.items.map(i =>
        (!list || list.includes(i.id)) && !i.in_app_read_at ? { ...i, in_app_read_at: nowIso } : i)
      return { items, unreadCount: items.filter(i => !i.in_app_read_at).length }
    })
    const { error } = await supabase.rpc('mark_staff_notifications_read', { p_ids: list })
    if (error) {
      qc.invalidateQueries({ queryKey })
      throw error
    }
  }, [qc, profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    items: query.data?.items || [],
    unreadCount: query.data?.unreadCount || 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    markRead,
  }
}
