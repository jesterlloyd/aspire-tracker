// src/lib/ngrp/applicantPacketModel.js
//
// APPLICANT-PACKET-1 (Owner, adoption phase 4): one click on an applicant's binder gives one
// PDF to hand to a hiring unit: a summary page, the submitted Transition Form, then the
// application documents themselves. This module decides WHAT is in it; applicantPacketPdf.js
// draws it. Pure, so the tests read the same rule the button runs.
//
// Everything here is something the person pressing the button can already see in the binder,
// read through the same endpoints (Talent Acquisition's narrowing included). Two things are
// deliberately left out because the packet is made to be passed on: Keith's résumé score and
// review (an internal rubric), and preceptor feedback (released only by request, to one person).
import {
  INTEREST_STATES, ELIGIBILITY_STATES, FORM_STATES, INTERVIEW_STATES,
  effectiveEligibility, effectivePreferences,
} from './ngrpStates.js'
import { supportActivity } from './ngrpSupportActivities.js'
import { transitionSummaryRows } from './transitionSummary.js'
import { getStudentLegalDisplayName } from '../studentNameFormatters.js'

// A document is put in the packet when its current file is one of these; a Word file is
// listed instead, because a browser cannot turn it into PDF pages.
export const PACKET_PDF_TYPES = Object.freeze(['application/pdf'])
export const PACKET_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png'])

const label = (states, v) => states[v]?.label || (v ? String(v).replace(/_/g, ' ') : '')
const day = (v) => {
  if (!v) return ''
  const s = String(v)
  // A date-only value is a calendar day; never let a time zone move it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })
}
const extOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
const typeOf = (v) => v?.content_type || ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[extOf(v?.file_name)] || '')

/** "Applicant Packet - DeLeon, Abel - Winter 2027.pdf", with nothing a file system refuses. */
export function packetFileName(student, cycle) {
  const name = [student?.last_name, student?.preferred_first_name || student?.first_name].filter(Boolean).join(', ') || 'Applicant'
  const raw = ['Applicant Packet', name, cycle?.name].filter(Boolean).join(' - ')
  return `${raw.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()}.pdf`
}

/**
 * The documents, in the checklist's order: each type's CURRENT file, and what happens to it.
 * status: 'include' (PDF pages or an image page) | 'word' (listed, not included) | 'missing'.
 */
export function packetDocuments({ types = [], documents = [] } = {}) {
  const byType = new Map((documents || []).map(d => [d.doc_type, d]))
  return [...(types || [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((t) => {
      const doc = byType.get(t.key)
      const current = doc ? (doc.versions || []).find(v => v.id === doc.current_version_id) || null : null
      const name = t.qualifier ? `${t.label} (${t.qualifier})` : t.label
      if (!current) return { key: t.key, name, status: 'missing', required: t.required === true }
      const type = typeOf(current)
      const kind = PACKET_PDF_TYPES.includes(type) ? 'pdf' : PACKET_IMAGE_TYPES.includes(type) ? 'image' : null
      return {
        key: t.key, name, required: t.required === true,
        status: kind ? 'include' : 'word', kind,
        versionId: current.id, fileName: current.file_name || '', contentType: type,
        uploadedAt: current.uploaded_at || null, docDate: current.doc_date || null,
      }
    })
}

/**
 * The summary page: who, where they stand, and how they prepared.
 * @param row        the applicant row (deriveApplicantRows)
 * @param profile    /api/ngrp-workspace `profile` answer, or null (contact only when shared)
 * @param support    this alumnus's live support entries
 * @param revision   the latest submitted Transition Form revision, or null
 */
export function packetSummary({ row, cycle, profile = null, support = [], revision = null, documents = [], now = new Date() }) {
  const s = row?.student || {}
  const contact = profile?.contactShared ? profile.student || {} : null
  const prefs = effectivePreferences(row || {}).preferences || []
  const o = row?.outcome || null
  const sections = [
    {
      heading: 'Applicant',
      rows: [
        ['School', [s.school, s.program_type].filter(Boolean).join(' · ')],
        ['ASPIRE cohort', s.aspire_cohort || ''],
        ['Residency cohort', cycle?.name || ''],
        ...(contact ? [
          ['Personal email', contact.personal_email || ''],
          ['School email', contact.school_email || ''],
          ['Phone', contact.phone || ''],
        ] : [['Contact', profile && !profile.contactShared ? 'Shared once they submit the Transition Form' : '']]),
      ],
    },
    {
      heading: 'Application',
      rows: [
        ['Interest', label(INTEREST_STATES, row?.interest)],
        ['Eligibility', label(ELIGIBILITY_STATES, effectiveEligibility(row || {}))],
        // "Submitted Oct 1, 2026", "Revised Oct 3, 2026", or the state alone.
        ['Transition Form', [label(FORM_STATES, row?.form_status), day(row?.form_revised_at || row?.form_submitted_at)].filter(Boolean).join(' ')],
        ['Unit choices', prefs.map((u, i) => `${i + 1}. ${u}`).join(' · ')],
        ['Paired with', row?.assigned_unit || ''],
        ['Interview', [label(INTERVIEW_STATES, row?.interview_status), day(row?.interview_at)].filter(Boolean).join(', ')],
        ...(o?.offer_extended_at ? [['Offer extended', day(o.offer_extended_at)]] : []),
        ...(o?.offer_accepted_at ? [['Offer accepted', day(o.offer_accepted_at)]] : []),
        ...(o?.hired_at ? [['Hired', [day(o.hired_at), o.hired_unit].filter(Boolean).join(' · ')]] : []),
      ],
    },
    {
      heading: 'Residency Preparation',
      rows: (support || [])
        .filter(e => !e.voided_at)
        .sort((a, b) => String(a.occurred_on || '').localeCompare(String(b.occurred_on || '')))
        .map(e => [supportActivity(e.activity)?.label || String(e.activity || ''), day(e.occurred_on)]),
      empty: 'No support recorded. Taking part is optional and never affects eligibility.',
    },
  ].map(sec => ({ ...sec, rows: sec.rows.filter(([, v]) => v) }))

  return {
    title: 'Applicant Packet',
    name: getStudentLegalDisplayName(s),
    generated: `Prepared ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })}`,
    sections,
    form: revision?.payload ? {
      heading: `Transition Form${revision.revision_number ? `, revision ${revision.revision_number}` : ''}`,
      sub: revision.submitted_at ? `Submitted ${day(revision.submitted_at)}` : '',
      rows: transitionSummaryRows(revision.payload),
    } : null,
    documents,
  }
}
