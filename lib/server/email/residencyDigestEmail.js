// lib/server/email/residencyDigestEmail.js
//
// RESIDENCY-DIGEST-1: the weekly Residency digest for Talent Acquisition. Pure and client-safe,
// like ngrpReflectionEmail.js: it takes the sections (src/lib/ngrp/residencyDigestModel.js) and
// a base URL and returns { subject, html }, so the Automations preview renders the same builder
// the cron sends. Every link opens the Residency Portal at the row's own screen.
import { aspireEmailShell, aspireSystemSignature } from './aspireShell.js'
import { escapeHtml, escapeAttr, renderEmailButton } from './emailPrimitives.js'

const NAVY = '#1D2567'
const INK = '#2B2B2B'
const MUTED = '#5B6470'
// Pill words in the email: ink on a fixed pale ground, the screen's tones.
const TONES = {
  navy: ['#E8EAF5', '#1D2567'], amber: ['#FDF1DC', '#7A4A06'], red: ['#FBE4E4', '#8E1F1F'],
  green: ['#E3F4E8', '#1D5E33'], plum: ['#F1E6F3', '#5E2B6A'], grey: ['#EEF0F2', '#454C55'],
}
const FOOTER = 'You get this because you turned on the weekly digest in the Residency Portal. To stop it, open your profile menu there and turn off Weekly digest email.'

const link = (baseUrl, to) => `${baseUrl}${to}`

function pill({ text, tone }) {
  const [bg, ink] = TONES[tone] || TONES.grey
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${bg};color:${ink};font-size:11px;font-weight:700;white-space:nowrap;">${escapeHtml(text)}</span>`
}

function groupHtml(g, baseUrl) {
  const rows = g.rows.map(r => `
    <tr><td style="padding:9px 0;border-top:1px solid #ECEAE5;">
      <a href="${escapeAttr(link(baseUrl, r.to))}" style="color:${NAVY};font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(r.title)}</a>
      ${r.meta ? `<div style="color:${MUTED};font-size:12.5px;margin-top:2px;">${escapeHtml(r.meta)}</div>` : ''}
    </td><td style="padding:9px 0 9px 10px;border-top:1px solid #ECEAE5;text-align:right;vertical-align:top;">${r.pill ? pill(r.pill) : ''}</td></tr>`).join('')
  const more = g.more > 0
    ? `<p style="margin:8px 0 0;font-size:13px;"><a href="${escapeAttr(link(baseUrl, g.open.to))}" style="color:${NAVY};">and ${g.more} more · ${escapeHtml(g.open.label)}</a></p>`
    : ''
  return `
    <div style="margin:0 0 22px;">
      <div style="font-size:15px;font-weight:700;color:${INK};">${escapeHtml(g.name)} <span style="color:${MUTED};font-weight:400;font-size:13px;">· ${escapeHtml(g.sub)} · ${g.total}</span></div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${rows}</table>
      ${more}
    </div>`
}

/**
 * @param sections from buildDigestSections
 * @param recipientName the reader's name, for the greeting
 * @param weekOf the Monday this digest covers, e.g. "October 12"
 * @param baseUrl the app's origin, no trailing slash
 */
export function buildResidencyDigestEmail({ sections = [], recipientName = '', weekOf = '', baseUrl = '' } = {}) {
  const first = escapeHtml(String(recipientName || '').trim().split(/\s+/)[0] || 'there')
  const total = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.total, 0), 0)
  const many = sections.length > 1
  const body = `
    <p style="margin:0 0 14px;">Hi ${first},</p>
    <p style="margin:0 0 18px;">Here is what needs attention in Residency this week: interviews, offers waiting on an answer, alumni flagged for follow-up, and new application documents. Each name opens that alumnus in the Residency Portal.</p>
    ${sections.map(s => `
      ${many || s.cycleName ? `<div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${MUTED};margin:6px 0 12px;">${escapeHtml(s.cycleName || 'Residency')}</div>` : ''}
      ${s.groups.map(g => groupHtml(g, baseUrl)).join('')}`).join('')}
    ${renderEmailButton({ label: 'Open the Residency Portal', url: link(baseUrl, '/portal/residency/overview'), variant: 'navy', trustedUrl: true })}
    ${aspireSystemSignature('Kind regards,')}
  `
  return {
    subject: weekOf ? `Residency this week: ${total} ${total === 1 ? 'item needs' : 'items need'} attention (week of ${weekOf})` : `Residency this week: ${total} ${total === 1 ? 'item needs' : 'items need'} attention`,
    html: aspireEmailShell({ body, preheader: `${total} ${total === 1 ? 'item' : 'items'} in Residency: interviews, offers, flags and documents.`, footerNote: FOOTER }),
  }
}
