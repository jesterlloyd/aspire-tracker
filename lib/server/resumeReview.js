// lib/server/resumeReview.js
//
// RESUME-REVIEW-1 (résumé review build, Phase 3): Keith scores one résumé version against the
// ASPIRE résumé rubric. api/student-documents.js is the only caller; it has already decided
// that this caller may run (Owner, Admin) or read (and Co-Lead) reviews.
//
// The path, in the order the gates run (the same shape as resume-interview-questions, the
// first Skill that reads a résumé):
//   the version is THIS student's résumé version (never a path from the request)
//     -> the caller may read this student's résumé (authorizeStudentResumeAccess)
//       -> the bytes are downloaded with the service client and the text extracted
//         -> contact details are redacted, then the text is truncated to the budget
//           -> a review row is written as 'scoring' (so a closed tab still finds it)
//             -> runKeithSkill('review-resume'): its own on/off switch, role check, schema,
//                usage, metadata-only invocation audit and provenance
//               -> the row becomes 'scored' (or 'failed', with the file untouched)
// Nothing here writes to the student record, the résumé, or any other table.
import { Buffer } from 'node:buffer'
import { runKeithSkill, loadSkill } from './keith/runKeithSkill.js'
import { authorizeStudentResumeAccess, authorizeSkillForCaller } from './keith/skillAuthorization.js'
import { skillMode } from '../../src/lib/keith/provenanceModel.js'
import { extractResumeText } from './keith/resumeExtract.js'
import { redactContactDetails, truncateForInference } from './keith/resumeRedaction.js'
import { countPdfPages } from './studentDocuments.js'

export const REVIEWS = 'resume_reviews'
const MAX_RESUME_CHARS = 14000
const LIST_FIELDS = 'id, student_id, document_version_id, status, score, categories, readiness, readiness_reason, summary, strengths, top_fixes, missing_info, full_report, draft_subject, draft_body, include_score, include_bullets, pages, provenance_id, error_reason, requested_by, requested_at, scored_at, outreach_message_id, sent_at'

const FAIL_REASONS = {
  off: 'skill_off', denied: 'skill_denied', invalid_output: 'invalid_output',
  upstream_rate_limited: 'rate_limited', upstream_error: 'upstream_error', upstream_timeout: 'upstream_timeout',
}

// May this person run the Skill right now? Off (not active, or disabled) and not-allowed are
// answered before any row is written, so they never leave a Failed review behind.
export async function scoringAvailability(db, actor) {
  try {
    const skill = await loadSkill(db, 'review-resume')
    if (!skill || skillMode(skill) === 'off') return { available: false, reason: 'skill_off' }
    const ok = authorizeSkillForCaller(skill, { profileId: actor?.id, role: actor?.role, isOwner: actor?.is_owner === true }).ok
    return ok ? { available: true } : { available: false, reason: 'skill_denied' }
  } catch {
    return { available: false, reason: 'skill_off' }
  }
}

export async function listReviews(db, studentId, { withText = false } = {}) {
  const { data, error } = await db.from(REVIEWS).select(withText ? `${LIST_FIELDS}, resume_text` : LIST_FIELDS)
    .eq('student_id', studentId).order('requested_at', { ascending: false }).limit(50)
  if (error) return { error }
  return { reviews: data || [] }
}

export async function getReview(db, reviewId) {
  const { data, error } = await db.from(REVIEWS).select(`${LIST_FIELDS}, resume_text`).eq('id', reviewId).maybeSingle()
  if (error) return { error }
  return { review: data || null }
}

// Load the version and prove it is this student's résumé.
async function resumeVersionFor(db, studentId, versionId) {
  const v = await db.from('student_document_versions').select('id, document_id, storage_bucket, storage_path, file_name, pages').eq('id', versionId).maybeSingle()
  if (v.error) return { error: v.error }
  if (!v.data) return { notFound: true }
  const d = await db.from('student_documents').select('id, student_id, doc_type').eq('id', v.data.document_id).maybeSingle()
  if (d.error) return { error: d.error }
  if (!d.data || d.data.student_id !== studentId || d.data.doc_type !== 'resume') return { notFound: true }
  return { version: v.data }
}

/**
 * Score one résumé version. Returns { ok, review } or { ok: false, status, error, review? }.
 * `complete` is injected by tests; production never passes it.
 */
export async function scoreResumeVersion(db, storage, { student, versionId, actor, nowIso = new Date().toISOString(), complete }) {
  const gate = await authorizeStudentResumeAccess({
    db, caller: { profileId: actor?.id, role: actor?.role, isOwner: actor?.is_owner === true }, student,
  })
  if (!gate.ok) return { ok: false, status: 403, error: 'forbidden' }
  const avail = await scoringAvailability(db, actor)
  if (!avail.available) return { ok: false, status: 409, error: avail.reason }
  const found = await resumeVersionFor(db, student.id, versionId)
  if (found.error) return { ok: false, status: 500, error: 'internal_error', cause: found.error }
  if (found.notFound) return { ok: false, status: 404, error: 'not_found' }
  const version = found.version

  const ins = await db.from(REVIEWS).insert({
    student_id: student.id, document_version_id: version.id, status: 'scoring', requested_by: actor?.id || null, requested_at: nowIso,
  }).select('id').maybeSingle()
  if (ins.error) return { ok: false, status: 500, error: 'internal_error', cause: ins.error }
  const reviewId = ins.data.id
  const fail = async (reason, status = 502) => {
    await db.from(REVIEWS).update({ status: 'failed', error_reason: reason }).eq('id', reviewId)
    const r = await getReview(db, reviewId)
    return { ok: false, status, error: reason, review: r.review || null }
  }

  const dl = await storage.from(version.storage_bucket).download(version.storage_path)
  if (dl.error || !dl.data) return fail('file_unavailable')
  const bytes = Buffer.from(await dl.data.arrayBuffer())
  const extracted = await extractResumeText(bytes)
  if (!extracted.ok) return fail(`unreadable_${extracted.reason || 'file'}`, 422)
  const { text: redacted, counts } = redactContactDetails(extracted.text)
  const { text: resumeText, truncated } = truncateForInference(redacted, MAX_RESUME_CHARS)
  const pages = version.pages ?? (extracted.format === 'pdf' ? await countPdfPages(bytes) : null)
  await db.from(REVIEWS).update({ resume_text: resumeText, pages }).eq('id', reviewId)

  const run = await runKeithSkill(db, 'review-resume', {
    resume_text: { value: resumeText, refs: [{ type: 'student_resume', id: version.id }] },
    applicant: {
      value: { firstName: student.preferred_first_name || student.first_name || 'there', cohort: student.aspire_cohort || null },
      refs: [{ type: 'student_record', id: student.id }],
    },
  }, {
    actor, entity: { id: reviewId }, invocationMode: 'documents',
    dataSources: { resume: { format: extracted.format, chars_sent: resumeText.length, truncated, redactions: counts } },
    ...(complete ? { complete } : {}),
  })
  if (!run.ok) return fail(FAIL_REASONS[run.reason] || run.reason || 'upstream_error', run.status || 502)

  const o = run.output
  const done = await db.from(REVIEWS).update({
    status: 'scored', score: o.score, categories: o.categories, readiness: o.readiness, readiness_reason: o.readiness_reason,
    summary: o.summary, strengths: o.strengths, top_fixes: o.top_fixes, missing_info: o.missing_info, full_report: o.full_report,
    draft_subject: o.draft.subject, draft_body: o.draft.body, provenance_id: run.provenanceId || null,
    scored_at: new Date().toISOString(), error_reason: null,
  }).eq('id', reviewId)
  if (done.error) return { ok: false, status: 500, error: 'internal_error', cause: done.error }
  const r = await getReview(db, reviewId)
  return { ok: true, review: r.review }
}

// Rewrite the draft (warmer, shorter, afresh). Writes only the draft columns.
export async function reviseDraft(db, { review, style, actor, complete }) {
  if (!['warmer', 'shorter', 'fresh'].includes(style)) return { ok: false, status: 422, error: 'invalid_style' }
  if (!['scored', 'sent'].includes(review.status)) return { ok: false, status: 409, error: 'not_scored' }
  const summary = {
    first_name: null, strengths: review.strengths || [], top_fixes: (review.top_fixes || []).map(f => f.fix),
    missing_info: review.missing_info || [], summary: review.summary || '',
  }
  const run = await runKeithSkill(db, 'review-resume-draft', {
    review: { value: summary, refs: [{ type: 'resume_review', id: review.id }] },
    draft: { value: { subject: review.draft_subject || '', body: review.draft_body || '' } },
    style: { value: style },
  }, { actor, entity: { id: review.id, field: 'draft' }, invocationMode: 'documents', ...(complete ? { complete } : {}) })
  if (!run.ok) return { ok: false, status: run.status || 502, error: FAIL_REASONS[run.reason] || 'upstream_error' }
  const patch = { draft_body: run.output.body, ...(run.output.subject ? { draft_subject: run.output.subject } : {}) }
  const u = await db.from(REVIEWS).update(patch).eq('id', review.id)
  if (u.error) return { ok: false, status: 500, error: 'internal_error' }
  return { ok: true, draft: { subject: patch.draft_subject || review.draft_subject, body: patch.draft_body } }
}

// The reviewer's own edits to the draft and the two boxes.
export async function saveDraft(db, { review, subject, body, includeScore, includeBullets }) {
  const patch = {}
  if (typeof subject === 'string') patch.draft_subject = subject.trim().slice(0, 160)
  if (typeof body === 'string') patch.draft_body = body.slice(0, 5000)
  if (typeof includeScore === 'boolean') patch.include_score = includeScore
  if (typeof includeBullets === 'boolean') patch.include_bullets = includeBullets
  if (!Object.keys(patch).length) return { ok: true }
  const u = await db.from(REVIEWS).update(patch).eq('id', review.id)
  if (u.error) return { ok: false, status: 500, error: 'internal_error' }
  return { ok: true }
}
