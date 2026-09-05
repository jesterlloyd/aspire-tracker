// api/portal/my-shift-lifecycle.js
//
// STUDENT-SHIFT-TAB-1: the signed-in student's Shift Log, inside the portal.
//
// POST { action: 'lookup' | 'check_in' | 'check_out' | 'past_shift', student_id?, ...intake }
//
// WHY THIS EXISTS. Until now the only way any student created a shift log was the
// public /shift-log page, which identifies a student by school email alone. A
// student who is already signed in to the portal had to leave it and type that
// email again. This endpoint gives the portal its own create path with the
// SESSION as identity, and it does so WITHOUT a second implementation of the
// shift-log rules.
//
// IDENTITY. The portal JWT is the only identity. verifyPortalCaller resolves it
// to a user_profiles row, an ACTIVE 'student' role grant is required, and the
// caller's COMPLETE set of active student links is the allowlist. The target
// student is a member of that allowlist: the one linked record when there is
// one, or the `student_id` the client names when the account holds several. A
// `student_id` outside the allowlist is answered exactly like one that does not
// exist (404 not_found), so ids cannot be probed. The client can NEVER supply
// `school_email`: it is read here, server-side, from the linked student row,
// and any value in the request body is discarded before anything reads it.
//
// ONE SET OF RULES. Every write is delegated, in-process, to the public handler
// for that step (api/shift-log/check-in.js, check-out.js, submit-past-shift.js)
// with a request whose body carries the server-resolved school_email and whose
// headers and socket are the caller's own (the S-11 throttle keys on them).
// Those handlers keep their validation, exception classification, atomic RPCs,
// Placed -> Active Rotation promotion, idempotency, and PII-free logging, so the
// portal path cannot produce a shift the public path could not. The public page
// stays for students without a portal account (S-09); nothing there changes.
//
// IDENTITY IS PINNED END TO END. The public rules identify a record by its
// school email, so this endpoint resolves that email through the same lookup
// FIRST and refuses (409 identity_mismatch) unless the record it lands on is
// the allowlisted one. The portal path is therefore strictly narrower than the
// public page, never wider. Known limit, inherited on purpose: an account whose
// several student records share one email is answered 'ambiguous_student_email'
// here exactly as on the public page.
//
// The lookup result returned to the portal omits school_email: the portal never
// needs it, because the server injects it on every write.
//
// Responses: the delegated handler's own (see each file), plus
//   200 { student_id, ...lookup }           action 'lookup'
//   400 invalid_request | student_required { students: [{ id, cohort_name }] }
//   401 unauthorized | 403 forbidden | 404 not_found | 405 method_not_allowed
//   409 no_school_email | identity_mismatch
//   500 internal_error
import process from 'node:process'
import {
  verifyPortalCaller,
  getServiceDb,
  hasActiveRoleGrant,
  getActiveStudentLinks,
} from '../lib/portalAuth.js'

const ACTIONS = ['lookup', 'check_in', 'check_out', 'past_shift']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The delegated public handlers import the S-11 throttle, which requires its
// pepper at import time. Loading them lazily keeps THIS module importable in
// tests and cold starts, and fails closed at the moment of use instead.
async function delegate(action) {
  if (action === 'check_in') return (await import('../shift-log/check-in.js')).default
  if (action === 'check_out') return (await import('../shift-log/check-out.js')).default
  if (action === 'past_shift') return (await import('../shift-log/submit-past-shift.js')).default
  return null
}

// The past-shift handler sets a wildcard CORS header for its public page. That
// header has no place on an authenticated response, so the delegated handler
// writes through a view of `res` that drops Access-Control-* and passes
// everything else to the real response untouched.
function withoutCors(res) {
  return new Proxy(res, {
    get(target, key) {
      if (key === 'setHeader') {
        return (name, value) => (/^access-control-/i.test(String(name)) ? target : target.setHeader(name, value))
      }
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  // ── 1. Identity: JWT -> profile -> active student grant -> linked students ──
  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) return res.status(auth.status).json({ error: auth.reason })
  const db = getServiceDb()
  const profileId = auth.profile.id
  if (!(await hasActiveRoleGrant(db, profileId, 'student'))) return res.status(403).json({ error: 'forbidden' })
  const allowlist = await getActiveStudentLinks(db, profileId)
  if (allowlist.length === 0) return res.status(403).json({ error: 'forbidden' })

  // ── 2. The request, with every identity field removed before anything reads it
  const raw = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const { action, student_id: requestedId, school_email: clientEmail, ...intake } = raw
  void clientEmail // discarded: the server resolves the email below, never the client
  if (!ACTIONS.includes(action)) return res.status(400).json({ error: 'invalid_request' })

  // ── 3. The target student, a member of the allowlist ────────────────────────
  let studentId
  if (requestedId !== undefined && requestedId !== null && requestedId !== '') {
    if (typeof requestedId !== 'string' || !UUID_RE.test(requestedId)) return res.status(400).json({ error: 'invalid_request' })
    if (!allowlist.includes(requestedId)) return res.status(404).json({ error: 'not_found' })
    studentId = requestedId
  } else if (allowlist.length === 1) {
    studentId = allowlist[0]
  } else {
    // Several linked records: the client must say which, and learns only enough
    // to ask (its own ids and their cohort names), never an email.
    const { data: rows, error: rErr } = await db
      .from('students')
      .select('id, cohorts:cohort_id ( name )')
      .in('id', allowlist)
    if (rErr) return res.status(500).json({ error: 'internal_error' })
    const students = (rows || []).map(r => ({ id: r.id, cohort_name: r.cohorts?.name || null }))
    return res.status(400).json({ error: 'student_required', students })
  }

  // ── 4. The identity the public rules run on: resolved here, never sent in ───
  const { data: student, error: sErr } = await db
    .from('students')
    .select('id, school_email')
    .eq('id', studentId)
    .maybeSingle()
  if (sErr) return res.status(500).json({ error: 'internal_error' })
  if (!student) return res.status(404).json({ error: 'not_found' })
  const schoolEmail = typeof student.school_email === 'string' ? student.school_email.trim() : ''
  if (!schoolEmail) return res.status(409).json({ error: 'no_school_email' })

  try {
    // ── 5. The same lookup the public rules run, pinned to the allowlisted id ─
    // A record the email resolves to that is NOT the allowlisted one is refused
    // before any read or write reaches it. Not-found, ineligible, and ambiguous
    // answers carry no record and pass through unchanged.
    const { lookupStudentByEmail } = await import('../lib/shiftLogLookup.js')
    const result = await lookupStudentByEmail(schoolEmail)
    if (result.student && result.student.id !== studentId) {
      return res.status(409).json({ error: 'identity_mismatch' })
    }
    if (action === 'lookup') {
      if (result.student) {
        const { school_email: dropped, ...safe } = result.student
        void dropped
        result.student = safe
      }
      return res.status(200).json({ student_id: studentId, ...result })
    }
    const run = await delegate(action)
    if (!run) return res.status(400).json({ error: 'invalid_request' })
    const delegated = {
      method: 'POST',
      headers: req.headers,
      socket: req.socket,
      body: { ...intake, school_email: schoolEmail },
    }
    return await run(delegated, withoutCors(res))
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }
}
