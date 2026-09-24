/* global Buffer */
import { randomUUID } from 'node:crypto'

export const ORGANIZATION_FIELDS = [
  'id', 'display_name', 'header_short_name', 'legal_name', 'logo_alt_text',
  'header_logo_path', 'document_logo_path', 'address_line_1', 'address_line_2',
  'city', 'state_province', 'postal_code', 'country', 'main_phone',
  'general_email', 'website', 'version', 'created_at', 'updated_at',
]

export const DEFAULT_ORGANIZATION = Object.freeze({
  display_name: 'Cedars-Sinai', header_short_name: 'ASPIRE Intelligence',
  legal_name: 'Cedars-Sinai Medical Center', logo_alt_text: 'Cedars-Sinai logo',
  address_line_1: '8700 Beverly Blvd', address_line_2: '', city: 'Los Angeles',
  state_province: 'CA', postal_code: '90048', country: 'United States',
  main_phone: '310-423-3277', general_email: 'aspire@cshs.org',
  website: 'https://www.cedars-sinai.org', header_logo_path: null, document_logo_path: null,
})

const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const urlRe = /^https?:\/\/[^\s]+$/i

export function validateOrganizationInput(input = {}) {
  const fields = { ...DEFAULT_ORGANIZATION, ...input }
  const errors = {}
  for (const field of ['display_name', 'header_short_name', 'address_line_1', 'city', 'state_province', 'postal_code', 'country', 'main_phone', 'general_email']) {
    if (!String(fields[field] ?? '').trim()) errors[field] = 'This field is required.'
  }
  if (fields.general_email && !emailRe.test(String(fields.general_email).trim())) errors.general_email = 'Enter a valid email address.'
  if (fields.website && !urlRe.test(String(fields.website).trim())) errors.website = 'Enter a full URL beginning with https:// or http://.'
  for (const field of ['display_name', 'header_short_name', 'legal_name', 'logo_alt_text', 'address_line_1', 'address_line_2', 'city', 'state_province', 'postal_code', 'country', 'main_phone', 'general_email', 'website']) {
    if (String(fields[field] ?? '').length > 300) errors[field] = 'This value is too long.'
  }
  return { ok: Object.keys(errors).length === 0, errors, value: fields }
}

export async function getOrganizationSettings(db) {
  const { data, error } = await db.from('organization_settings').select(ORGANIZATION_FIELDS.join(',')).order('created_at').limit(1).maybeSingle()
  if (error) throw error
  return data || DEFAULT_ORGANIZATION
}

export function organizationAssetUrl(db, path) {
  if (!path) return null
  return db.storage.from('organization-branding').getPublicUrl(path).data.publicUrl
}

export function normalizeUploadedLogo(file) {
  if (!file) return { ok: true, value: null }
  const bytes = Buffer.from(String(file.data_base64 || ''), 'base64')
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) return { ok: false, error: 'Logo must be smaller than 2 MB.' }
  const type = String(file.type || '').toLowerCase()
  const signatures = type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || type === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))
    || type === 'image/svg+xml' && /<svg(?:\s|>)/i.test(bytes.toString('utf8', 0, 4096)) && !/<script|on[a-z]+\s*=|javascript:/i.test(bytes.toString('utf8'))
  if (!signatures) return { ok: false, error: 'Logo must be a valid PNG, JPEG, or safe SVG file.' }
  const ext = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'svg'
  return { ok: true, value: { bytes, type, path: `organization/${randomUUID()}.${ext}` } }
}
