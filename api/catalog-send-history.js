import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyOwnerAdmin } from './lib/catalogAuth.js'
import { populationOf } from '../lib/server/demoScope.js'

const missingTable = (error) => error && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code)
const at = (row) => row.sent_at || row.created_at

function formHistory(rows) {
  const groups = new Map()
  for (const row of rows || []) {
    if (!row.catalog_resource_id || row.status === 'voided') continue
    const key = `${row.catalog_resource_id}:${row.batch_id}`
    const group = groups.get(key) || { rows: [], resource_id: row.catalog_resource_id, batch_id: row.batch_id, form_version: row.form_version }
    group.rows.push(row); groups.set(key, group)
  }
  return [...groups.values()].map(g => {
    const labels = [...new Set(g.rows.map(r => r.audience_label).filter(Boolean))]
    const names = [...new Set(g.rows.map(r => r.name || r.email).filter(Boolean))]
    const issuedTo = names.length > 3 ? [`${names.length} people`] : names
    return {
      id: `form:${g.batch_id}`,
      resource_id: g.resource_id,
      resource_version: g.form_version || 1,
      sent_at: g.rows.map(at).filter(Boolean).sort().at(-1),
      audience_labels: labels.length ? labels : issuedTo,
      sent_count: g.rows.filter(r => r.delivery_ok !== false).length,
      failed_count: g.rows.filter(r => r.delivery_ok === false).length,
      skipped_count: 0,
      channel: 'form_assignment',
    }
  })
}

function signatureHistory(requests, signers, templates, bulks) {
  const resourceByTemplate = new Map((templates || []).map(t => [t.id, t.catalog_resource_id]))
  const signersByRequest = new Map()
  for (const signer of signers || []) {
    const list = signersByRequest.get(signer.request_id) || []
    list.push(signer); signersByRequest.set(signer.request_id, list)
  }
  const bulkById = new Map((bulks || []).map(b => [b.id, b]))
  const groups = new Map()
  for (const request of requests || []) {
    if (!request.sent_at || ['draft', 'voided'].includes(request.status)) continue
    const resourceId = request.catalog_resource_id || resourceByTemplate.get(request.template_id)
    if (!resourceId) continue
    const key = `${resourceId}:${request.parent_bulk_id || request.id}`
    const group = groups.get(key) || { requests: [], resource_id: resourceId, key: request.parent_bulk_id || request.id }
    group.requests.push(request); groups.set(key, group)
  }
  return [...groups.values()].map(g => {
    const people = g.requests.flatMap(r => signersByRequest.get(r.id) || [])
    const bulk = bulkById.get(g.requests[0]?.parent_bulk_id)
    const names = [...new Set(people.map(p => p.name || p.email).filter(Boolean))]
    const labels = bulk?.audience_label ? [bulk.audience_label] : names.length > 3 ? [`${names.length} people`] : names
    return {
      id: `signature:${g.key}`,
      resource_id: g.resource_id,
      resource_version: Math.max(...g.requests.map(r => r.template_version || 1)),
      sent_at: g.requests.map(at).filter(Boolean).sort().at(-1),
      audience_labels: labels,
      sent_count: people.length || g.requests.length,
      failed_count: 0,
      skipped_count: 0,
      channel: 'signature_request',
    }
  })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await verifyOwnerAdmin(req, supabaseAdmin)
  if (!auth.ok) return res.status(auth.status).json(auth.body)
  const isDemo = populationOf(req)

  const sends = await supabaseAdmin.from('catalog_sends')
    .select('id, resource_id, resource_version, sent_at, audience_labels, sent_count, failed_count, skipped_count, channel')
    .eq('is_demo', isDemo).order('sent_at', { ascending: false }).limit(1000)
  if (missingTable(sends.error)) return res.status(200).json({ enabled: false, history: [] })
  if (sends.error) return res.status(500).json({ error: 'Could not load Catalog send history.' })

  const assignments = await supabaseAdmin.from('form_assignments')
    .select('id, catalog_resource_id, batch_id, form_version, audience_label, name, email, status, delivery_ok, sent_at, created_at')
    .eq('is_demo', isDemo).order('created_at', { ascending: false }).limit(1000)

  const requests = await supabaseAdmin.from('sig_requests')
    .select('id, catalog_resource_id, template_id, template_version, parent_bulk_id, status, sent_at, created_at')
    .eq('is_demo', isDemo).order('created_at', { ascending: false }).limit(1000)

  let sigRows = []
  if (!requests.error) {
    const requestIds = (requests.data || []).map(r => r.id)
    const templateIds = [...new Set((requests.data || []).map(r => r.template_id).filter(Boolean))]
    const bulkIds = [...new Set((requests.data || []).map(r => r.parent_bulk_id).filter(Boolean))]
    const signerResult = requestIds.length
      ? await supabaseAdmin.from('sig_request_signers').select('request_id, name, email').in('request_id', requestIds)
      : { data: [] }
    const templateResult = templateIds.length
      ? await supabaseAdmin.from('sig_templates').select('id, catalog_resource_id').in('id', templateIds)
      : { data: [] }
    const bulkResult = bulkIds.length
      ? await supabaseAdmin.from('sig_bulk_sends').select('id, audience_label').in('id', bulkIds)
      : { data: [] }
    sigRows = signatureHistory(requests.data, signerResult.data, templateResult.data, bulkResult.data)
  }

  const history = [
    ...(sends.data || []),
    ...(assignments.error ? [] : formHistory(assignments.data)),
    ...sigRows,
  ].sort((a, b) => new Date(b.sent_at || 0) - new Date(a.sent_at || 0))
  return res.status(200).json({ enabled: true, history })
}
