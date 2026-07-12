// api/released-reports-admin.js
//
// PHASE5-GOVERNANCE: staff publishing endpoint for released_reports, the
// curated snapshot mechanism the unit and school portals read (Phases 3 and
// 4). Portals NEVER see live feedback tables; staff curate content here
// (aggregation and small-cohort minimum-n suppression happen BEFORE publish,
// by the human doing the publishing).
//
// Authorization mirrors the *-admin family: server-verified JWT, then the
// caller's user_profiles row; owner or admin only. Actions:
//   { action: 'list' }                          -> all reports (incl. revoked)
//   { action: 'publish', report: {...} }        -> insert a new snapshot
//   { action: 'revoke', report_id }             -> soft-revoke (portals stop
//                                                  seeing it immediately)

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const AUDIENCES = ['unit', 'school', 'public']

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { authenticated: false, status: 401 }

  const url     = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { authenticated: false, status: 401 }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner')
      .eq('auth_user_id', data.user.id)
      .maybeSingle()
    if (pErr || !profile) return { authenticated: false, status: pErr ? 401 : 403 }
    if (!(profile.is_owner === true || profile.role === 'admin')) {
      return { authenticated: false, status: 403 }
    }
    return { authenticated: true, profileId: profile.id, db: admin }
  } catch {
    return { authenticated: false, status: 401 }
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const requestId = `req_${randomUUID().slice(0, 8)}`
  const auth = await verifyCaller(req)
  if (!auth.authenticated) {
    return res.status(auth.status).json({ error: auth.status === 403 ? 'forbidden' : 'unauthorized' })
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = str(body.action)

  try {
    if (action === 'list') {
      const { data, error } = await auth.db
        .from('released_reports')
        .select('id, audience_type, scope_ref, cohort_id, title, published_at, revoked_at')
        .order('published_at', { ascending: false })
      if (error) return res.status(500).json({ error: 'internal_error' })
      return res.status(200).json({ reports: data || [] })
    }

    if (action === 'publish') {
      const report = (body.report && typeof body.report === 'object') ? body.report : {}
      const audienceType = str(report.audience_type)
      const scopeRef = str(report.scope_ref)
      const title = str(report.title)
      const bodyMd = str(report.body_md)
      if (!AUDIENCES.includes(audienceType)) {
        return res.status(400).json({ error: 'invalid_request', field: 'audience_type' })
      }
      if (!scopeRef || scopeRef.length > 200) {
        return res.status(400).json({ error: 'invalid_request', field: 'scope_ref' })
      }
      if (!title || title.length > 300) {
        return res.status(400).json({ error: 'invalid_request', field: 'title' })
      }
      if (!bodyMd && !report.payload) {
        return res.status(400).json({ error: 'invalid_request', field: 'body_md', message: 'A report needs body_md or payload.' })
      }
      const insert = {
        audience_type: audienceType,
        scope_ref: scopeRef,
        cohort_id: str(report.cohort_id) || null,
        title,
        body_md: bodyMd || null,
        payload: (report.payload && typeof report.payload === 'object') ? report.payload : null,
        published_by: auth.profileId,
      }
      const { data, error } = await auth.db
        .from('released_reports').insert(insert).select('id').single()
      if (error) {
        console.log('[released-reports-admin] publish failed', { errorCode: error.code, request_id: requestId })
        return res.status(500).json({ error: 'internal_error' })
      }
      console.log('[released-reports-admin] published', { reportId: data.id, audienceType, request_id: requestId })
      return res.status(200).json({ success: true, report_id: data.id })
    }

    if (action === 'revoke') {
      const reportId = str(body.report_id)
      if (!reportId) return res.status(400).json({ error: 'invalid_request', field: 'report_id' })
      const { error } = await auth.db
        .from('released_reports')
        .update({ revoked_at: new Date().toISOString(), revoked_by: auth.profileId })
        .eq('id', reportId)
        .is('revoked_at', null)
      if (error) {
        console.log('[released-reports-admin] revoke failed', { errorCode: error.code, request_id: requestId })
        return res.status(500).json({ error: 'internal_error' })
      }
      console.log('[released-reports-admin] revoked', { reportId, request_id: requestId })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'invalid_request', field: 'action' })
  } catch (err) {
    console.log('[released-reports-admin] unexpected error', { errorCode: err?.code, request_id: requestId })
    return res.status(500).json({ error: 'internal_error' })
  }
}
