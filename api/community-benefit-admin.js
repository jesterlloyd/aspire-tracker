// api/community-benefit-admin.js
//
// NURSING-ACADEMICS-1: Owner-entered community-benefit inputs, in the house
// governance pattern (one POST, an { action, ...params } body, an action
// allow-list with exact key schemas).
//
// AUTHORIZATION. The caller is taken from the verified JWT, never the body.
//   - Every action requires an active staff profile (S-05 inherited through
//     verifyPortalCaller).
//   - `list` requires community_benefit_view (Owner or Admin) - read-only
//     visibility in Settings.
//   - `set_rate`, `add_capstone`, `void_capstone` require
//     community_benefit_admin, whose capability allowlist is EMPTY:
//     Owner-only by construction (the is_owner capability, never a role
//     string). Jester is the only person who can enter or change wage rates
//     and manual capstone hours, and this is enforced HERE, not in the UI.
//
// STORAGE IS APPEND-ONLY. A rate change supersedes the active row and
// inserts a new one in one database transaction; capstone corrections void
// a row. Nothing is deleted, so the entry history stays auditable.

import { verifyPortalCaller, getServiceDb } from './lib/portalAuth.js'
import { can } from '../lib/server/access.js'
import { LIMITS } from './lib/fieldLimits.js'
import { fetchAllRows } from './lib/fetchAllRows.js'
import { RATE_CATEGORIES } from '../lib/server/communityBenefit/compute.js'
import { resolveOperativeSchoolName } from '../src/lib/schoolIdentity.js'

const ACTION_SCHEMAS = Object.freeze({
  list: ['action'],
  set_rate: ['action', 'fiscal_year', 'category', 'hourly_rate', 'note'],
  add_capstone: ['action', 'fiscal_year', 'school_name', 'hours', 'cohort_id', 'note'],
  void_capstone: ['action', 'id'],
})

const findUnexpectedKeys = (body, allowed) =>
  Object.keys(body || {}).filter(k => !allowed.includes(k))

const invalid = (res, field, message) =>
  res.status(400).json({ error: 'invalid_request', field, message })

function parseFiscalYear(v) {
  const fy = Number(v)
  return Number.isInteger(fy) && fy >= 2020 && fy <= 2100 ? fy : null
}

function parseNonnegative(v, max) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null
}

export function createCommunityBenefitAdminHandler({
  verifyCaller = verifyPortalCaller,
  makeDb = getServiceDb,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'method_not_allowed' })
    }

    const caller = await verifyCaller(req)
    if (!caller.authenticated) {
      return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
    }

    const body = req.body || {}
    const action = body.action
    const allowedKeys = ACTION_SCHEMAS[action]
    if (!allowedKeys) return invalid(res, 'action', 'Unknown action.')
    const unexpected = findUnexpectedKeys(body, allowedKeys)
    if (unexpected.length) {
      return invalid(res, unexpected[0],
        'Unexpected field. The acting user is taken from your session, never from the request.')
    }

    const isWrite = action !== 'list'
    const capability = isWrite ? 'community_benefit_admin' : 'community_benefit_view'
    if (!can(caller.profile, capability)) {
      return res.status(403).json({
        error: 'forbidden',
        message: isWrite
          ? 'Only the Owner may enter or change community-benefit rates and capstone hours.'
          : 'You do not have permission to view community-benefit settings.',
      })
    }

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }

    try {
      if (action === 'list') {
        const [rates, capstoneHours] = await Promise.all([
          fetchAllRows(
            () => db.from('community_benefit_rates')
              .select('id, fiscal_year, category, hourly_rate, note, created_at, superseded_at')
              .order('fiscal_year', { ascending: false })
              .order('created_at', { ascending: false })
              .order('id', { ascending: true }),
            'rate_lookup_failed',
          ),
          fetchAllRows(
            () => db.from('community_benefit_capstone_hours')
              .select('id, fiscal_year, school_name, cohort_id, hours, note, created_at, voided_at')
              .order('fiscal_year', { ascending: false })
              .order('created_at', { ascending: false })
              .order('id', { ascending: true }),
            'capstone_lookup_failed',
          ),
        ])
        return res.status(200).json({
          rates,
          capstone_hours: capstoneHours,
          can_edit: can(caller.profile, 'community_benefit_admin'),
        })
      }

      if (action === 'set_rate') {
        const fy = parseFiscalYear(body.fiscal_year)
        if (fy == null) return invalid(res, 'fiscal_year', 'Fiscal year must be an integer between 2020 and 2100.')
        if (!RATE_CATEGORIES.includes(body.category)) {
          return invalid(res, 'category', 'Category must be rn_preceptor or management.')
        }
        const rate = parseNonnegative(body.hourly_rate, 10000)
        if (rate == null) return invalid(res, 'hourly_rate', 'Hourly rate must be a nonnegative number.')
        const note = body.note == null ? null : String(body.note).trim()
        if (note && note.length > LIMITS.SHORT) {
          return invalid(res, 'note', `Note must be ${LIMITS.SHORT} characters or fewer.`)
        }

        // One database transaction supersedes the prior row and inserts the
        // replacement. A failed insert therefore restores the prior rate.
        const { data: inserted, error: insertErr } = await db.rpc('set_community_benefit_rate', {
          p_fiscal_year: fy,
          p_category: body.category,
          p_hourly_rate: rate,
          p_note: note || null,
          p_entered_by: caller.profile.id,
        })
        if (insertErr || !inserted) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ rate: inserted })
      }

      if (action === 'add_capstone') {
        const fy = parseFiscalYear(body.fiscal_year)
        if (fy == null) return invalid(res, 'fiscal_year', 'Fiscal year must be an integer between 2020 and 2100.')
        const schoolInput = String(body.school_name || '').trim()
        const school = resolveOperativeSchoolName(schoolInput)?.displayName || null
        if (!school || school.length > LIMITS.IDENTITY) {
          return invalid(res, 'school_name', 'Select a recognized ASPIRE school.')
        }
        const hours = parseNonnegative(body.hours, 100000)
        if (hours == null) return invalid(res, 'hours', 'Hours must be a nonnegative number.')
        const cohortId = body.cohort_id == null || body.cohort_id === '' ? null : String(body.cohort_id)
        const note = body.note == null ? null : String(body.note).trim()
        if (note && note.length > LIMITS.SHORT) {
          return invalid(res, 'note', `Note must be ${LIMITS.SHORT} characters or fewer.`)
        }

        const { data: inserted, error: insertErr } = await db
          .from('community_benefit_capstone_hours')
          .insert({
            fiscal_year: fy,
            school_name: school,
            cohort_id: cohortId,
            hours,
            note: note || null,
            entered_by: caller.profile.id,
          })
          .select('id, fiscal_year, school_name, cohort_id, hours, note, created_at')
          .single()
        if (insertErr) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ capstone: inserted })
      }

      // void_capstone
      const id = String(body.id || '').trim()
      if (!id) return invalid(res, 'id', 'Entry id is required.')
      const { data: voided, error: voidErr } = await db
        .from('community_benefit_capstone_hours')
        .update({ voided_at: new Date().toISOString(), voided_by: caller.profile.id })
        .eq('id', id)
        .is('voided_at', null)
        .select('id, voided_at')
        .maybeSingle()
      if (voidErr) return res.status(500).json({ error: 'internal_error' })
      if (!voided) return res.status(404).json({ error: 'not_found' })
      return res.status(200).json({ capstone: voided })
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createCommunityBenefitAdminHandler()
