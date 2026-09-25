import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useSignaturesFlag } from '../components/signatures/sigApi'
import { SURVEY_CATALOG } from '../lib/evaluation/surveyCatalog'
import { scopeInterviewsForViewer } from '../lib/interviewsToday'
import { schoolGroupKey } from '../lib/schoolIdentity'
import {
  loadMessagesNeedingYou, loadSignaturesList, loadReviewQueues, loadCatalogTracker,
  loadTodaysInterviews, loadRotationWindows,
} from '../lib/home/homeLoaders'
import {
  messagesGroup, signaturesGroup, reviewReleaseGroup, formsDocsGroup, interviewsGroup, placementGroup,
} from '../lib/home/needsYouModel'
import { supabase } from '../lib/supabase'
import {
  applySnoozes, firstNameFirst, normalizeHomeQueue, normalizeSupportQueue, sortQueue,
} from '../lib/actionCenter/queueModel'

const WORKFLOWS = SURVEY_CATALOG.map(s => ({ key: s.key, label: s.label }))
const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const queryState = (query, key, label) => ({
  key, label,
  status: query.isError ? 'error' : query.isSuccess ? 'ready' : 'loading',
  retry: query.refetch,
})

export function useActionCenterQueue({ enabled = true, includeOtherCohorts = false, cohortId, cohorts = [], students = [], units = [], communications = [] } = {}) {
  const { userProfile, isOwner, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const canManage = (isOwner || isAdmin || ['owner', 'admin'].includes(userProfile?.role)) && userProfile?.is_active !== false
  const sigFlag = useSignaturesFlag(enabled && canManage)
  const today = todayLocal()
  const [now] = useState(() => Date.now())

  const qMessages = useQuery({ queryKey: ['home_messages'], queryFn: loadMessagesNeedingYou, enabled: enabled && canManage, staleTime: 30000, refetchInterval: enabled ? 60000 : false })
  const qSig = useQuery({ queryKey: ['home_signatures'], queryFn: loadSignaturesList, enabled: enabled && canManage && sigFlag.allowed, staleTime: 30000 })
  const qRR = useQuery({ queryKey: ['home_review_queues', cohortId], queryFn: () => loadReviewQueues(cohortId), enabled: enabled && canManage && !!cohortId, staleTime: 60000 })
  const qCat = useQuery({ queryKey: ['home_catalog_tracker'], queryFn: loadCatalogTracker, enabled: enabled && canManage, staleTime: 30000 })
  const qIv = useQuery({ queryKey: ['home_interviews', cohortId, today], queryFn: () => loadTodaysInterviews(cohortId, today), enabled: enabled && !!cohortId, staleTime: 60000 })
  const qRot = useQuery({ queryKey: ['home_rotations', cohortId], queryFn: () => loadRotationWindows(cohortId), enabled: enabled && !!cohortId, staleTime: 300000 })
  const qSnooze = useQuery({
    queryKey: ['action_snoozes', userProfile?.id],
    queryFn: async () => {
      const cutoff = new Date().toISOString()
      const { error: cleanupError } = await supabase.from('action_snoozes')
        .delete().eq('user_id', userProfile.id).lte('snoozed_until', cutoff)
      if (cleanupError) throw cleanupError
      const { data, error } = await supabase.from('action_snoozes').select('item_key,snoozed_until').eq('user_id', userProfile.id)
      if (error) throw error
      return data || []
    },
    enabled: enabled && !!userProfile?.id,
    staleTime: 15000,
    retry: false,
  })
  const qSupport = useQuery({
    queryKey: ['action_support_checkins', cohortId],
    queryFn: async () => {
      const [logs, events] = await Promise.all([
        supabase.from('student_shift_logs').select('id,student_id,cohort_id,shift_date,unit_name,support_needed').eq('cohort_id', cohortId).neq('support_needed', ''),
        supabase.from('support_checkin_events').select('id,shift_log_id,classification,status,rule_key,created_at').eq('cohort_id', cohortId).order('created_at', { ascending: false }),
      ])
      if (logs.error) throw logs.error
      if (events.error) throw events.error
      return { logs: logs.data || [], events: events.data || [] }
    },
    enabled: enabled && canManage && !!cohortId,
    staleTime: 30000,
    retry: false,
  })
  const qOther = useQuery({
    queryKey: ['action_center_other_cohorts', cohorts.map(c => c.id).join(','), cohortId, today],
    queryFn: async () => Promise.all(cohorts.filter(c => c.id !== cohortId).map(async cohort => {
      const [studentRes, unitRes, communicationRes, rotationRes, interviewRes, reviewRes] = await Promise.all([
        supabase.from('students').select('*').eq('cohort_id', cohort.id),
        supabase.from('units').select('*').eq('cohort_id', cohort.id),
        supabase.from('communications').select('*').eq('cohort_id', cohort.id),
        loadRotationWindows(cohort.id).catch(() => []),
        loadTodaysInterviews(cohort.id, today).catch(() => null),
        canManage ? loadReviewQueues(cohort.id).catch(() => null) : Promise.resolve(null),
      ])
      return {
        cohort, students: studentRes.error ? [] : (studentRes.data || []),
        units: unitRes.error ? [] : (unitRes.data || []),
        communications: communicationRes.error ? [] : (communicationRes.data || []),
        rotations: rotationRes, interviews: interviewRes, review: reviewRes,
      }
    })),
    enabled: enabled && includeOtherCohorts && cohorts.some(c => c.id !== cohortId),
    staleTime: 60000,
  })

  const scopedSlots = useMemo(() => scopeInterviewsForViewer(qIv.data?.slots || [], {
    blocksById: qIv.data?.blocksById || {}, viewerProfileId: userProfile?.id, isAdmin: canManage,
  }), [qIv.data, userProfile?.id, canManage])
  const personalConversations = useMemo(() => (qMessages.data || []).filter(conversation => (
    !conversation.assigned_staff_profile_id || conversation.assigned_staff_profile_id === userProfile?.id
  )), [qMessages.data, userProfile?.id])
  const unitById = useMemo(() => new Map(units.map(u => [u.id, u.unit_name])), [units])

  const groups = useMemo(() => {
    const out = []
    if (qSig.data) out.push(signaturesGroup({ requests: qSig.data.requests, signers: qSig.data.signers, meId: qSig.data.me?.id || userProfile?.id, now }))
    if (qMessages.data) out.push(messagesGroup({ conversations: personalConversations, now }))
    if (qRR.data) out.push(reviewReleaseGroup({ queues: qRR.data.queues, workflows: WORKFLOWS, now }))
    if (qCat.data) out.push(formsDocsGroup({
      trackerRows: qCat.data.rows,
      items: qCat.data.items.filter(item => item.kind !== 'signature' || sigFlag.allowed),
      now,
    }))
    if (qIv.data) out.push(interviewsGroup({
      slots: scopedSlots, students, communications,
      interviewerNameFor: slot => qIv.data?.blocksById?.[slot.block_id]?.interviewer_name || slot.interviewer_name || '',
      displayName: firstNameFirst, now,
    }))
    if (qRot.data) out.push(placementGroup({
      students, units, rotations: qRot.data, schoolKey: schoolGroupKey,
      unitNameFor: id => unitById.get(id) || '', displayName: firstNameFirst, today, now,
    }))
    return out.filter(Boolean)
  }, [qSig.data, qMessages.data, qRR.data, qCat.data, qIv.data, qRot.data, scopedSlots, personalConversations, students, communications, units, unitById, userProfile?.id, sigFlag.allowed, today, now])

  const support = useMemo(() => normalizeSupportQueue({
    logs: qSupport.data?.logs || [], events: qSupport.data?.events || [], students, now,
  }), [qSupport.data, students, now])
  const allItems = useMemo(() => sortQueue([
    ...normalizeHomeQueue({ groups, conversations: personalConversations, students, cohortId, now }),
    ...support.open,
  ]), [groups, personalConversations, students, cohortId, now, support.open])
  const items = useMemo(() => applySnoozes(allItems, qSnooze.data || [], now), [allItems, qSnooze.data, now])
  const otherCohorts = useMemo(() => (qOther.data || []).map(other => {
    const otherUnits = new Map(other.units.map(u => [u.id, u.unit_name]))
    const otherGroups = []
    if (other.review) otherGroups.push(reviewReleaseGroup({ queues: other.review.queues, workflows: WORKFLOWS, now }))
    if (other.interviews) {
      const slots = scopeInterviewsForViewer(other.interviews.slots || [], {
        blocksById: other.interviews.blocksById || {}, viewerProfileId: userProfile?.id, isAdmin: canManage,
      })
      otherGroups.push(interviewsGroup({
        slots, students: other.students, communications: other.communications,
        interviewerNameFor: slot => other.interviews?.blocksById?.[slot.block_id]?.interviewer_name || slot.interviewer_name || '',
        displayName: firstNameFirst, now,
      }))
    }
    otherGroups.push(placementGroup({
      students: other.students, units: other.units, rotations: other.rotations,
      schoolKey: schoolGroupKey, unitNameFor: id => otherUnits.get(id) || '',
      displayName: firstNameFirst, today, now,
    }))
    return {
      id: other.cohort.id, name: other.cohort.name,
      items: applySnoozes(
        normalizeHomeQueue({ groups: otherGroups.filter(Boolean), conversations: [], students: other.students, cohortId: other.cohort.id, now }),
        qSnooze.data || [], now,
      ),
    }
  }).filter(entry => entry.items.length), [qOther.data, qSnooze.data, userProfile?.id, canManage, today, now])

  const sources = [
    ...(canManage && sigFlag.allowed ? [queryState(qSig, 'signatures', 'Signatures')] : []),
    ...(canManage ? [queryState(qMessages, 'messages', 'Messages')] : []),
    ...(canManage && cohortId ? [queryState(qRR, 'review-release', 'Review & Release'), queryState(qCat, 'forms', 'Forms and documents')] : []),
    ...(cohortId ? [queryState(qIv, 'interviews', 'Interviews'), queryState(qRot, 'placement', 'Placement and rotation')] : []),
    ...(canManage && cohortId ? [queryState(qSupport, 'support', 'Support check-ins')] : []),
  ]

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['home_messages'] })
    queryClient.invalidateQueries({ queryKey: ['home_signatures'] })
    queryClient.invalidateQueries({ queryKey: ['home_review_queues', cohortId] })
    queryClient.invalidateQueries({ queryKey: ['home_catalog_tracker'] })
    queryClient.invalidateQueries({ queryKey: ['home_interviews', cohortId, today] })
    queryClient.invalidateQueries({ queryKey: ['home_rotations', cohortId] })
    queryClient.invalidateQueries({ queryKey: ['action_support_checkins', cohortId] })
  }, [queryClient, cohortId, today])

  return {
    items, allItems, closedAutomatically: support.closed, otherCohorts,
    count: items.length,
    isLoading: sources.some(s => s.status === 'loading'),
    failures: sources.filter(s => s.status === 'error'),
    sources, invalidate,
    snoozesReady: qSnooze.isSuccess,
  }
}
