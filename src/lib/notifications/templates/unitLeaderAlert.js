// src/lib/notifications/templates/unitLeaderAlert.js
//
// UL-PORTAL: the Unit Leader alert email.
//
// One template for all five email-eligible alert types, because they differ only in
// their label and summary. Reuses the shared ASPIRE system shell rather than
// inventing a second look, exactly as every other template does.
//
// PRIVACY: the email carries the alert label, the unit, and a short summary. It
// NEVER carries a student name, a message body, a support narrative, an internal
// note, or any onboarding detail. The portal is the only place that content lives,
// so an email landing in the wrong inbox discloses nothing about a student.
//
// The unsubscribe line names the exact place to change the setting, so a Unit
// Leader always has a way out that does not require contacting anyone.

// S-06 TEMPLATE ESCAPING: unit_name originates from the public unit participation form, and the
// greeting name from a profile record, so both are attacker-influenced free text interpolated into
// raw HTML. alert_label comes from a fixed server map and summary is server-composed today, but
// both are escaped as well so a future caller cannot reintroduce the defect. The CTA is built by
// appUrl() from a server-chosen path and is escaped for its attribute context.
import { escapeHtml } from '../../htmlEscape.js'
import { getGreetingName } from '../greetings.js'
import { aspireEmailShell } from '../../../../lib/server/email/aspireShell.js'
import { aspireHandwrittenSignature } from '../handwrittenSignature.js'
import { appUrl } from '../../appUrl.js'

const NAVY = '#1d2567'
const SAND = '#F4F1EC'

/** A short preheader, with no student information, mirroring the subject. */
function preheaderFor(ctx) {
  const unit = ctx.unit_name ? ` for ${escapeHtml(ctx.unit_name)}` : ''
  return `${escapeHtml(ctx.alert_label || 'ASPIRE update')}${unit}`
}

function body(ctx) {
  const greeting = escapeHtml(getGreetingName({ full_name: ctx.recipient?.name }))
  const label = escapeHtml(ctx.alert_label || 'ASPIRE update')
  const unit = escapeHtml(ctx.unit_name || '')
  const summary = escapeHtml(ctx.summary || '')
  const cta = escapeHtml(appUrl(ctx.cta_path || '/portal/unit/home'))

  return `
    <p style="margin:0 0 16px;">Hello ${greeting},</p>

    <p style="margin:0 0 16px;">
      There is an update for your ASPIRE unit${unit ? ` <strong>${unit}</strong>` : ''}.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:${SAND};border-radius:8px;margin:0 0 20px;">
      <tr>
        <td style="padding:16px 18px;">
          <p style="margin:0 0 6px;font-weight:700;color:${NAVY};">${label}</p>
          ${summary ? `<p style="margin:0;color:#191919;">${summary}</p>` : ''}
        </td>
      </tr>
    </table>

    <p style="margin:0 0 20px;">
      <a href="${cta}"
         style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;
                padding:11px 20px;border-radius:6px;font-weight:600;">
        Open the Unit Leader Portal
      </a>
    </p>

    <p style="margin:0 0 16px;color:#5b6472;font-size:14px;">
      Details stay in the portal, so this email does not include student information.
    </p>

    <p style="margin:0 0 8px;color:#5b6472;font-size:13px;">
      To stop receiving this kind of email, open the Unit Leader Portal, go to
      Profile, and turn off ${label} under Notification preferences. Every alert
      still appears in the portal.
    </p>

    ${aspireHandwrittenSignature()}
  `
}

export const unitLeaderAlert = {
  // One audience. The Unit Leader is resolved by scope, never by a name list.
  unit_leader: (ctx) => ({
    subject: `ASPIRE: ${ctx.alert_label || 'update'}${ctx.unit_name ? ` for ${ctx.unit_name}` : ''}`,
    html: aspireEmailShell({ body: body(ctx), preheader: preheaderFor(ctx) }),
  }),
  // Fallback keeps the sender from failing if an audience is ever added upstream
  // before this template knows about it.
  default: (ctx) => ({
    subject: `ASPIRE: ${ctx.alert_label || 'update'}`,
    html: aspireEmailShell({ body: body(ctx), preheader: preheaderFor(ctx) }),
  }),
}
