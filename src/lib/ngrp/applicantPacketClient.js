// src/lib/ngrp/applicantPacketClient.js
//
// APPLICANT-PACKET-1: the Download Packet button's work. Gathers what the binder already reads
// (the alumnus's details, documents, support and submitted form), fetches each document's
// current file through the same checked `open` action, builds the PDF in the browser and saves
// it. The PDF code (pdf-lib) loads only when someone presses the button. Never throws.
import { fetchApplicantProfile, postNgrpManage } from './useNgrpData'
import { loadStudentDocumentList, fetchStudentDocumentBytes } from '../documents/studentDocumentsClient'
import { packetDocuments, packetSummary, packetFileName } from './applicantPacketModel'

/**
 * @param row     the applicant row
 * @param cycle   the residency cohort
 * @param support this alumnus's support entries (the chart's Support query)
 * @param review  the chart's `actions.review`, or null where the submitted form is not offered
 * @returns { ok, fileName, skipped } or { ok: false, error }
 */
export async function downloadApplicantPacket({ row, cycle, support = [], review = null }) {
  const student = row?.student
  if (!student?.id || !cycle?.id) return { ok: false, error: 'invalid' }
  const [profile, list, rev] = await Promise.all([
    fetchApplicantProfile(cycle.id, student.id),
    loadStudentDocumentList(student.id),
    review && (row.form_revision_count || 0) > 0 ? review(row) : Promise.resolve(null),
  ])
  if (!list.ok) return { ok: false, error: 'documents_unavailable' }

  const documents = packetDocuments({ types: list.types, documents: list.documents })
  const files = new Map()
  let skipped = 0
  for (const d of documents) {
    if (d.status !== 'include') continue
    const got = await fetchStudentDocumentBytes(d.versionId)
    if (got.ok) files.set(d.versionId, got.bytes)
    else skipped++
  }
  const summary = packetSummary({
    row, cycle, profile: profile?.ok ? profile : null, support,
    revision: rev && rev.ok !== false ? rev.latestRevision || null : null, documents,
  })

  let bytes
  try {
    const { buildApplicantPacket } = await import('./applicantPacketPdf')
    bytes = await buildApplicantPacket({ summary, files })
  } catch {
    return { ok: false, error: 'build_failed' }
  }
  const fileName = packetFileName(student, cycle)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  // Settings > Residency Activity: who downloaded whose packet. Best effort; the file is saved.
  postNgrpManage('packet_downloaded', { cycle_id: cycle.id, student_id: student.id })
  return { ok: true, fileName, skipped }
}
