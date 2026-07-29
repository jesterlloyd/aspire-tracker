// Required-documents rule for the /student-form Section 4 (Documents). Pure and shared by the intake
// form and its tests. Both a resume and a headshot are required to submit. A slot counts as satisfied
// only when it has a durable reference: a freshly selected file that will be uploaded, or a path from
// an already-successful upload. A selected-but-failed or omitted upload leaves the slot falsy.
//
// The API (api/student-intake-submit.js) re-checks the SAME rule against the canonical stored
// resume_url / headshot_url references, so a bypassed browser cannot submit a partial application.
// The messages here are the single source of truth for the copy; the server keeps an exact duplicate
// (api/ cannot import src/ at the Vercel runtime) and a test guards their parity.

export const DOCUMENT_MESSAGES = {
  both:     'Upload your resume and headshot before submitting.',
  resume:   'Upload your resume before submitting.',
  headshot: 'Upload your headshot before submitting.',
}

// Returns null when both documents are present, else a safe { field, message } naming the first
// missing document. `field` is 'resume' | 'headshot' (used to move focus to the first missing control).
export function evaluateRequiredDocuments({ hasResume, hasHeadshot }) {
  if (!hasResume && !hasHeadshot) return { field: 'resume', message: DOCUMENT_MESSAGES.both }
  if (!hasResume)   return { field: 'resume',   message: DOCUMENT_MESSAGES.resume }
  if (!hasHeadshot) return { field: 'headshot', message: DOCUMENT_MESSAGES.headshot }
  return null
}
