import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyOwnerAdmin } from './lib/catalogAuth.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const missingTable = (error) => error && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code)

async function count(db, table, column, id) {
  const out = await db.from(table).select('id', { count: 'exact', head: true }).eq(column, id)
  if (missingTable(out.error)) return 0
  if (out.error) throw out.error
  return out.count || 0
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyOwnerAdmin(req, supabaseAdmin)
  if (!auth.ok) return res.status(auth.status).json(auth.body)
  if (!auth.isOwner) return res.status(403).json({ error: 'Only the Owner can permanently delete Catalog items.' })

  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
  if (!UUID.test(id) || req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm the Catalog item to delete.' })

  const { data: row, error: rowErr } = await supabaseAdmin.from('catalog_resources')
    .select('id, title, resource_type, storage_path, moved_to_record_document_id').eq('id', id).maybeSingle()
  if (rowErr) return res.status(500).json({ error: 'Could not read the Catalog item.' })
  if (!row) return res.status(404).json({ error: 'Catalog item not found.' })

  try {
    const dependencies = [
      ['form definition', await count(supabaseAdmin, 'catalog_forms', 'catalog_resource_id', id)],
      ['form assignment', await count(supabaseAdmin, 'form_assignments', 'catalog_resource_id', id)],
      ['signature template', await count(supabaseAdmin, 'sig_templates', 'catalog_resource_id', id)],
      ['signature request', await count(supabaseAdmin, 'sig_requests', 'catalog_resource_id', id)],
    ].filter(([, n]) => n > 0)
    if (dependencies.length) {
      const names = dependencies.map(([name, n]) => `${n} ${name}${n === 1 ? '' : 's'}`).join(', ')
      return res.status(409).json({ error: `This item cannot be deleted because it is used by ${names}. Remove those dependencies first.` })
    }
  } catch {
    return res.status(500).json({ error: 'Could not check whether this item is still in use.' })
  }

  const { data: deleted, error: deleteErr } = await supabaseAdmin.from('catalog_resources')
    .delete().eq('id', id).select('id').maybeSingle()
  if (deleteErr) return res.status(500).json({ error: 'Could not delete the Catalog item.' })
  if (!deleted) return res.status(404).json({ error: 'Catalog item not found.' })

  let storageDeleted = false
  let cleanupWarning = null
  const isStoredCatalogFile = row.resource_type === 'internal_file'
    && row.storage_path
    && !/^(form|sig-template):/.test(row.storage_path)
    && !row.moved_to_record_document_id
  if (isStoredCatalogFile) {
    const { error: storageErr } = await supabaseAdmin.storage.from('aspire-catalog').remove([row.storage_path])
    if (storageErr) cleanupWarning = 'The Catalog record was deleted, but its stored file could not be removed. An Owner should remove that orphaned Storage object.'
    else storageDeleted = true
  }

  return res.status(200).json({ deleted: row.id, title: row.title, storage_deleted: storageDeleted, cleanup_warning: cleanupWarning })
}
