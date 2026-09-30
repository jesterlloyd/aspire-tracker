// src/components/budget/budgetApi.js
//
// PROGRAM-BUDGET (A3, 2026-09-27): the Program Budget screens' calls. Settings reads and writes
// through /api/budget-staff; the Nursing Education & Leadership portal reads through
// /api/portal/academics-budget, which has no write path. Both send the session token.
import { supabase } from '../../lib/supabase'

async function token() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session expired. Please sign in again.')
  return session.access_token
}
async function read(res) {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) { const e = new Error(json.message || json.error || `Request failed (HTTP ${res.status}).`); e.code = json.error; e.status = res.status; e.details = json.details || null; throw e }
  return json
}

/** Settings: one POST per action (see api/budget-staff.js for the list). */
export async function budgetStaff(action, payload = {}) {
  const res = await fetch('/api/budget-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ action, ...payload }),
  })
  return read(res)
}

/** The portal: GET only. */
export async function budgetPortal(query = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()
  const res = await fetch(`/api/portal/academics-budget${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${await token()}` } })
  return read(res)
}

/** BUDGET-V2 Phase 3: Margo's decisions, from the portal (a grant with budget_access 'approve'). */
export async function budgetReview(action, payload = {}) {
  const res = await fetch('/api/portal/academics-budget-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ action, ...payload }),
  })
  return read(res)
}

/** The two sources the one view reads: the owner's (Settings) and the reader's (portal). */
export const STAFF_SOURCE = Object.freeze({
  load: (fy) => budgetStaff('load', { fiscal_year: fy }),
  exportXlsx: (fy) => budgetStaff('export', { fiscal_year: fy }),
  write: budgetStaff,
  pdf: (planId) => budgetStaff('plan_pdf', { id: planId }),
  review: null,
})
export const PORTAL_SOURCE = Object.freeze({
  load: (fy) => budgetPortal({ fiscal_year: fy }),
  exportXlsx: (fy) => budgetPortal({ fiscal_year: fy, export: '1' }),
  write: null,
  pdf: (planId) => budgetReview('plan_pdf', { plan_id: planId }),
  review: budgetReview,
})

/** Save a PDF the server built (the plan for Finance). */
export function savePdf({ fileName, pdf }) {
  const bytes = Uint8Array.from(atob(pdf), ch => ch.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/** Save the workbook the server built. */
export function saveXlsx({ fileName, xlsx }) {
  const bytes = Uint8Array.from(atob(xlsx), ch => ch.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

// ── Receipts (PROGRAM-BUDGET Phase B) ───────────────────────────────────────────

export const RECEIPT_BUCKET = 'record-documents'
const IMAGE_KEEP_BYTES = 4 * 1024 * 1024   // under the model's 5 MB image limit with room to spare
const IMAGE_MAX_SIDE = 2400

/**
 * A file as the receipt Keith will read. PDFs and saved emails go as they are; a photo too large
 * for Keith, or in a format it does not read (HEIC from an iPhone, when the browser can open it),
 * is redrawn here as a JPEG. No library: the browser's own decoder and a canvas.
 */
export async function prepareReceiptFile(file) {
  const name = file.name || 'receipt'
  if (/\.eml$/i.test(name) || file.type === 'message/rfc822') return new File([file], name, { type: 'message/rfc822' })
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) return new File([file], name, { type: 'application/pdf' })
  const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)
  if (ok && file.size <= IMAGE_KEEP_BYTES) return file
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(name)) throw new Error(`${name} is not a photo, a PDF or a saved order email.`)
  let bitmap
  try { bitmap = await createImageBitmap(file) } catch {
    throw new Error(`${name} could not be opened in this browser. Save it as a JPEG or PDF and add it again.`)
  }
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85))
  if (!blob) throw new Error(`${name} could not be prepared. Save it as a JPEG or PDF and add it again.`)
  return new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}

/** Upload the bytes to the signed URL the server issued for this receipt. */
export async function uploadReceiptFile(upload, file) {
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type })
  if (error) throw new Error('The receipt could not be uploaded. Try again.')
}
