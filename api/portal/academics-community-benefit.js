// api/portal/academics-community-benefit.js
//
// NURSING-ACADEMICS-1: the Community Benefit report for the Nursing Academics
// portal. GET only. View-only by construction: this file exposes no write
// path and never will.
//
// AUTHORIZATION. verifyPortalNursingAcademicCaller confirms a verified JWT,
// an active user profile, and an ACTIVE nursing_academic role grant, re-read
// from user_role_grants on every request. The role is organization-wide by
// design (no school/unit/student scope rows), so there is no scope narrowing:
// the grant either authorizes the whole report or the caller gets 403.
//
// OUTPUT IS ALLOWLISTED. The payload is built exclusively by the pure compute
// module from allowlisted columns; it contains no emails, phones, shift
// narratives, evaluation content, or free-text notes. Student and preceptor
// NAMES appear only in the protected detail table, per the locked product
// requirements. This endpoint never reuses a broad staff endpoint.
//
// CACHING. no-store, private: role-scoped reporting data is never
// shared-cached.

import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'
import { fetchCommunityBenefitInputs } from '../lib/communityBenefitData.js'
import {
  buildCommunityBenefit,
  currentFiscalYear,
} from '../../lib/server/communityBenefit/compute.js'

function parseFiscalYear(raw, fallback) {
  if (raw == null || raw === '') return { ok: true, value: fallback }
  const fy = Number(raw)
  if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) {
    return { ok: false }
  }
  return { ok: true, value: fy }
}

export function createAcademicsCommunityBenefitHandler({
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

    const fy = parseFiscalYear(req.query?.fiscal_year, currentFiscalYear(now()))
    if (!fy.ok) return res.status(400).json({ error: 'invalid_fiscal_year' })

    let inputs
    try {
      inputs = await fetchInputs(auth.db)
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }

    let report
    try {
      report = buildCommunityBenefit({ ...inputs, fiscalYear: fy.value })
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }

    // This flag controls only whether the portal renders a shortcut to the
    // existing Owner-only settings surface. The settings endpoint remains the
    // write authorization boundary.
    report.can_manage_reporting_inputs = auth.profile?.is_owner === true

    // Always offer the current FY in the selector even before it has data.
    const current = currentFiscalYear(now())
    if (current != null && !report.available_fiscal_years.includes(current)) {
      report.available_fiscal_years = [current, ...report.available_fiscal_years]
        .sort((a, b) => b - a)
    }

    return res.status(200).json(report)
  }
}

export default createAcademicsCommunityBenefitHandler()
