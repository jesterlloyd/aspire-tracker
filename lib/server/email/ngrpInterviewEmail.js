// lib/server/email/ngrpInterviewEmail.js
//
// NGRP-INTERVIEWS-1 Phase 4 (Owner, 2026-10-06): when Talent Acquisition or the ASPIRE team books,
// moves or cancels a residency interview on the Interview Schedule, the alumnus gets a
// confirmation and the unit's leaders get a notice, both with a calendar invite.
//
// Pure, like the other modules here: no Resend, no Supabase. It returns { subject, html } and the
// .ics text, so a test (and any preview) renders exactly what the send sends.
import { aspireEmailShell } from './aspireShell.js'
import { renderEmailHeading, renderEmailDetailsCard, escapeHtml } from './emailPrimitives.js'
import { aspireHandwrittenSignature } from '../../../src/lib/notifications/handwrittenSignature.js'

// Residency mail points at the NGRP mailbox (Owner, 2026-09-14), as the reflection email does.
export const NGRP_SUPPORT_EMAIL = 'ngrp@cshs.org'
const FOOTER_NOTE = `Please do not reply to this automated email. For questions, email ${NGRP_SUPPORT_EMAIL}.`
export const INTERVIEW_NOTICE_KINDS = Object.freeze(['booked', 'moved', 'cancelled'])
const MODE_WORDS = { in_person: 'In person', virtual: 'Virtual' }
const PT = { timeZone: 'America/Los_Angeles' }

export function whenWords(iso) {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', ...PT })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...PT })
  return { date, time, line: `${date} at ${time} Pacific Time` }
}

const firstOf = p => p?.preferred_first_name || p?.first_name || 'there'
const fullOf = p => `${p?.preferred_first_name || p?.first_name || ''} ${p?.last_name || ''}`.trim() || 'The applicant'

/**
 * One notice. `audience` is 'alumnus' or 'unit'. `slot` is { slot_at, duration_minutes }; for a move,
 * `previous` is the slot it moved from. Returns { subject, html }.
 */
export function interviewNoticeEmail({ kind, audience, applicant, unit, slot, previous = null, mode = null, recipientName = '' }) {
  const when = whenWords(slot.slot_at)
  const was = previous ? whenWords(previous.slot_at) : null
  const who = fullOf(applicant)
  const rows = [
    ...(audience === 'unit' ? [{ label: 'Applicant', value: who }] : []),
    { label: 'Unit', value: unit },
    { label: kind === 'cancelled' ? 'Was' : 'When', value: when.line },
    ...(kind === 'moved' && was ? [{ label: 'Moved from', value: was.line }] : []),
    ...(kind !== 'cancelled' ? [{ label: 'Length', value: `${slot.duration_minutes} minutes` }] : []),
    ...(kind !== 'cancelled' && mode ? [{ label: 'Format', value: MODE_WORDS[mode] || '' }] : []),
  ]

  let subject, heading, lead
  if (audience === 'alumnus') {
    subject = kind === 'cancelled' ? 'Your Residency Interview Has Been Cancelled'
      : kind === 'moved' ? 'Your Residency Interview Has Moved' : 'Your Residency Interview Is Scheduled'
    heading = kind === 'cancelled' ? 'Interview cancelled' : kind === 'moved' ? 'Interview moved' : 'Interview scheduled'
    lead = kind === 'cancelled'
      ? `Your residency interview with ${escapeHtml(unit)} has been cancelled. We will be in touch about next steps.`
      : kind === 'moved'
        ? `Your residency interview with ${escapeHtml(unit)} has moved to a new time. The details are below, and the attached invite updates your calendar.`
        : `Your residency interview with ${escapeHtml(unit)} is scheduled. The details are below, and the attached invite adds it to your calendar.`
  } else {
    subject = `${kind === 'cancelled' ? 'Interview cancelled' : kind === 'moved' ? 'Interview moved' : 'Interview scheduled'}: ${who}, ${when.date.replace(/, \d{4}$/, '')}`
    heading = kind === 'cancelled' ? 'Residency interview cancelled' : kind === 'moved' ? 'Residency interview moved' : 'Residency interview scheduled'
    lead = kind === 'cancelled'
      ? `The residency interview below has been cancelled, and the time is open again on your Interviews calendar.`
      : `A residency interview is ${kind === 'moved' ? 'moved' : 'scheduled'} with your unit. Score it in the Unit Leader Portal's Interviews tab.`
  }
  const greeting = audience === 'alumnus' ? firstOf(applicant) : (recipientName || 'there')
  const body = `
    <p style="margin:0 0 14px;">Hi ${escapeHtml(greeting)},</p>
    ${renderEmailHeading({ level: 2, text: heading })}
    <p style="margin:0 0 16px;">${lead}</p>
    ${renderEmailDetailsCard({ rows })}
    <p style="margin:16px 0 14px;">If you have questions, email <a href="mailto:${NGRP_SUPPORT_EMAIL}" style="color:#1d2567;">${NGRP_SUPPORT_EMAIL}</a>.</p>
    ${aspireHandwrittenSignature('Kind regards,')}`
  return { subject, html: aspireEmailShell({ body, preheader: `${heading}: ${when.line}`, footerNote: FOOTER_NOTE }) }
}

const icsStamp = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/**
 * The invite. One UID per applicant per cohort, so a move updates the same calendar event and a
 * cancel removes it; SEQUENCE grows with each change (seconds since 2026, always increasing).
 */
export function interviewIcs({ kind, candidateId, unit, slot, applicantName, mode = null, nowIso = new Date().toISOString() }) {
  const start = new Date(slot.slot_at)
  const end = new Date(start.getTime() + slot.duration_minutes * 60000)
  const sequence = Math.max(0, Math.floor((Date.parse(nowIso) - Date.UTC(2026, 0, 1)) / 1000))
  const cancel = kind === 'cancelled'
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ASPIRE Intelligence//Cedars-Sinai//EN', 'CALSCALE:GREGORIAN',
    `METHOD:${cancel ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:ngrp-interview-${candidateId}@aspire-program.com`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${icsStamp(nowIso)}`,
    `DTSTART:${icsStamp(start.toISOString())}`,
    `DTEND:${icsStamp(end.toISOString())}`,
    `SUMMARY:${icsText(`Residency interview: ${applicantName} with ${unit}`)}`,
    `DESCRIPTION:${icsText(`Residency interview with ${unit}${mode ? ` (${MODE_WORDS[mode]})` : ''}. Questions: ${NGRP_SUPPORT_EMAIL}`)}`,
    ...(mode === 'virtual' ? ['LOCATION:Virtual (link to follow)'] : mode === 'in_person' ? [`LOCATION:${icsText(`${unit}, Cedars-Sinai`)}`] : []),
    `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
}
