// HOME-1 (2026-09-24): what the home page reads, one loader per source.
//
// Each loader is its own React Query on the page, so the six Needs you sources load in
// parallel and one slow or failed source never blocks the others. Every loader goes
// through the module's OWN client or endpoint, with that module's permission check:
//
//   Messages        /api/messages-staff-list      active Owner/Admin (the endpoint's gate)
//   Signatures      /api/sig-staff list            Owner/Admin, and the catalog.signatures flag
//   Review & Release loadCohortEvidence + queue    Owner/Admin RLS on the survey tables, the
//                                                  Owner/Admin endpoint for the Unit Leader queue
//   Forms and docs  /api/form-staff tracker        Owner/Admin
//   Interviews      interview_slots + blocks       the cohort RLS; rows scoped to the viewer's
//                                                  own interviews unless Owner/Admin
//   Placement       props (students, units) +      the cohort RLS
//                   cohort_school_rotations
//   Activity        /api/home-activity             active staff; Owner/Admin sources gated there
//
// A caller who cannot use a source does not call it (`enabled: false`), so nothing here
// asks for what the viewer cannot complete.

import { supabase } from '../supabase'
import { listStaffConversations } from '../messages/messagesApiClient'
import { sigStaff } from '../../components/signatures/sigApi'
import { formStaff } from '../../components/forms/formsApi'
import { loadCohortEvidence, loadUnitLeaderQueue } from '../evaluation/reviewQueueLoaders'
import { buildQueues } from '../evaluation/reviewQueueBuild'

async function token() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

export async function loadMessagesNeedingYou() {
  const out = []
  let cursor = null
  for (let page = 0; page < 4; page += 1) {
    const res = await listStaffConversations({ view: 'active', attention: 'all', limit: 50, ...(cursor ? { cursor } : {}) })
    out.push(...(res?.conversations || []))
    cursor = res?.next_cursor || null
    if (!cursor) break
  }
  return out
}

export async function loadSignaturesList() {
  const res = await sigStaff('list')
  return { requests: res?.requests || [], signers: res?.signers || [], me: res?.me || null }
}

export async function loadReviewQueues(cohortId) {
  const [evidence, ul] = await Promise.all([
    loadCohortEvidence(cohortId),
    loadUnitLeaderQueue().catch(() => null),   // the Unit Leader queue is one workflow of six; its failure is not the page's
  ])
  return { queues: buildQueues(evidence, ul), evidence }
}

const CATALOG_COLS = 'id, slug, title, kind, is_active, storage_path'

export async function loadCatalogTracker() {
  const [tracker, items] = await Promise.all([
    formStaff('tracker'),
    supabase.from('catalog_resources').select(CATALOG_COLS).eq('is_active', true),
  ])
  if (items.error) throw items.error
  return { rows: tracker?.rows || [], items: items.data || [] }
}

export async function loadTodaysInterviews(cohortId, today) {
  const [slots, blocks] = await Promise.all([
    supabase.from('interview_slots')
      .select(`id, slot_date, slot_time, duration_minutes, block_id, interviewer_name, is_booked, booked_by_student_id,
               students!booked_by_student_id ( id, first_name, preferred_first_name, last_name, school, program_type, headshot_url ),
               interview_sessions!slot_id ( id, interview_flag )`)
      .eq('cohort_id', cohortId).eq('slot_date', today).eq('is_booked', true).order('slot_time', { ascending: true }),
    supabase.from('interview_availability_blocks').select('id, interviewer_profile_id, interviewer_name').eq('cohort_id', cohortId).eq('block_date', today),
  ])
  if (slots.error) throw slots.error
  if (blocks.error) throw blocks.error
  return { slots: slots.data || [], blocksById: Object.fromEntries((blocks.data || []).map(b => [b.id, b])) }
}

export async function loadRotationWindows(cohortId) {
  const { data, error } = await supabase.from('cohort_school_rotations')
    .select('id, school_name, rotation_start_date, rotation_end_date').eq('cohort_id', cohortId)
  if (error) throw error
  return data || []
}

export async function loadTodaysShifts(cohortId, today, yesterday) {
  const [plans, logs, preceptors] = await Promise.all([
    supabase.from('student_shift_plans').select('id, student_id, shift_date, preceptor_name, cancelled_at').eq('cohort_id', cohortId).eq('shift_date', today),
    supabase.from('student_shift_logs').select('id, student_id, shift_date, shift_type, planned_shift_type, unit_name, preceptor_name, status, lifecycle_state')
      .eq('cohort_id', cohortId).in('shift_date', [yesterday, today]),
    supabase.from('preceptors').select('id, full_name, unit_name').eq('is_active', true),
  ])
  if (logs.error) throw logs.error
  // student_shift_plans arrived in September 2026; a project without it reads as no plans.
  const planRows = plans.error ? [] : (plans.data || [])
  return { plans: planRows, logs: logs.data || [], preceptors: preceptors.error ? [] : (preceptors.data || []) }
}

export async function loadTodaysEvents(today) {
  const t = await token()
  const res = await fetch('/api/aspire-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify({ action: 'list', from: today, to: today }),
  })
  if (!res.ok) throw new Error(`events ${res.status}`)
  const json = await res.json().catch(() => ({}))
  return json.events || []
}

export async function loadRecentActivity() {
  const t = await token()
  const res = await fetch('/api/home-activity', { headers: t ? { Authorization: `Bearer ${t}` } : {} })
  if (!res.ok) throw new Error(`activity ${res.status}`)
  return res.json()
}

export async function loadLauncherContacts() {
  const { data, error } = await supabase.from('contacts')
    .select('id, full_name, category, unit_name, organization, school_name, email, is_active')
    .eq('is_active', true).limit(2000)
  if (error) throw error
  return data || []
}

export async function loadMatches(cohortId) {
  const { data, error } = await supabase.from('matches').select('id, student_id, unit_id, notification_sent').eq('cohort_id', cohortId)
  if (error) throw error
  return data || []
}
