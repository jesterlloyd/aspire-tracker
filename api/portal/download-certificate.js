// api/portal/download-certificate.js
//
// ASPIRE-STUDENT-HOME: authenticated, student-facing download of the ASPIRE
// Certificate of Participation for the LINKED student, from the Student Portal
// Documents card.
//
// Authorization (all required, all server-side):
//   - a valid Supabase JWT (verifyPortalCaller)
//   - an ACTIVE 'student' role grant
//   - at least one ACTIVE user_student_links row (revoked/expired links resolve
//     to an empty set and are denied)
// The linked student is resolved ENTIRELY from those authoritative rows. The
// request body and query string contribute NOTHING to authorization: no
// student_id, certificate_id, or path is ever read from the client. The
// certificate must already exist and be unlocked (certificate_unlocked_at);
// this endpoint never creates a certificate, assigns a number, or touches
// certificate_sequences. The PDF is generated on demand from the certificates
// row plus a static template and streamed - nothing is stored, so no storage
// path, bucket, or signed URL is ever involved or returned.
//
// GET /api/portal/download-certificate   (Authorization: Bearer <jwt>)

import process from 'node:process'
import { Buffer } from 'node:buffer'
import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveStudentLinks } from '../lib/portalAuth.js'
import { generateParticipationCertificate } from '../../lib/server/certificates/generateParticipationCertificate.js'
import { emailBaseUrl } from '../../lib/server/appUrl.js'
import { getStudentPreferredFullName } from '../../src/lib/studentNameFormatters.js'

const TEMPLATE_PATH = '/certificates/templates/aspire-certificate-of-participation.pdf'

// Restrict a filename to a safe, predictable set of characters.
function safeFilePart(v) {
  return String(v || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || '-'
}

async function loadTemplateBytes(req) {
  const res = await fetch(`${emailBaseUrl(req)}${TEMPLATE_PATH}`)
  if (!res.ok) return null
  return new Uint8Array(await res.arrayBuffer())
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
      return res.status(500).json({ error: 'internal_error' })
    }

    const auth = await verifyPortalCaller(req)
    if (!auth.authenticated) {
      const status = auth.status === 403 ? 403 : 401
      return res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
    }

    const db = getServiceDb()

    const isStudent = await hasActiveRoleGrant(db, auth.profile.id, 'student')
    if (!isStudent) return res.status(403).json({ error: 'forbidden' })

    // The ONLY student ids this caller may act on. Revoked links are excluded by
    // getActiveStudentLinks, so a revoked user resolves to [] and is denied.
    const studentIds = await getActiveStudentLinks(db, auth.profile.id)
    if (studentIds.length === 0) return res.status(404).json({ error: 'certificate_unavailable' })

    // Resolve the unlocked certificate for a LINKED student only. student_id is
    // never taken from the request; the scope is the authoritative link set.
    const { data: certs, error: certErr } = await db
      .from('certificates')
      .select('certificate_number, certificate_year, certificate_unlocked_at, student_id')
      .in('student_id', studentIds)
    if (certErr) return res.status(500).json({ error: 'internal_error' })

    const cert = (certs || []).find(c => c && c.certificate_unlocked_at && c.certificate_number) || null
    if (!cert) return res.status(404).json({ error: 'certificate_unavailable' })

    const { data: student, error: studentErr } = await db
      .from('students')
      .select('first_name, last_name, preferred_first_name')
      .eq('id', cert.student_id)
      .single()
    if (studentErr || !student) return res.status(404).json({ error: 'certificate_unavailable' })

    const templateBytes = await loadTemplateBytes(req)
    if (!templateBytes) return res.status(500).json({ error: 'internal_error' })

    const studentName = getStudentPreferredFullName(student)
    const pdfBytes = await generateParticipationCertificate({
      templateBytes,
      studentName,
      certificateNumber: cert.certificate_number,
    })

    const filename = `ASPIRE-Certificate-of-Participation-${safeFilePart(student.last_name)}-${safeFilePart(cert.certificate_number)}.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(Buffer.from(pdfBytes))
  } catch {
    // Sanitized: never leak stack traces, provider errors, ids, or paths.
    return res.status(500).json({ error: 'internal_error' })
  }
}
