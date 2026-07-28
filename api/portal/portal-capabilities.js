// api/portal/portal-capabilities.js
//
// One canonical, server-owned capability result for the portal client. The Messages tab and the
// lower-right launcher both consume this instead of any client constant or public env var, so the
// browser never decides feature enablement. Currently reports Academic Partner messaging capability
// (server env flag AP_MESSAGING_ENABLED AND the applied database migration); writes still
// re-authorize independently even when this reports enabled.
//
// Authorization: a verified portal JWT is required (no capability is disclosed to an unauthenticated
// caller). The result itself is not scope-sensitive (it is a platform feature flag), so it is not
// role-gated beyond requiring an authenticated portal user.

import { verifyPortalCaller, getServiceDb } from '../lib/portalAuth.js'
import { resolveApMessagingCapability } from '../lib/apMessagingCapability.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    return res.status(auth.status || 401).json({ error: auth.reason || 'unauthorized' })
  }

  // Fail closed: any resolver error (e.g. the DB probe throwing) yields a disabled capability rather
  // than a 500, so the client stays in its truthful prepared/disabled state.
  let apMessaging
  try {
    apMessaging = await resolveApMessagingCapability(getServiceDb())
  } catch {
    apMessaging = false
  }

  return res.status(200).json({ ap_messaging: apMessaging === true })
}
