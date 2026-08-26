// Staff aggregate CSV export for Settings > Community Benefit.
// The export has the same aggregate-only privacy contract as the Nursing
// Education and Leadership portal export, but authorizes through staff
// community_benefit_view capability.

import { verifyPortalCaller, getServiceDb } from './lib/portalAuth.js'
import { can } from '../lib/server/access.js'
import { fetchCommunityBenefitInputs } from './lib/communityBenefitData.js'
import {
  buildCommunityBenefit,
  buildAggregateCsv,
  currentFiscalYear,
} from '../lib/server/communityBenefit/compute.js'

export function createCommunityBenefitExportHandler({
  verifyCaller = verifyPortalCaller,
  makeDb = getServiceDb,
  fetchInputs = fetchCommunityBenefitInputs,
  now = () => new Date(),
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'method_not_allowed' })
    }

    const caller = await verifyCaller(req)
    if (!caller.authenticated) {
      return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
    }
    if (!can(caller.profile, 'community_benefit_view')) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const raw = req.query?.fiscal_year
    const fy = raw == null || raw === '' ? currentFiscalYear(now()) : Number(raw)
    if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) {
      return res.status(400).json({ error: 'invalid_fiscal_year' })
    }

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }

    try {
      const inputs = await fetchInputs(db)
      const report = buildCommunityBenefit({ ...inputs, fiscalYear: fy })
      const csv = buildAggregateCsv(report)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="aspire-community-benefit-fy${fy}.csv"`)
      return res.status(200).send(csv)
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createCommunityBenefitExportHandler()
