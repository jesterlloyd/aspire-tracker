// api/my-interviewer-cohorts.js
//
// WAVE F-2 (interviewer file access): returns the set of cohort ids the CALLER is
// actively entitled to as an interviewer, so the staff UI can decide whether to
// show resume/photo controls. This is the caller's OWN entitlements only, resolved
// by identity from the verified JWT (user_profiles.id). It never exposes anyone
// else's entitlements and never accepts a browser-supplied identity.
//
// The file-access endpoint remains the authoritative gate; this read only drives
// which controls are shown. A non-interviewer or unentitled caller gets [].

import { getServiceDb, verifyPortalCaller } from './lib/portalAuth.js'
import { activeEntitledCohortIds } from '../lib/server/interviewerEntitlements.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) {
    return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
  }
  // Only an active interviewer can hold interviewer entitlements; everyone else
  // gets an empty set (owner/admin drive file controls from their own capabilities).
  if (String(caller.profile.role || '').toLowerCase() !== 'interviewer') {
    return res.status(200).json({ cohort_ids: [] })
  }
  try {
    const set = await activeEntitledCohortIds(getServiceDb(), caller.profile.id)
    return res.status(200).json({ cohort_ids: [...set] })
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }
}
