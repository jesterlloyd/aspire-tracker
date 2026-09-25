// api/home-activity.js
//
// HOME-1 (2026-09-24): Recent activity for the At a Glance home page, "finished without
// you". Active staff only. Reads the last 24 hours of the things that complete on their
// own and hands back one normalized event list; src/lib/home/recentActivityModel.js
// decides what is shown and drops the viewer's own events.
//
// Sources, and the actor each one records:
//   signed      sig_requests.completed_at            (the request's signers; no profile id)
//   form        form_submissions.submitted_at         (the assignment's name; no profile id)
//   resolved    conversations.resolved_at            (conversation_events.actor_profile_id)
//   assessment  evaluation_assignments.completed_at  (respondent_name; a preceptor, never staff)
//   outreach    notification_log bulk_message_sent   (a staff send; the metadata's sender when it names one)
//
// DEMO-DATA-2: everything is read through populationDb on a client built for THIS request,
// so a demo session sees demo rows and every other request sees real rows. notification_log
// has no is_demo, so its rows are narrowed by narrowSendLog. Signatures, forms, messages and
// outreach are Owner/Admin modules, so those sources are read only for an Owner or Admin;
// every staff role sees assessments.

import { createClient } from '@supabase/supabase-js'
import process from 'node:process'
import { verifyStaffCaller } from './lib/messagesAuth.js'
import { populationDb, populationOf, narrowSendLog } from '../lib/server/demoScope.js'

const WINDOW_MS = 24 * 3600000
const LIMIT = 40
const ORG_ID = 'a5f1e000-0000-4000-8000-000000000001'

function serviceClient() {
  return createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
}

const iso = (ms) => new Date(ms).toISOString()

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const caller = await verifyStaffCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const profile = caller.profile
  const manages = ['owner', 'admin'].includes(String(profile.role || '').toLowerCase()) || profile.is_owner === true

  const db = populationDb(serviceClient(), req)
  // sig_requests and form_submissions carry is_demo but sit outside the boundary registry.
  const isDemo = populationOf(req)
  const since = iso(Date.now() - WINDOW_MS)
  const events = []
  const failed = []

  const tryRead = async (name, fn) => {
    try { await fn() } catch (err) { failed.push(name); console.warn('[home-activity]', name, err?.message || err) }
  }

  if (manages) {
    await tryRead('signed', async () => {
      const { data, error } = await db.from('sig_requests')
        .select('id, title, completed_at, catalog_resource_id, sender_id')
        .eq('org_id', ORG_ID).eq('is_demo', isDemo).eq('status', 'completed').gte('completed_at', since)
        .order('completed_at', { ascending: false }).limit(LIMIT)
      if (error) throw error
      const ids = (data || []).map(r => r.id)
      const { data: signers } = ids.length
        ? await db.from('sig_request_signers').select('request_id, name, recipient_type, signed_at').in('request_id', ids)
        : { data: [] }
      const lastSigner = new Map()
      for (const s of signers || []) {
        if (s.recipient_type !== 'signer' || !s.signed_at) continue
        const cur = lastSigner.get(s.request_id)
        if (!cur || new Date(s.signed_at) > new Date(cur.signed_at)) lastSigner.set(s.request_id, s)
      }
      for (const r of data || []) {
        const who = lastSigner.get(r.id)?.name || 'Every signer'
        events.push({
          id: `sig:${r.id}`, kind: 'signed', at: r.completed_at, actorName: who,
          sentence: { pre: '', actor: who, post: ` signed ${r.title}` },
          detail: 'Sealed copy filed to the record',
          to: `/catalog/signatures?tab=requests&request=${encodeURIComponent(r.id)}`,
        })
      }
    })

    await tryRead('form', async () => {
      const { data, error } = await db.from('form_submissions')
        .select('id, submitted_at, form_id, assignment_id, form_assignments!inner ( name, catalog_resource_id ), catalog_forms!inner ( title )')
        .eq('is_demo', isDemo).gte('submitted_at', since).order('submitted_at', { ascending: false }).limit(LIMIT)
      if (error) throw error
      for (const r of data || []) {
        const a = Array.isArray(r.form_assignments) ? r.form_assignments[0] : r.form_assignments
        const f = Array.isArray(r.catalog_forms) ? r.catalog_forms[0] : r.catalog_forms
        events.push({
          id: `form:${r.id}`, kind: 'form', at: r.submitted_at, actorName: a?.name || 'Someone',
          sentence: { pre: '', actor: a?.name || 'Someone', post: ` submitted the ${f?.title || 'form'}` },
          detail: 'Filed to the record as a PDF',
          to: `/catalog/forms/${encodeURIComponent(r.form_id)}/responses`,
        })
      }
    })

    await tryRead('resolved', async () => {
      const { data: raw, error } = await db.from('conversations')
        .select('id, subject, participant_name, resolved_at, student_id')
        .eq('status', 'resolved').gte('resolved_at', since).order('resolved_at', { ascending: false }).limit(LIMIT)
      if (error) throw error
      // conversations has no is_demo: a thread belongs to its student's population. The
      // students read goes through the scoped client, so an id it does not return is the
      // other population's. A thread naming no student is real.
      const sids = [...new Set((raw || []).map(r => r.student_id).filter(Boolean))]
      const { data: inPop } = sids.length ? await db.from('students').select('id').in('id', sids) : { data: [] }
      const pop = new Set((inPop || []).map(s => s.id))
      const data = (raw || []).filter(r => (r.student_id ? pop.has(r.student_id) : !isDemo))
      const ids = data.map(r => r.id)
      const { data: evs } = ids.length
        ? await db.from('conversation_events').select('conversation_id, actor_profile_id, created_at').in('conversation_id', ids).eq('event_type', 'resolved').order('created_at', { ascending: false })
        : { data: [] }
      const actorFor = new Map()
      for (const e of evs || []) if (!actorFor.has(e.conversation_id)) actorFor.set(e.conversation_id, e.actor_profile_id)
      const actorIds = [...new Set([...actorFor.values()].filter(Boolean))]
      const { data: profiles } = actorIds.length ? await db.from('user_profiles').select('id, full_name').in('id', actorIds) : { data: [] }
      const nameOf = new Map((profiles || []).map(p => [p.id, p.full_name]))
      for (const r of data) {
        const pid = actorFor.get(r.id) || null
        const who = nameOf.get(pid) || 'A teammate'
        events.push({
          id: `conv:${r.id}`, kind: 'resolved', at: r.resolved_at, actorProfileId: pid, actorName: who,
          sentence: { pre: '', actor: who, post: ` resolved ${r.participant_name ? `${r.participant_name}'s` : 'a'} support thread` },
          detail: r.subject || '',
          to: `/connect/messages?conversation=${encodeURIComponent(r.id)}`,
        })
      }
    })

    await tryRead('outreach', async () => {
      const { data, error } = await db.from('notification_log')
        .select('id, subject, recipient_email, recipient_name, student_id, sent_at, status, metadata')
        .eq('notification_type', 'bulk_message_sent').gte('sent_at', since).in('status', ['sent', 'delivered'])
        .order('sent_at', { ascending: false }).limit(400)
      if (error) throw error
      const rows = await narrowSendLog(db, data || [])
      // One event per subject, with the recipient count, rather than one row per person.
      const byBatch = new Map()
      for (const r of rows) {
        const key = `${r.subject || ''}|${String(r.sent_at || '').slice(0, 16)}`
        if (!byBatch.has(key)) byBatch.set(key, { subject: r.subject, at: r.sent_at, count: 0, id: r.id, sender: r.metadata?.sender_name || r.metadata?.sent_by_name || null, senderId: r.metadata?.sender_profile_id || r.metadata?.sent_by || null })
        byBatch.get(key).count += 1
      }
      for (const b of byBatch.values()) {
        events.push({
          id: `out:${b.id}`, kind: 'outreach', at: b.at, actorProfileId: b.senderId, actorName: b.sender,
          sentence: { pre: 'Outreach to ', actor: `${b.count} ${b.count === 1 ? 'person' : 'people'}`, post: ' delivered' },
          detail: b.subject || '',
          to: '/connect/outreach',
        })
      }
    })
  }

  await tryRead('assessment', async () => {
    const { data, error } = await db.from('evaluation_assignments')
      .select('id, completed_at, timepoint, respondent_type, respondent_name, student_id, evaluation_instruments!inner ( slug ), students!inner ( id, first_name, preferred_first_name, last_name, matched_unit_id, is_demo )')
      .gte('completed_at', since).not('completed_at', 'is', null)
      .order('completed_at', { ascending: false }).limit(LIMIT)
    if (error) throw error
    for (const r of data || []) {
      const inst = Array.isArray(r.evaluation_instruments) ? r.evaluation_instruments[0] : r.evaluation_instruments
      const s = Array.isArray(r.students) ? r.students[0] : r.students
      const studentName = s ? `${s.preferred_first_name || s.first_name || ''} ${s.last_name || ''}`.trim() : ''
      const what = inst?.slug === 'preceptor_progress'
        ? `a ${r.timepoint === 'midpoint' ? 'Midpoint' : r.timepoint === 'post_rotation' ? 'End of Rotation' : 'Progress'} assessment`
        : inst?.slug === 'casey_fink_readiness_2024' ? 'the Casey-Fink survey'
          : inst?.slug === 'student_preceptor_eval' ? 'feedback on the unit and preceptor'
            : inst?.slug === 'post_rotation_evaluation' ? 'feedback on ASPIRE' : 'a survey'
      const who = r.respondent_type === 'preceptor' ? (r.respondent_name || 'A preceptor') : (studentName || 'A student')
      events.push({
        id: `eval:${r.id}`, kind: 'assessment', at: r.completed_at, actorName: who,
        sentence: { pre: '', actor: who, post: ` submitted ${what}` },
        detail: r.respondent_type === 'preceptor' && studentName ? studentName : '',
        to: '/evaluation',
      })
    }
  })

  events.sort((a, b) => new Date(b.at) - new Date(a.at))
  return res.status(200).json({ events: events.slice(0, 60), failed, viewer: { id: profile.id, name: profile.full_name || null } })
}
