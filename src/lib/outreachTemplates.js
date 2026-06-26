// src/lib/outreachTemplates.js
//
// MANUAL-OUTREACH-TEMPLATE-LIBRARY Phase 1 — copy builders for single-recipient manual templates.
// These return plain { subject, body } drafts that are ALWAYS editable before sending:
//   • Coordinator Acceptance Update → hydrates the in-app Direct Message composer (ASPIRE Outreach).
//   • Preceptor Assignment         → opens Outlook Web compose (internal Cedars communication).
//
// Copy is intentionally safe-draft with clear [placeholders] and fallbacks; the owner customizes the
// final wording after visual QA. No tokens, secure links, or documents are embedded.

// Formal signature (per approved Phase 1 spec).
const SIGNATURE = `Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
ASPIRE Program Lead
Brawerman Nursing Institute, Cedars-Sinai
JesterLloyd.Bautista@cshs.org | Office: 310-248-8964`

// fallback: use a trimmed value if present, else the placeholder.
const fb = (v, placeholder) => (v && String(v).trim()) ? String(v).trim() : placeholder

// Preceptor Assignment — internal Cedars email (opens in Outlook Web compose).
export function buildPreceptorAssignmentDraft({ studentName, school, unit } = {}) {
  const sName = fb(studentName, '[Student Name]')
  const subject = studentName
    ? `ASPIRE Program: Preceptor Assignment – ${sName}`
    : 'ASPIRE Program: Preceptor Assignment'
  const body = `Dear Preceptor,

Thank you so much for agreeing to precept one of our senior nursing students through the ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience). Your willingness to teach, mentor, and support our students makes a real difference in shaping the next generation of nurses at Cedars-Sinai.

Student: ${sName}
School: ${fb(school, '[School]')}
Unit / Assignment: ${fb(unit, '[Unit / Assignment]')}
Rotation Dates: [Rotation Dates]
Shifts / Hours: [Hours]

The student will reach out directly to introduce themselves and coordinate schedules. A few general ASPIRE expectations: students follow the pre-licensure student scope and guidelines, are not counted in unit staffing, and should not be in charge while precepting. Floating with you is acceptable when appropriate for learning and safety.

You may attach the ASPIRE Brochure and the Pre-licensure Student General Guidelines before sending. If you have any questions, please feel free to reply.

Warm regards,
${SIGNATURE}`
  return { subject, body }
}

// Coordinator Acceptance Update — external coordinator/academic-partner email (ASPIRE Outreach).
export function buildCoordinatorAcceptanceDraft({ coordinatorName, studentName, school } = {}) {
  const subject = 'ASPIRE Program: Student Acceptance & Status Update'
  const body = `Dear ${fb(coordinatorName, 'Colleague')},

I'm reaching out with an update on your student's participation in the ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience) at Cedars-Sinai.

Student: ${fb(studentName, '[Student Name]')}
School: ${fb(school, '[School]')}
Status: Accepted into the ASPIRE Program

A few items for your awareness:
- Expectations & guidelines: [summarize expectations or note attached guidelines]
- Orientation details: [orientation date / location / format]
- We may send brief weekly updates on the student's rotation progress when available.

Please let me know if there is any documentation or coordination needed on your end. Thank you for your continued partnership in supporting clinical nursing education.

Warm regards,
${SIGNATURE}`
  return { subject, body }
}
