// api/portal/academics-benefit-export.js
//
// NURSING-ACADEMICS-1: the aggregate CSV export for fiscal reporting.
// GET only, text/csv.
//
// PRIVACY CONTRACT (locked). The CSV is AGGREGATE ONLY: one row per fiscal
// year + school + program + course type + benefit category, with the fixed
// column set in AGGREGATE_CSV_HEADERS. It contains no student names, no
// preceptor names, no emails, no phone numbers, no database identifiers, no
// shift-level records, and no narrative notes. The aggregation happens HERE,
// server-side, from the same compute module as the dashboard; identifiable
// rows are never sent to the browser to be "hidden" client-side.
//
// AUTHORIZATION. Identical to the report endpoint: active nursing_academic
// grant, verified on every request.

import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'
import { fetchCommunityBenefitInputs } from '../lib/communityBenefitData.js'
import {
  buildCommunityBenefit,
  buildAggregateCsv,
  currentFiscalYear,
} from '../../lib/server/communityBenefit/compute.js'

export function createAcademicsBenefitExportHandler({
  verifyCaller = verifyPortalNursingAcademicCaller,
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

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

    const raw = req.query?.fiscal_year
    let fy
    if (raw == null || raw === '') {
      fy = currentFiscalYear(now())
    } else {
      fy = Number(raw)
      if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) {
        return res.status(400).json({ error: 'invalid_fiscal_year' })
      }
    }

    let csv
    try {
      const inputs = await fetchInputs(auth.db)
      const report = buildCommunityBenefit({ ...inputs, fiscalYear: fy })
      csv = buildAggregateCsv(report)
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition',
      `attachment; filename="aspire-community-benefit-fy${fy}.csv"`)
    return res.status(200).send(csv)
  }
}

export default createAcademicsBenefitExportHandler()
