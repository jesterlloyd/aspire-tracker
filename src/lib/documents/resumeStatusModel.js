// src/lib/documents/resumeStatusModel.js
//
// RESUME-WORKSPACE-1 (Owner, 2026-10-05): one answer per alumnus to "where is their résumé?",
// for Residency > Support > By Alumnus. It replaced two columns that disagreed: Résumé showed
// only an Outreach-logged date (so a résumé on file still read "Upload") and Score could not be
// clicked. Now one cell says it in words, and clicking it opens the résumé.
//
// The state belongs to the CURRENT résumé: a newer upload that Keith has not read is "Not
// scored", even when an earlier version was. The server builds the map (api/ngrp-support.js,
// the ASPIRE team only: Talent Acquisition never sees a score); the browser only reads it.
import { reviewState } from './resumeReviewModel.js'

const STATUS = Object.freeze({
  none: { label: 'No résumé', tone: 'off', rank: 0 },
  unscored: { label: 'Not scored', tone: 'warn', rank: 1 },
  failed: { label: 'Not scored', tone: 'warn', rank: 1 },
  scoring: { label: 'Scoring', tone: 'off', rank: 2 },
  scored: { label: 'Scored', tone: 'info', rank: 3 },
  sent: { label: 'Sent', tone: 'ok', rank: 4 },
})

/**
 * One alumnus's résumé status.
 * @param {{ onRecord?: boolean, currentVersionId?: string|null, reviews?: object[] }} input
 *   reviews: this student's résumé reviews, any order.
 */
export function resumeStatus({ onRecord = false, currentVersionId = null, reviews = [] } = {}, now = Date.now()) {
  const onFile = Boolean(currentVersionId) || Boolean(onRecord)
  if (!onFile) return { key: 'none', ...STATUS.none }
  // Reviews need a version, so a résumé that only lives on the student record has none yet.
  const mine = currentVersionId
    ? reviews.filter(r => r.document_version_id === currentVersionId)
      .sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')))
    : []
  const latest = mine[0] || null
  const state = reviewState(latest, now)
  const key = state === 'none' ? 'unscored' : state
  const base = { key, ...STATUS[key], reviewId: latest?.id || null }
  if (key !== 'scored' && key !== 'sent') return base
  return {
    ...base,
    score: latest.score,
    readiness: latest.readiness,
    provenanceId: latest.provenance_id || null,
    sentAt: latest.sent_at || null,
  }
}

/** The map By Alumnus reads, keyed by student id. */
export function resumeStatusMap({ studentIds = [], onRecordIds = [], currentVersionByStudent = {}, reviews = [] } = {}, now = Date.now()) {
  const onRecord = new Set(onRecordIds)
  const byStudent = new Map()
  for (const r of reviews) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, [])
    byStudent.get(r.student_id).push(r)
  }
  const out = {}
  for (const id of studentIds) {
    out[id] = resumeStatus({
      onRecord: onRecord.has(id),
      currentVersionId: currentVersionByStudent[id] || null,
      reviews: byStudent.get(id) || [],
    }, now)
  }
  return out
}

// The filter above By Alumnus: a work queue, one click each.
export const RESUME_FILTERS = Object.freeze([
  Object.freeze({ key: 'all', label: 'All' }),
  Object.freeze({ key: 'none', label: 'No résumé' }),
  Object.freeze({ key: 'needs_score', label: 'Needs score' }),
  Object.freeze({ key: 'not_sent', label: 'Scored, not sent' }),
  Object.freeze({ key: 'sent', label: 'Sent' }),
])

export function matchesResumeFilter(status, filter) {
  const key = status?.key || 'none'
  if (filter === 'none') return key === 'none'
  if (filter === 'needs_score') return key === 'unscored' || key === 'failed'
  if (filter === 'not_sent') return key === 'scored'
  if (filter === 'sent') return key === 'sent'
  return true
}

/** Sort: no résumé first, then by state, then by score within a state. */
export function resumeSortValue(status) {
  if (!status) return 0
  return status.rank * 1000 + (Number.isFinite(status.score) ? status.score : 0)
}
