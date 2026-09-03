// CONNECT-SCHEDULING-LINK-1: the return half of the scheduling-link send-and-confirm loop.
//
// Mounted ONCE at the app shell so both launching workspaces (Interviews, Student Profiles) share one
// completion mechanism. It opens only when the Owner navigates back to the launching workspace with
// an active scheduling-link launch context, and only when ASPIRE Connect reported at least one of the
// launched students as successfully sent. Every decision clears the context, so a confirmation can
// never reopen after it has been answered; a refresh before deciding re-offers the same pending
// confirmation (writing a communication twice is harmless - resolution is by existence, not count).
//
// Nothing here changes a student's ASPIRE status. 'Form Received' -> 'Interview Scheduled' belongs to
// the student booking a slot; sending the link is a communication, and that is what gets recorded.

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { safeWrite } from '../../lib/safeWrite'
import { useAuth } from '../../contexts/AuthContext'
import { readLaunchContext, clearLaunchContext, LAUNCH_KINDS } from '../../lib/connect/launchContext'
import {
  SCHEDULING_LINK_COMM_TYPE,
  confirmedSchedulingLinkRecipients,
  buildSchedulingLinkConfirmPlan,
  resolveSchedulingLinkWrites,
  schedulingLinkEmail,
} from '../../lib/schedulingLinkFlow'

const displayName = (s) => `${s?.first_name || ''} ${s?.last_name || ''}`.trim() || s?.name || 'Student'

export default function SchedulingLinkReturnConfirm({
  students = [],
  cohortId,
  onLogCommunication,
  onRefreshCommunications,
  toast,
}) {
  const location = useLocation()
  const { userProfile } = useAuth()
  const queryClient = useQueryClient()
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)

  const notify = (msg) => {
    if (toast?.success) toast.success('Scheduling link', msg)
  }

  useEffect(() => {
    if (plan) return                       // a confirmation is already under review
    const ctx = readLaunchContext()
    if (!ctx || ctx.kind !== LAUNCH_KINDS.INTERVIEW_SCHEDULING_LINK) return
    // Cohort isolation: a context from another cohort never resolves against this cohort's students.
    if (!cohortId || ctx.cohortId !== cohortId) return
    // Only on the workspace the launch came from, so the confirmation appears where the work started.
    if (location.pathname !== ctx.returnPath) return
    // Wait for the cohort's students to be present rather than deciding against an empty list.
    if (students.length === 0) return

    /* eslint-disable react-hooks/set-state-in-effect -- intentional one-shot open on return
       navigation; mirrors the At a Glance capacity/form return confirmation precedent */
    const confirmed = confirmedSchedulingLinkRecipients(ctx, students)
    if (confirmed.length === 0) {
      clearLaunchContext()
      notify('ASPIRE Connect did not report a successful send, so nothing was recorded.')
      return
    }
    setPlan(buildSchedulingLinkConfirmPlan(confirmed))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [location.pathname, cohortId, students, plan]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = (msg) => {
    setPlan(null)
    clearLaunchContext()
    if (msg) notify(msg)
  }

  const handleConfirm = async () => {
    if (!plan) return
    setBusy(true)
    const results = []
    for (const s of plan.students) {
      const { data, error } = await safeWrite(
        () => supabase.from('communications').insert({
          student_id: s.id,
          cohort_id: cohortId,
          type: SCHEDULING_LINK_COMM_TYPE,
          sent_to_email: schedulingLinkEmail(s),
          sent_to_name: displayName(s),
          sent_by: userProfile?.full_name || 'ASPIRE Team',
        }).select().single(),
        { name: 'log scheduling link communication' },
      )
      if (data && onLogCommunication) onLogCommunication(data)
      // The Student Profiles side panel reads its own per-student communications query, so without
      // this its control would keep saying "Send" after a confirmed send instead of "Resend".
      if (!error) queryClient.invalidateQueries({ queryKey: ['student_communications', s.id] })
      results.push({ student: s, error })
    }
    const outcome = resolveSchedulingLinkWrites(plan, results)
    setBusy(false)
    onRefreshCommunications?.()
    if (outcome.status === 'done') {
      setPlan(null)
      clearLaunchContext()
      notify(outcome.succeeded.length === 1
        ? `Scheduling link recorded for ${displayName(outcome.succeeded[0])}.`
        : `Scheduling link recorded for ${outcome.succeeded.length} students.`)
    } else {
      // Partial failure: keep only the failed students pending so the write can be retried for
      // exactly those records. The context stays intact until a decision completes.
      setPlan(outcome.plan)
      notify(`${outcome.failed.length} entr${outcome.failed.length === 1 ? 'y' : 'ies'} could not be saved. You can retry.`)
    }
  }

  if (!plan) return null

  return (
    <div role="dialog" aria-modal="true" aria-label={plan.confirmTitle}
      style={{ position:'fixed', inset:0, zIndex:9997, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(15,23,42,0.28)' }}>
      <div style={{ background:'var(--chart-card,#fff)', borderRadius:14, border:'1px solid var(--chart-line)', boxShadow:'0 12px 40px rgba(15,23,42,0.22)', padding:'20px 22px', width:'min(460px, calc(100vw - 32px))', fontFamily:'Plus Jakarta Sans,sans-serif' }}>
        <div style={{ fontSize:15, fontWeight:700, color:'var(--chart-ink)', marginBottom:8 }}>{plan.confirmTitle}</div>
        <div style={{ fontSize:13, color:'var(--chart-ink-soft)', lineHeight:1.5, marginBottom:8 }}>{plan.confirmBody}</div>
        <div style={{ fontSize:12, color:'var(--chart-ink-soft)', marginBottom:14 }}>
          {plan.students.map(s => displayName(s)).join(' · ')}
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={() => close('No scheduling link was recorded.')} disabled={busy}
            style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--chart-line)', background:'transparent', color:'var(--chart-ink)', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            Not sent
          </button>
          <button onClick={handleConfirm} disabled={busy}
            style={{ padding:'7px 14px', borderRadius:8, border:'none', background:'var(--chart-navy)', color:'#fff', fontFamily:'Plus Jakarta Sans', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {busy ? 'Saving…' : 'Mark as sent'}
          </button>
        </div>
      </div>
    </div>
  )
}
