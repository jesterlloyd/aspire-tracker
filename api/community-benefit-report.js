// Staff Community Benefit report for Settings > Community Benefit.
//
// This deliberately uses the staff capability boundary rather than the
// nursing_academic portal grant. Owner and Admin can view the report; only the
// Owner can change reporting inputs through community-benefit-admin.js.

import { verifyPortalCaller, getServiceDb } from './lib/portalAuth.js'
import { can } from '../lib/server/access.js'
import { fetchCommunityBenefitInputs } from './lib/communityBenefitData.js'
import { buildCommunityBenefit, currentFiscalYear } from '../lib/server/communityBenefit/compute.js'

function parseFiscalYear(raw, fallback) {
  if (raw == null || raw === '') return { ok: true, value: fallback }
  const fy = Number(raw)
  return Number.isInteger(fy) && fy >= 2020 && fy <= 2100
    ? { ok: true, value: fy }
    : { ok: false }
}

export function createCommunityBenefitReportHandler({
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

    const fy = parseFiscalYear(req.query?.fiscal_year, currentFiscalYear(now()))
    if (!fy.ok) return res.status(400).json({ error: 'invalid_fiscal_year' })

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }

    try {
      const inputs = await fetchInputs(db)
      const report = buildCommunityBenefit({ ...inputs, fiscalYear: fy.value })
      report.can_manage_reporting_inputs = can(caller.profile, 'community_benefit_admin')

      const current = currentFiscalYear(now())
      if (current != null && !report.available_fiscal_years.includes(current)) {
        report.available_fiscal_years = [current, ...report.available_fiscal_years]
          .sort((a, b) => b - a)
      }
      return res.status(200).json(report)
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createCommunityBenefitReportHandler()
