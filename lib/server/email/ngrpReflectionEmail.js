// lib/server/email/ngrpReflectionEmail.js
//
// RESIDENCY-REFLECTION-1: the email that carries one period's reflection link.
// Pure and client-safe, like ngrpTransitionEmail.js: no Resend, no Supabase,
// no token creation. It takes a URL and returns { subject, html }, so a preview
// can render the same builder the send uses.
import { aspireEmailShell } from './aspireShell.js'
import { aspireHandwrittenSignature } from '../../../src/lib/notifications/handwrittenSignature.js'
import { GRACE_DAYS, closesOn } from '../../../src/lib/ngrp/ngrpReflectionForm.js'

const SUPPORT_EMAIL = 'aspire@cshs.org'
const FOOTER_NOTE = `Please do not reply to this automated email. For questions, email the ASPIRE team at ${SUPPORT_EMAIL}.`

const escapeHtml = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Date-only values are Pacific calendar dates already; formatting them in UTC
// keeps the same day rather than sliding it by the offset.
export function fmtDay(ymd) {
  if (!ymd) return ''
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export function buildReflectionEmail({ student, run, period, url }) {
  const first = escapeHtml(student.preferred_first_name || student.first_name || 'there')
  const n = period.period_number
  const total = run.period_count
  const due = fmtDay(period.due_on)
  const closes = fmtDay(closesOn(period))
  const opens = fmtDay(period.opens_on)
  const body = `
    <p style="margin:0 0 14px;">Hi ${first},</p>
    <p style="margin:0 0 14px;">
      ${n === 1
        ? 'Welcome to your first weeks on the unit. Here is your <strong>NGRP Clinical Orientation Progress and Reflection Tool</strong> for period 1 of ' + total + '.'
        : `Period ${n} of ${total} of your <strong>NGRP Clinical Orientation Progress and Reflection Tool</strong> opens on <strong>${opens}</strong>.`}
      Fill it in as you go: add each shift after you work it, note what went well and what you want to improve, and set your goals for the two weeks.
      It saves automatically.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td
      style="background:#1d2567;border-radius:8px;">
      <a href="${url}" style="display:inline-block;padding:13px 26px;color:#ffffff;
        font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;">
        Open period ${n}</a>
    </td></tr></table>
    <p style="margin:0 0 14px;">
      Please submit it by <strong>${due}</strong>. The link stays open until ${closes}, then it closes.
      It is personal to you; please do not forward it.
    </p>
    ${n === 1 ? `<p style="margin:0 0 14px;color:#4a5560;font-size:13px;">
      The first period also asks for your unit, your preceptor's name, and your schedule, so your NPD-P mentor knows where to find you.
    </p>` : ''}
    <p style="margin:0 0 14px;">
      If you have questions, email <a href="mailto:${SUPPORT_EMAIL}" style="color:#1d2567;">${SUPPORT_EMAIL}</a>.
    </p>
    ${aspireHandwrittenSignature('Kind regards,')}
  `
  return {
    subject: `Your NGRP reflection: period ${n} of ${total}, due ${fmtDay(period.due_on).replace(/^[A-Za-z]+, /, '')}`,
    html: aspireEmailShell({ body, preheader: `Period ${n} of ${total} is ready. Due ${due}; open ${GRACE_DAYS} more days after that.`, footerNote: FOOTER_NOTE }),
  }
}
