// SHIFT-ACTIVITY-1 — Rotation > Activity host for the read-only Open Shift Review.
//
// This is mounting glue only: it provides the open-shift data to the EXISTING OpenShiftReview
// component (unchanged) in the Rotation context. The same component previously lived on
// Aggregate, where its data came from OverviewTab's campusLifecycleLogs query — that query is
// shared with On Campus Now and stays there, so Activity runs the SAME read-only SELECT here.
// Owner/Admin-only (canEdit), matching the Check-Ins subtab. No write/email/cron/RPC.
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import OpenShiftReview from './OpenShiftReview'

const F = 'DM Sans, sans-serif'

export default function RotationActivity({ students = [], cohortId }) {
  const { canEdit } = useAuth()

  // Full open-shift population (in_progress) for the cohort — identical, read-only SELECT to the
  // one feeding On Campus Now / the prior Aggregate review. Same fields OpenShiftReview expects.
  const { data: openLogs = [] } = useQuery({
    queryKey: ['rotation_open_shifts', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_shift_logs')
        .select('id, student_id, checked_in_at, lifecycle_state, planned_shift_type')
        .eq('cohort_id', cohortId)
        .eq('lifecycle_state', 'in_progress')
        .order('checked_in_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!cohortId && canEdit,
    refetchInterval: 60 * 1000,
  })

  if (!canEdit) return null // Owner/Admin-only, carried over from CLOCKOUT-DETECT-1.

  return (
    <div style={{ padding: '4px 20px 24px', fontFamily: F }}>
      {openLogs.length === 0 ? (
        <div style={{
          margin: '8px 0', padding: '28px 20px', textAlign: 'center',
          background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14,
          color: '#6b7280', fontSize: 13.5, fontFamily: F,
        }}>
          No open shifts right now.
        </div>
      ) : (
        // SHIFT-ACTIVITY-1b: Activity is the operational home — show the list expanded by default.
        <OpenShiftReview openLogs={openLogs} students={students} defaultOpen />
      )}
    </div>
  )
}
