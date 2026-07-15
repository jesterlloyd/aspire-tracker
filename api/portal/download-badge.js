// api/portal/download-badge.js
//
// ASPIRE-STUDENT-HOME: authenticated, student-facing ID badge download endpoint
// for the Student Portal Documents card.
//
// BACKEND LIMITATION (intentional, documented): there is NO server-side badge
// artifact anywhere in the platform. The Cedars-Sinai ID badge is a physical
// credential issued off-platform, and the only digital rendering is a
// STAFF-ONLY, client-side canvas tool (src/lib/badgeGenerator.js) that draws
// print PNGs in the browser from public templates plus the student's headshot
// and rotation dates. Nothing is uploaded or stored; students.badge_created is
// a bookkeeping flag, not a file. So this endpoint can never serve a badge
// file today and always resolves to a sanitized "unavailable".
//
// It still enforces the full authorization boundary on purpose: it is the
// single, correctly-scoped home for a future downloadable badge, and having the
// gate in place now prevents a later, insecure wiring. If a downloadable badge
// artifact is added, resolve it from the LINKED student below (never from the
// client) and stream it or redirect to a short-lived signed URL. Do NOT modify
// Wave F-2 (the student-files privatization migration) as part of that work.
//
// Authorization (all required, all server-side): valid JWT, ACTIVE 'student'
// role grant, at least one ACTIVE user_student_links row. No student_id, path,
// or bucket is ever read from the client or returned to it.
//
// GET /api/portal/download-badge   (Authorization: Bearer <jwt>)

import process from 'node:process'
import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
      return res.status(500).json({ error: 'internal_error' })
    }

    const auth = await verifyPortalCaller(req)
    if (!auth.authenticated) {
      const status = auth.status === 403 ? 403 : 401
      return res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
    }

    const db = getServiceDb()

    const isStudent = await hasActiveRoleGrant(db, auth.profile.id, 'student')
    if (!isStudent) return res.status(403).json({ error: 'forbidden' })

    // Revoked/expired links resolve to [] here and are denied. The linked student
    // set is the only scope this caller could ever act on; the request never
    // supplies a student_id.
    const studentIds = await getActiveStudentLinks(db, auth.profile.id)
    if (studentIds.length === 0) return res.status(404).json({ error: 'badge_unavailable' })

    // No server-side badge artifact exists (see the header note). Return a
    // sanitized "unavailable" rather than fabricating a badge.
    return res.status(404).json({ error: 'badge_unavailable' })
  } catch {
    // Sanitized: never leak stack traces, provider errors, ids, or paths.
    return res.status(500).json({ error: 'internal_error' })
  }
}
