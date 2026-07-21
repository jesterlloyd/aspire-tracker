// api/portal/unit-messages-start.js
//
// UL-PORTAL: a Unit Leader starts a conversation. Two destinations, one endpoint:
//
//   destination: 'student'  a DIRECT thread with a student in an assigned unit
//   destination: 'aspire'   REPORT A CONCERN, a thread with the ASPIRE Team
//
// The concern shape carries the student as CONTEXT only and creates no student
// participant row, so the student has no read path to a report about themselves.
//
// NOTHING is trusted from the client except the destination, the student id, and
// the text. The unit is derived server side from the student's placement, the
// counterpart profile is resolved from the student's active portal link, and the
// RPC re-verifies the active unit_leader grant, the active unit scope, and that the
// student is really in that unit. A caller cannot pass an arbitrary unit or a
// student outside scope.
//
// BLOCKED UNTIL 20260720000002 IS APPLIED. The 'unit_leader_to_staff' actor kind
// this endpoint uses for the concern path does not exist before then; the RPC
// rejects it with MS400 and the endpoint reports a 400 rather than failing oddly.

import { Resend } from 'resend'
import { methodGuard, readJsonBody, mapRpcError, rateLimitResponse, logApiError } from '../lib/messagesApi.js'
import { validateBody, validateSubject, validateCategory, isUuid } from '../../lib/server/messages/validation.js'
import { consumeNewConversation, consumeMessage } from '../../lib/server/messages/rateLimitUtil.js'
import {
  startDirectThreadForUnitLeader,
  startConcernThreadForUnitLeader,
} from '../../lib/server/messages/conversationService.js'
import {
  verifyPortalUnitLeaderCaller,
  resolveUnitScopedStudents,
} from '../lib/unitLeaderScope.js'
import { emitUnitLeaderAlert } from '../../lib/server/notifications/unitLeaderAlerts.js'

const DESTINATIONS = new Set(['student', 'aspire'])

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!methodGuard(req, res, ['POST'])) return

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
  const { db, profile, scopes } = auth
  if (scopes.length === 0) return res.status(403).json({ error: 'no_active_unit_scope' })

  const parsed = readJsonBody(req)
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error })

  const allowed = new Set(['destination', 'student_id', 'subject', 'category', 'body'])
  for (const k of Object.keys(parsed.body || {})) {
    if (!allowed.has(k)) return res.status(400).json({ error: 'unexpected_field', field: k })
  }

  const destination = parsed.body.destination
  const studentId = parsed.body.student_id
  if (!DESTINATIONS.has(destination)) return res.status(422).json({ error: 'invalid_destination' })
  if (!isUuid(studentId)) return res.status(422).json({ error: 'invalid_student_id' })

  const subject = validateSubject(parsed.body.subject)
  if (!subject.ok) return res.status(422).json({ error: subject.error })
  const category = validateCategory(parsed.body.category)
  if (!category.ok) return res.status(422).json({ error: category.error })
  const body = validateBody(parsed.body.body)
  if (!body.ok) return res.status(422).json({ error: body.error })

  // THE authorization step. The student must be inside an active unit scope and
  // inside the visible lifecycle, including the 90-day completed rule. The unit
  // comes from this result, never from the request.
  let student
  try {
    const { students } = await resolveUnitScopedStudents(db, scopes)
    student = students.find(s => s.id === studentId)
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }
  // Out of scope and nonexistent are indistinguishable.
  if (!student) return res.status(404).json({ error: 'not_found' })

  const rateConv = await consumeNewConversation(db, profile.id)
  if (!rateConv.allowed) return rateLimitResponse(res, rateConv)
  const rateMsg = await consumeMessage(db, profile.id)
  if (!rateMsg.allowed) return rateLimitResponse(res, rateMsg)

  const deps = { db, resend: new Resend(process.env.RESEND_API_KEY) }

  try {
    let out
    if (destination === 'aspire') {
      // Report a Concern. No counterpart: this routes to the shared inbox.
      out = await startConcernThreadForUnitLeader(deps, {
        profile,
        studentId,
        unitKey: student.unit_key,
        subject: subject.value,
        category: category.value,
        body: body.value,
      })
    } else {
      // A direct thread needs the student's own portal account as counterpart.
      const counterpart = await resolveStudentPortalAccount(db, studentId)
      if (!counterpart) return res.status(409).json({ error: 'student_has_no_portal_account' })
      out = await startDirectThreadForUnitLeader(deps, {
        profile,
        studentId,
        unitKey: student.unit_key,
        counterpart,
        subject: subject.value,
        category: category.value,
        body: body.value,
      })
    }

    if (out.rpcError) {
      const mapped = mapRpcError(out.rpcError)
      logApiError('portal/unit-messages-start', mapped.error, out.rpcError)
      return res.status(mapped.status).json({ error: mapped.error })
    }
    if (!out.ok) return res.status(409).json({ error: 'conflict', reason: out.reason })

    // Best effort, and deliberately AFTER the authoritative write. A notification
    // failure can never undo the conversation that was already created.
    if (destination === 'aspire') {
      await emitUnitLeaderAlert(db, {
        alertType: 'concern_follow_up',
        unitKey: student.unit_key,
        cohortId: student.cohort_id,
        subjectId: out.result.conversation_id,
        subject: subject.value,
        summary: 'Your concern was received by the ASPIRE Team.',
        ctaPath: '/portal/messages',
      })
    }

    return res.status(201).json({
      conversation_id: out.result.conversation_id,
      message_id: out.result.message_id,
      created_at: out.result.created_at,
    })
  } catch (err) {
    logApiError('portal/unit-messages-start', 'threw', err)
    return res.status(500).json({ error: 'internal_error' })
  }
}

/**
 * The student's active portal account, resolved from their active student link.
 * Returns null when the student has no portal account, which is a legitimate
 * state: not every student is invited to the portal.
 */
async function resolveStudentPortalAccount(db, studentId) {
  const { data: links, error } = await db
    .from('user_student_links')
    .select('user_profile_id')
    .eq('student_id', studentId)
    .is('revoked_at', null)
    .limit(1)
  if (error || !links || links.length === 0) return null

  const { data: p } = await db
    .from('user_profiles')
    .select('id, email, full_name, is_active')
    .eq('id', links[0].user_profile_id)
    .maybeSingle()
  if (!p || p.is_active === false || !p.email) return null
  return { profileId: p.id, email: p.email, fullName: p.full_name }
}
