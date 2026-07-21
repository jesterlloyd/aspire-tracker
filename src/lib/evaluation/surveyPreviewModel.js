// src/lib/evaluation/surveyPreviewModel.js
//
// ASPIRE-EVAL-PREVIEW-1: normalize every survey definition into ONE preview model.
//
// SOURCE OF TRUTH, NOT A COPY. There is no question text in this file. Three of the
// four surveys keep their prose in the private evaluation-instrument-content Storage
// bucket and are fetched by slug through the existing Owner/Admin endpoint
// api/evaluation-instrument-content.js, which is the same bytes the live survey page
// renders from. The fourth ships its definition in code and is imported directly.
// If a question changes in Storage, Preview changes with it, because Preview reads
// the same object at request time.
//
// CASEY-FINK: third-party instrument, permission_status is pending, and the schema
// comments forbid storing its item prose in the database. Preview renders it through
// the gated endpoint and never caches or persists it.
//
// The four content shapes genuinely differ (Casey-Fink is flat item codes with
// per-section anchors; the two ASPIRE-authored ones are sectionN objects keyed by
// question key; the post-rotation one is an ordered sections array). Rather than
// teach the preview component three shapes, each is normalized here into:
//
//   { title, intro, sections: [{ key, title, instructions, items: [ITEM] }],
//     attestation, notes: [] }
//   ITEM: { key, label, type, required, scale: [{value,label}], helper }
//
// type is one of: rating | text | select | yesno | display.

import { POST_ROTATION_CONTENT } from '../../../lib/server/evaluation/postRotationEvalContent.js'

const item = ({ key, label, type, required = false, scale = [], helper = '' }) =>
  ({ key, label, type, required, scale, helper })

/** A sectionN block keyed by question key, as used by the two ASPIRE-authored surveys. */
function normalizeKeyedSection(sec, { scale, requiredDefault = true }) {
  if (!sec) return null
  const items = []
  for (const [key, def] of Object.entries(sec.items || {})) {
    items.push(item({
      key,
      label: def?.label || key,
      helper: def?.prompt || '',
      type: 'rating',
      required: def?.required ?? requiredDefault,
      scale,
    }))
  }
  // An optional per-section narrative comment, where the section defines one.
  if (sec.commentKey || sec.commentLabel) {
    items.push(item({
      key: sec.commentKey || `${sec.key || ''}_comment`,
      label: sec.commentLabel || 'Comments',
      type: 'text',
      required: false,
    }))
  }
  return { key: sec.key || sec.title || 'section', title: sec.title || '', instructions: sec.instructions || '', items }
}

/** A block of free-text or option fields, as used by section1/section5 style blocks. */
function normalizeFieldSection(sec, fallbackKey) {
  if (!sec) return null
  const items = []
  for (const [key, def] of Object.entries(sec.fields || {})) {
    const options = def?.options || []
    items.push(item({
      key,
      label: def?.label || key,
      // mode 'display' means a prefilled context field the respondent cannot edit.
      type: def?.mode === 'display' ? 'display' : (options.length > 0 ? 'select' : 'text'),
      required: def?.required ?? false,
      scale: options,
    }))
  }
  return { key: sec.key || fallbackKey, title: sec.title || '', instructions: sec.instructions || '', items }
}

/** student_preceptor_eval and preceptor_progress share a family of shapes. */
function normalizeAspireAuthored(content) {
  const scale = content.ratingScale || []
  const sections = []

  const target = normalizeFieldSection(content.evaluatedTarget, 'evaluated_target')
  if (target) sections.push(target)
  const s1fields = content.section1?.fields ? normalizeFieldSection(content.section1, 'section1') : null
  if (s1fields) sections.push(s1fields)

  for (const key of ['section1', 'section2', 'section3', 'section4', 'section5']) {
    const sec = content[key]
    if (!sec || sec.fields) continue           // field blocks handled above/below
    const norm = normalizeKeyedSection(sec, { scale })
    if (!norm) continue
    // section4 may carry a single extra overall rating on its own scale.
    const ratingItem = sec.ratingItem || {}
    for (const [rk, rdef] of Object.entries(ratingItem)) {
      norm.items.push(item({
        key: rk, label: rdef?.label || rk, type: 'rating', required: true, scale: rdef?.scale || scale,
      }))
    }
    sections.push(norm)
  }

  for (const key of ['section5']) {
    const sec = content[key]
    if (sec?.fields) {
      const norm = normalizeFieldSection(sec, key)
      if (norm) sections.push(norm)
    }
  }

  const att = content.attestation
  return {
    title: content.displayName || '',
    intro: content.intro || null,
    sections: sections.filter(s => s && s.items.length > 0),
    attestation: att ? { label: att.label || '', required: att.required !== false } : null,
    notes: [],
  }
}

/** casey_fink_readiness_2024: flat item codes plus per-section anchors. */
function normalizeCaseyFink(content) {
  const codes = content.items || {}
  const anchors = content.responseAnchors || {}
  const inst = content.sectionInstructions || {}
  const bySection = { s1: [], s2: [], s3: [] }

  for (const [code, label] of Object.entries(codes)) {
    const m = /^S([123])_Q\d+$/.exec(code)
    if (!m) continue
    const s = `s${m[1]}`
    bySection[s].push(item({
      key: code,
      label: typeof label === 'string' ? label : (label?.label || code),
      type: 'rating',
      required: true,
      scale: anchors[s] || [],
    }))
  }

  const sections = [
    { key: 's1', title: 'Section I', instructions: inst.s1 || '', items: bySection.s1 },
    { key: 's2', title: 'Section II', instructions: inst.s2 || '', items: bySection.s2 },
    { key: 's3', title: 'Section III', instructions: inst.s3 || '', items: bySection.s3 },
  ]

  const demo = content.demographicQuestions || {}
  const demoItems = Object.entries(demo).map(([code, q]) => item({
    key: code,
    label: q?.label || q?.question || code,
    type: (q?.options || []).length > 0 ? 'select' : 'text',
    required: true,
    scale: q?.options || [],
  }))
  demoItems.push(item({
    key: 'S4_COMMENT',
    label: content.optionalCommentLabel || 'Additional comments (optional)',
    type: 'text',
    required: false,
  }))
  sections.push({ key: 's4', title: 'Section IV', instructions: inst.s4 || '', items: demoItems })

  return {
    title: content.displayName || 'Casey-Fink Readiness for Practice',
    intro: content.intro || null,
    sections: sections.filter(s => s.items.length > 0),
    attestation: null,
    // Surfaced in the drawer so a viewer understands why this one is handled differently.
    notes: ['Third-party instrument. Item text is licensed content and is never stored in the ASPIRE database.'],
  }
}

/** post_rotation_evaluation: already an ordered sections array in code. */
function normalizeInlinePostRotation() {
  const c = POST_ROTATION_CONTENT
  return {
    title: c.title || '',
    intro: c.intro ? { body: c.intro } : null,
    sections: (c.sections || []).map(sec => ({
      key: sec.key,
      title: sec.title || '',
      instructions: '',
      items: (sec.items || []).map(i => item({
        key: i.key,
        label: i.label,
        helper: i.helper || '',
        type: i.type === 'yesno' ? 'yesno' : (i.type === 'rating' ? 'rating' : 'text'),
        required: !!i.required,
        scale: i.type === 'rating' ? (c.ratingScale || []) : [],
      })),
    })),
    attestation: null,
    notes: [],
  }
}

/**
 * Build the preview model for a slug.
 * `content` is the object fetched from the instrument-content endpoint, and is ignored
 * for the one survey whose definition ships in code.
 */
export function buildPreviewModel(slug, content) {
  if (slug === 'post_rotation_evaluation') return normalizeInlinePostRotation()
  if (!content) return null
  if (slug === 'casey_fink_readiness_2024') return normalizeCaseyFink(content)
  return normalizeAspireAuthored(content)
}

/** Total question count, excluding prefilled display-only context fields. */
export function countQuestions(model) {
  if (!model) return 0
  return model.sections.reduce(
    (n, s) => n + s.items.filter(i => i.type !== 'display').length, 0)
}
