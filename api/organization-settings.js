import { getServiceDb, verifyPortalCaller } from './lib/portalAuth.js'
import { getOrganizationSettings, normalizeUploadedLogo, organizationAssetUrl, validateOrganizationInput } from '../lib/server/organizationSettings.js'

const textFields = ['display_name', 'header_short_name', 'legal_name', 'logo_alt_text', 'address_line_1', 'address_line_2', 'city', 'state_province', 'postal_code', 'country', 'main_phone', 'general_email', 'website']

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private')
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
  if (req.method === 'POST' && caller.profile?.is_owner !== true) return res.status(403).json({ error: 'forbidden', message: 'Only the Owner may manage organization settings.' })
  let db
  try { db = getServiceDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }
  try {
    const current = await getOrganizationSettings(db)
    if (req.method === 'GET') return res.status(200).json({ organization: { ...current, header_logo_url: organizationAssetUrl(db, current.header_logo_path), document_logo_url: organizationAssetUrl(db, current.document_logo_path), footer_logo_url: organizationAssetUrl(db, current.footer_logo_path) } })
    const body = req.body || {}
    const input = Object.fromEntries(textFields.map(field => [field, body[field] == null ? '' : String(body[field]).trim()]))
    for (const field of ['legal_name', 'logo_alt_text', 'address_line_2', 'website']) if (!input[field]) input[field] = null
    const checked = validateOrganizationInput(input)
    if (!checked.ok) return res.status(400).json({ error: 'validation_failed', fields: checked.errors })
    const uploads = {}
    for (const kind of ['header', 'document', 'footer']) {
      if (body[`${kind}_logo_remove`] === true) uploads[kind] = { remove: true }
      if (body[`${kind}_logo`]) {
        const parsed = normalizeUploadedLogo(body[`${kind}_logo`])
        if (!parsed.ok) return res.status(400).json({ error: 'validation_failed', field: `${kind}_logo`, message: parsed.error })
        uploads[kind] = parsed.value
      }
    }
    const uploaded = []
    for (const asset of Object.values(uploads)) {
      if (asset?.bytes) {
        const { error } = await db.storage.from('organization-branding').upload(asset.path, asset.bytes, { contentType: asset.type, upsert: false })
        if (error) throw error
        uploaded.push(asset.path)
      }
    }
    const patch = { ...checked.value, version: Number(current.version || 1) + 1, updated_at: new Date().toISOString() }
    if (uploads.header?.bytes) patch.header_logo_path = uploads.header.path
    if (uploads.document?.bytes) patch.document_logo_path = uploads.document.path
    if (uploads.footer?.bytes) patch.footer_logo_path = uploads.footer.path
    if (uploads.header?.remove) patch.header_logo_path = null
    if (uploads.document?.remove) patch.document_logo_path = null
    if (uploads.footer?.remove) patch.footer_logo_path = null
    const { data, error } = await db.from('organization_settings').update(patch).eq('id', current.id).eq('version', current.version).select().single()
    if (error || !data) {
      for (const path of uploaded) await db.storage.from('organization-branding').remove([path])
      return res.status(error ? 500 : 409).json({ error: error ? 'save_failed' : 'conflict' })
    }
    const oldPaths = []
    if (uploads.header?.bytes || uploads.header?.remove) if (current.header_logo_path) oldPaths.push(current.header_logo_path)
    if (uploads.document?.bytes || uploads.document?.remove) if (current.document_logo_path) oldPaths.push(current.document_logo_path)
    if (uploads.footer?.bytes || uploads.footer?.remove) if (current.footer_logo_path) oldPaths.push(current.footer_logo_path)
    if (oldPaths.length) await db.storage.from('organization-branding').remove(oldPaths)
    return res.status(200).json({ organization: { ...data, header_logo_url: organizationAssetUrl(db, data.header_logo_path), document_logo_url: organizationAssetUrl(db, data.document_logo_path), footer_logo_url: organizationAssetUrl(db, data.footer_logo_path) } })
  } catch (error) {
    console.error('[organization-settings]', error?.message || error)
    return res.status(500).json({ error: 'server_error' })
  }
}
