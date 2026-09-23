// api/catalog-personal-files.js
//
// CATALOG-REVAMP-1 (Phase 1). The one-time review of personal files in the Catalog.
// The Catalog holds shared resources only; a file named for one student
// (Schedule_Witkin_Reena) belongs on that student's record. This endpoint FINDS such
// files and MOVES one only when a staff member confirms that exact file and student.
// Nothing moves on a match alone.
//
//   GET  /api/catalog-personal-files
//        -> { candidates: [{ resource, students: [...] }], moved: [...], enabled }
//   POST /api/catalog-personal-files  { resource_id, student_id, confirm: true }
//        -> { moved: { resource_id, record_document_id, title, student } }
//
// A move copies the bytes into the private 'record-documents' bucket, records a
// record_documents row, hides the Catalog row (is_active false, moved_to_record_document_id
// set), and only then deletes the Catalog copy, once the new object is confirmed present
// at the same size. Any failure before that point undoes what it wrote and leaves the
// Catalog exactly as it was.
//
// Owner/Admin only. Students are read from the caller's population (demo only on an
// explicit demo request, DEMO-DATA-2), so a demo session never files to a real student.

import { randomUUID } from 'node:crypto'
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyOwnerAdmin } from './lib/catalogAuth.js'
import { populationOf } from '../lib/server/demoScope.js'
import { personalFileMatches } from '../src/lib/catalog/catalogModel.js'
import { getStudentPreferredFullName } from '../src/lib/studentNameFormatters.js'

const CATALOG_BUCKET = 'aspire-catalog'
const RECORD_BUCKET = 'record-documents'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notEnabled = (e) => e && (e.code === '42P01' || e.code === '42703')

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
}
const extOf = (p) => (/\.([a-z0-9]+)$/i.exec(String(p || '')) || [])[1]?.toLowerCase() || ''

const studentView = (s) => ({ id: s.id, name: getStudentPreferredFullName(s), school: s.school || null, cohort_id: s.cohort_id || null })

async function loadStudents(req) {
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('id, first_name, preferred_first_name, last_name, school, cohort_id, is_demo')
    .eq('is_demo', populationOf(req))
  if (error) return { error }
  return { students: data || [] }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyOwnerAdmin(req, supabaseAdmin)
  if (!auth.ok) return res.status(auth.status).json(auth.body)

  try {
    return req.method === 'GET' ? await list(req, res) : await move(req, res, auth)
  } catch (err) {
    console.error('[catalog-personal-files] unhandled:', err?.message || err)
    return res.status(500).json({ error: 'Server error' })
  }
}

async function list(req, res) {
  const { data: rows, error } = await supabaseAdmin
    .from('catalog_resources')
    .select('id, slug, title, category, storage_path, resource_type, is_active')
    .eq('resource_type', 'internal_file')
    .eq('is_active', true)
    .not('storage_path', 'like', 'sig-template:%')   // SIGNATURES-PHASE2: templates are not files
  if (error) return res.status(500).json({ error: 'Lookup failed' })

  const st = await loadStudents(req)
  if (st.error) return res.status(500).json({ error: 'Lookup failed' })

  const candidates = []
  for (const r of rows || []) {
    const hits = personalFileMatches(r, st.students)
    if (hits.length) {
      candidates.push({
        resource: { id: r.id, slug: r.slug, title: r.title, category: r.category, file_name: r.storage_path.split('/').pop() },
        students: hits.map(studentView),
      })
    }
  }
  candidates.sort((a, b) => a.resource.title.localeCompare(b.resource.title))

  // What has already moved, for the one-time notice. Absent before the migration.
  let moved = []
  let enabled = true
  const { data: docs, error: dErr } = await supabaseAdmin
    .from('record_documents')
    .select('id, title, student_id, source_ref, created_at')
    .eq('source', 'catalog_move')
    .order('created_at', { ascending: false })
    .limit(20)
  if (notEnabled(dErr)) enabled = false
  else if (!dErr) {
    const byId = new Map(st.students.map(s => [s.id, s]))
    moved = (docs || []).filter(d => byId.has(d.student_id)).map(d => ({
      record_document_id: d.id, title: d.title, resource_id: d.source_ref, moved_at: d.created_at,
      student: studentView(byId.get(d.student_id)),
    }))
  }
  return res.status(200).json({ candidates, moved, enabled })
}

async function move(req, res, auth) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {}
  if (body.confirm !== true) return res.status(400).json({ error: 'A move needs confirm: true' })
  if (!UUID.test(body.resource_id || '') || !UUID.test(body.student_id || '')) {
    return res.status(400).json({ error: 'resource_id and student_id are required' })
  }

  const { data: r, error: rErr } = await supabaseAdmin
    .from('catalog_resources')
    .select('id, slug, title, storage_path, resource_type, is_active, moved_to_record_document_id')
    .eq('id', body.resource_id).maybeSingle()
  if (notEnabled(rErr)) return res.status(409).json({ error: 'not_enabled', message: 'Moving files to a record is available once the Catalog update is applied.' })
  if (rErr) return res.status(500).json({ error: 'Lookup failed' })
  if (!r) return res.status(404).json({ error: 'Resource not found' })
  if (r.moved_to_record_document_id) return res.status(409).json({ error: 'This file has already moved' })
  if (r.resource_type !== 'internal_file' || !r.storage_path || r.storage_path.startsWith('sig-template:') || r.is_active !== true) {
    return res.status(400).json({ error: 'Only an active uploaded file can move' })
  }

  // The student must be one the review offered for THIS file, in the caller's population.
  const st = await loadStudents(req)
  if (st.error) return res.status(500).json({ error: 'Lookup failed' })
  const student = personalFileMatches(r, st.students).find(s => s.id === body.student_id)
  if (!student) return res.status(400).json({ error: 'That student does not match this file' })

  // 1) Copy the bytes.
  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(CATALOG_BUCKET).download(r.storage_path)
  if (dlErr || !blob) return res.status(502).json({ error: 'Could not read the file' })
  const bytes = Buffer.from(await blob.arrayBuffer())
  const ext = extOf(r.storage_path)
  const fileName = r.storage_path.split('/').pop()
  const destKey = `student/${student.id}/${randomUUID()}${ext ? `.${ext}` : ''}`
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
  const { error: upErr } = await supabaseAdmin.storage.from(RECORD_BUCKET)
    .upload(destKey, bytes, { contentType, upsert: false })
  if (upErr) return res.status(502).json({ error: 'Could not write to the record' })

  const undoObject = () => supabaseAdmin.storage.from(RECORD_BUCKET).remove([destKey])

  // 2) The record row.
  const { data: doc, error: docErr } = await supabaseAdmin.from('record_documents').insert({
    subject_type: 'student',
    student_id: student.id,
    title: r.title,
    file_name: fileName,
    storage_path: destKey,
    content_type: contentType,
    size_bytes: bytes.length,
    source: 'catalog_move',
    source_ref: r.id,
    is_demo: student.is_demo === true,
    created_by: auth.profileId || null,
  }).select('id').single()
  if (docErr || !doc) {
    await undoObject()
    if (notEnabled(docErr)) return res.status(409).json({ error: 'not_enabled', message: 'Moving files to a record is available once the Catalog update is applied.' })
    return res.status(500).json({ error: 'Could not record the document' })
  }

  // 3) Hide the Catalog row, only if nobody changed it meanwhile.
  const { data: hidden, error: hideErr } = await supabaseAdmin.from('catalog_resources')
    .update({ is_active: false, moved_to_record_document_id: doc.id, updated_by: auth.profileId || null, updated_at: new Date().toISOString() })
    .eq('id', r.id).eq('is_active', true).is('moved_to_record_document_id', null)
    .select('id').maybeSingle()
  if (hideErr || !hidden) {
    await supabaseAdmin.from('record_documents').delete().eq('id', doc.id)
    await undoObject()
    return res.status(409).json({ error: 'The file changed while it was moving; nothing was moved' })
  }

  // 4) Delete the Catalog copy once the record's copy is confirmed at the same size.
  //    A failure here leaves a stray private object and says so; the move itself stands.
  let catalogCopy = 'kept'
  const folder = destKey.slice(0, destKey.lastIndexOf('/'))
  const { data: listed } = await supabaseAdmin.storage.from(RECORD_BUCKET).list(folder, { search: destKey.split('/').pop() })
  const landed = (listed || []).find(o => `${folder}/${o.name}` === destKey)
  if (landed && Number(landed.metadata?.size) === bytes.length) {
    const { error: rmErr } = await supabaseAdmin.storage.from(CATALOG_BUCKET).remove([r.storage_path])
    catalogCopy = rmErr ? 'kept' : 'deleted'
  }
  if (catalogCopy === 'kept') console.warn('[catalog-personal-files] catalog copy kept after move', { resource_id: r.id })

  return res.status(200).json({
    moved: {
      resource_id: r.id, record_document_id: doc.id, title: r.title, file_name: fileName,
      student: studentView(student), catalog_copy: catalogCopy,
    },
  })
}
