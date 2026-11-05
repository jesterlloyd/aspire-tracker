// src/lib/studio/renderEmail.js
//
// STUDIO-1 (2026-11-05): the ONE renderer from a Studio design (blocks JSON) to email HTML. The
// canvas, the preview and the send all call it, so what the Owner styles is what the inbox draws.
// Pure: no DOM, no I/O.
//
// Email-safe by construction: one 600px column of role="presentation" tables, every style inline,
// bgcolor attributes beside background styles (Outlook reads the attribute), web-safe font stacks,
// and one small @media block that stacks two-column rows on a phone. Every word is escaped here;
// links pass through safeUrl/safeImageUrl in sanitizeDesign and are escaped again for the attribute.
//
// Merge fields stay as the Outreach tokens ([First Name], [School]); the send path fills them with
// escaped values per recipient (applyMergeFields), exactly as an Outreach html body is filled.
//
// Catalog form buttons: with formMode 'marker' the button is emitted as the Outreach form-button
// marker (data-aspire-block="button" data-form=...), so lib/server/forms/outreachButtons.js gives
// each recipient their own link, and finishFormButtons() then draws the styled button around it.

import { sanitizeDesign, themeFor, resolveColor, FONT_STACKS, safeUrl } from './studioBlocks.js'

export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
const unesc = (v) => String(v).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const MERGE_TOKENS = [
  ['[First Name]', 'First name'],
  ['[School]', 'School'],
]

const SIDE = 40   // side padding of the column, px (20 on a phone)

/**
 * Inline markup, escaped first: **bold**, *italic*, [label](https://...). Line breaks become <br>.
 * With mergePreview, merge tokens are drawn as chips so the canvas shows what will be filled.
 */
export function inlineMarkup(text, { link = '#1D2567', mergePreview = false } = {}) {
  let out = esc(text)
  out = out.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g, (m, label, url) => {
    const safe = safeUrl(unesc(url))
    return safe ? `<a href="${esc(safe)}" style="color:${link};text-decoration:underline;">${label}</a>` : label
  })
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  if (mergePreview) {
    for (const [token, label] of MERGE_TOKENS) {
      out = out.split(esc(token)).join(`<span style="background:#FFF3C4;color:#5C4300;border-radius:4px;padding:0 4px;font-weight:600;">${label}</span>`)
    }
  }
  return out
}

/** Paragraphs (blank line) of inline markup, each a <p> with the given style. */
function paragraphs(text, pStyle, opts, key) {
  const html = String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="${pStyle}">${inlineMarkup(p, opts).replace(/\n/g, '<br>')}</p>`).join('')
  // On the canvas only, the paragraphs are wrapped so a double-click edits the whole field.
  return key && opts?.editable ? `<div data-st-edit="${key}">${html}</div>` : html
}

/**
 * STUDIO-INLINE-1: marks an element as a field the canvas may edit in place. Only the canvas
 * passes editable, so a send, a test, a thumbnail and Preview as sent are byte-for-byte unchanged.
 */
const ed = (opts, key) => (opts?.editable ? ` data-st-edit="${key}"` : '')

const row = (inner, { bg, pad = `0 ${SIDE}px`, cls = 'st-pad' } = {}) =>
  `<tr><td class="${cls}"${bg ? ` bgcolor="${bg}"` : ''} style="padding:${pad};${bg ? `background:${bg};` : ''}">${inner}</td></tr>`

const fontOf = (choice, t, which = 'headingFont') => FONT_STACKS[choice === 'serif' || choice === 'sans' ? choice : t[which]] || FONT_STACKS.sans

function buttonHtml({ label, href, bg, ink, align, shape, width, font, edit = '' }) {
  const radius = shape === 'pill' ? 999 : shape === 'square' ? 0 : 8
  const full = width === 'full'
  const a = `<a href="${esc(href)}" style="display:${full ? 'block' : 'inline-block'};background:${bg};color:${ink};font-family:${font};font-size:15px;font-weight:700;line-height:20px;text-decoration:none;padding:14px 30px;border-radius:${radius}px;text-align:center;"${edit}>${esc(label)}</a>`
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${full ? 'width="100%"' : ''} align="${align === 'left' ? 'left' : 'center'}" style="margin:${align === 'left' ? '0' : '0 auto'};"><tr><td bgcolor="${bg}" style="border-radius:${radius}px;background:${bg};">${a}</td></tr></table>`
}

function signatureHtml(sig, signOff, t, opts) {
  const s = sig || {}
  const name = esc(s.displayName || '')
  const creds = s.credentials ? `, ${esc(s.credentials)}` : ''
  const titles = String(s.title || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 2)
    .map(x => `<span style="display:block;">${esc(x)}</span>`).join('')
  const aff = esc(String(s.affiliation || '').trim() || 'Geri & Richard Brawerman Nursing Institute')
  const email = s.email ? `<span style="display:block;"><a href="mailto:${esc(s.email)}" style="color:${t.link};text-decoration:none;">${esc(s.email)}</a>${s.phone ? ` | ${esc(s.phone)}` : ''}</span>` : ''
  const body = name
    ? `<strong style="color:${t.heading};">${name}${creds}</strong>${titles}<span style="display:block;">${aff}</span>${email}`
    : `<span style="color:${t.muted};">${opts.signaturePlaceholder || 'Your Connect signature appears here.'}</span>`
  return `<p style="margin:0 0 6px;"${ed(opts, 'signOff')}>${esc(signOff || '')}</p><p style="margin:0;line-height:1.6;">${body}</p>`
}

/** One block's rows. Exported for the canvas, which wraps each block so it can be selected. */
export function renderBlockRows(block, themeId, opts = {}) {
  const t = themeFor(themeId)
  const p = block.props || {}
  const s = block.style || {}
  const body = fontOf('theme', t, 'bodyFont')
  const mo = { link: t.link, mergePreview: opts.mergePreview, editable: opts.editable }
  switch (block.type) {
    case 'header': {
      const bg = resolveColor(s.bg, t.surface)
      const logo = p.showLogo && opts.brand?.logoUrl
        ? `<img src="${esc(opts.brand.logoUrl)}" alt="${esc(opts.brand.title || p.title)}" height="36" style="display:block;height:36px;width:auto;border:0;">`
        : `<span style="font-family:${body};font-size:13px;font-weight:700;letter-spacing:2px;color:${t.heading};"${ed(opts, 'title')}>${esc(p.title)}</span>`
      const tag = p.tagline ? `<span style="font-family:${body};font-size:11px;color:${t.muted};"${ed(opts, 'tagline')}>${esc(p.tagline)}</span>` : ''
      const inner = s.align === 'split'
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left" valign="middle">${logo}</td><td align="right" valign="middle">${tag}</td></tr></table>`
        : `<div style="text-align:${s.align};">${logo}${tag ? `<div style="margin-top:4px;">${tag}</div>` : ''}</div>`
      return row(inner, { bg, pad: `18px ${SIDE}px` }) + `<tr><td style="height:1px;line-height:1px;font-size:0;background:${t.page};">&nbsp;</td></tr>`
    }
    case 'hero': {
      const bg = resolveColor(s.bg, t.heroBg)
      const ink = resolveColor(s.ink, t.heroInk)
      const usesThemeInk = !s.ink || s.ink === 'theme'
      const rule = s.rule === 'theme' || !s.rule ? t.rule : s.rule
      const pad = { s: 22, m: 30, l: 40 }[s.pad] || 40
      const font = fontOf(s.font, t)
      const photo = p.imageUrl
        ? `<tr><td style="padding:0;"><img src="${esc(p.imageUrl)}" alt="${esc(p.imageAlt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`
        : ''
      const inner =
        (p.eyebrow ? `<p style="margin:0 0 10px;font-family:${body};font-size:11px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;color:${usesThemeInk ? t.heroEyebrow : ink};"${ed(opts, 'eyebrow')}>${esc(p.eyebrow)}</p>` : '') +
        `<h1 class="st-h1" style="margin:0 0 12px;font-family:${font};font-size:34px;line-height:1.15;font-weight:700;color:${ink};"${ed(opts, 'headline')}>${inlineMarkup(p.headline, mo)}</h1>` +
        (p.subhead ? `<p style="margin:0;font-family:${body};font-size:16px;line-height:1.55;color:${usesThemeInk ? t.heroMuted : ink};"${ed(opts, 'subhead')}>${inlineMarkup(p.subhead, mo)}</p>` : '')
      return photo + `<tr><td class="st-pad" bgcolor="${bg}" align="${s.align}" style="padding:${pad}px ${SIDE}px;background:${bg};text-align:${s.align};${rule ? `border-bottom:4px solid ${rule};` : ''}">${inner}</td></tr>`
    }
    case 'heading': {
      const size = { s: 18, m: 22, l: 28 }[s.size] || 22
      const ink = resolveColor(s.ink, t.heading)
      return row(`<h2 style="margin:0;font-family:${fontOf(s.font, t)};font-size:${size}px;line-height:1.25;font-weight:700;color:${ink};text-align:${s.align};"${ed(opts, 'text')}>${inlineMarkup(p.text, mo)}</h2>`, { pad: `26px ${SIDE}px 6px` })
    }
    case 'text': {
      const size = { s: 14, m: 16, l: 18 }[s.size] || 16
      const bg = s.bg && s.bg !== 'theme' ? s.bg : null
      const ink = resolveColor(s.ink, t.ink)
      const pStyle = `margin:0 0 14px;font-family:${body};font-size:${size}px;line-height:1.65;color:${ink};text-align:${s.align};`
      return row(paragraphs(p.text, pStyle, mo, 'text'), { bg, pad: `${bg ? 22 : 18}px ${SIDE}px ${bg ? 8 : 4}px` })
    }
    case 'image': {
      if (!p.url) return row(`<div style="border:2px dashed ${t.rule};padding:40px 0;text-align:center;font-family:${body};font-size:13px;color:${t.muted};">Add an image</div>`, { pad: `16px ${SIDE}px` })
      const inset = s.width === 'inset'
      const radius = s.radius === 'soft' ? 10 : 0
      const img = `<img src="${esc(p.url)}" alt="${esc(p.alt)}" width="${inset ? 520 : 600}" style="display:block;width:100%;max-width:${inset ? 520 : 600}px;height:auto;border:0;border-radius:${radius}px;">`
      const linked = p.link ? `<a href="${esc(p.link)}" style="text-decoration:none;">${img}</a>` : img
      const cap = p.caption ? `<p style="margin:8px 0 0;font-family:${body};font-size:13px;line-height:1.5;color:${t.muted};"${ed(opts, 'caption')}>${inlineMarkup(p.caption, mo)}</p>` : ''
      return inset ? row(linked + cap, { pad: `16px ${SIDE}px` }) : `<tr><td style="padding:16px 0;">${linked}${cap ? `<div class="st-pad" style="padding:0 ${SIDE}px;">${cap}</div>` : ''}</td></tr>`
    }
    case 'columns': {
      const bg = s.bg && s.bg !== 'theme' ? s.bg : null
      const ink = resolveColor(s.ink, t.ink)
      const col = (c, side) => (c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="${esc(c.imageAlt)}" width="250" style="display:block;width:100%;max-width:250px;height:auto;border:0;border-radius:8px;margin:0 0 12px;">` : '') +
        (c.title ? `<p style="margin:0 0 6px;font-family:${fontOf('theme', t)};font-size:18px;font-weight:700;line-height:1.3;color:${t.heading};"${ed(opts, `${side}.title`)}>${esc(c.title)}</p>` : '') +
        paragraphs(c.text, `margin:0 0 10px;font-family:${body};font-size:14px;line-height:1.6;color:${ink};`, mo, `${side}.text`)
      const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td class="st-col" width="50%" valign="top" style="width:50%;padding-right:12px;">${col(p.left || {}, 'left')}</td>` +
        `<td class="st-col" width="50%" valign="top" style="width:50%;padding-left:12px;">${col(p.right || {}, 'right')}</td></tr></table>`
      return row(inner, { bg, pad: `18px ${SIDE}px 8px` })
    }
    case 'steps': {
      const bg = resolveColor(s.bg, t.panel)
      const accent = resolveColor(s.accent, t.heading)
      const items = (p.items || []).map((i, at) => ({ ...i, at })).filter(i => i.title || i.text)
      if (!items.length) return ''
      const w = Math.floor(100 / items.length)
      const cells = items.map((i, n) => `<td class="st-col" width="${w}%" valign="top" style="width:${w}%;padding:0 ${n === items.length - 1 ? 0 : 5}px 10px ${n === 0 ? 0 : 5}px;">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${bg}" style="background:${bg};border-radius:10px;padding:14px;">` +
        `<p style="margin:0;font-family:${fontOf('theme', t)};font-size:22px;font-weight:700;color:${accent};">${n + 1}</p>` +
        (i.title ? `<p style="margin:4px 0 3px;font-family:${body};font-size:14px;font-weight:700;color:${t.panelInk};"${ed(opts, `items.${i.at}.title`)}>${esc(i.title)}</p>` : '') +
        (i.text ? `<p style="margin:0;font-family:${body};font-size:13px;line-height:1.45;color:${t.panelInk};"${ed(opts, `items.${i.at}.text`)}>${inlineMarkup(i.text, mo)}</p>` : '') +
        `</td></tr></table></td>`).join('')
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`, { pad: `16px ${SIDE}px 10px` })
    }
    case 'quote': {
      const accent = resolveColor(s.accent, t.rule)
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:4px solid ${accent};padding:4px 0 4px 18px;">` +
        `<p style="margin:0 0 8px;font-family:${fontOf(s.font, t)};font-size:19px;line-height:1.5;font-style:italic;color:${t.heading};"${ed(opts, 'text')}>${inlineMarkup(p.text, mo)}</p>` +
        (p.cite ? `<p style="margin:0;font-family:${body};font-size:13px;color:${t.muted};"${ed(opts, 'cite')}>${esc(p.cite)}</p>` : '') +
        `</td></tr></table>`, { pad: `18px ${SIDE}px` })
    }
    case 'button': {
      const href = p.url || '#'
      return row(buttonHtml({ label: p.label, href, bg: resolveColor(s.bg, t.button), ink: resolveColor(s.ink, t.buttonInk), align: s.align, shape: s.shape, width: s.width, font: body, edit: ed(opts, 'label') }), { pad: `14px ${SIDE}px 22px` })
    }
    case 'form': {
      const look = { label: p.label || 'Open the form', bg: resolveColor(s.bg, t.button), ink: resolveColor(s.ink, t.buttonInk), align: s.align, shape: s.shape, width: s.width, font: body }
      if (opts.formMode === 'marker' && p.formId) {
        return row(`<div data-aspire-block="button" data-studio-block="${esc(block.id)}" data-label="${esc(look.label)}" data-url="" data-form="${esc(p.formId)}"${p.dueAt ? ` data-due="${esc(p.dueAt)}"` : ''}${p.reminders ? ` data-reminders="${esc(p.reminders)}"` : ''}></div>`, { pad: `14px ${SIDE}px 22px` })
      }
      const href = (typeof opts.formUrl === 'function' ? opts.formUrl(block) : null) || '#'
      return row(buttonHtml({ ...look, href, edit: ed(opts, 'label') }), { pad: `14px ${SIDE}px 22px` })
    }
    case 'event': {
      const accent = resolveColor(s.accent, t.accent)
      const d = p.date ? new Date(`${p.date}T12:00:00Z`) : null
      const mon = d ? d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase() : 'DATE'
      const day = d ? String(d.getUTCDate()) : '--'
      const dow = d ? d.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' }) : ''
      const when = [dow, p.time].filter(Boolean).join(', ')
      const info = `<p style="margin:0 0 3px;font-family:${body};font-size:15px;font-weight:700;color:${t.ink};"${ed(opts, 'title')}>${esc(p.title)}</p>` +
        (when ? `<p style="margin:0;font-family:${body};font-size:13px;line-height:1.5;color:${t.ink};">${esc(when)}</p>` : '') +
        (p.location ? `<p style="margin:0;font-family:${body};font-size:13px;line-height:1.5;color:${t.muted};"${ed(opts, 'location')}>${esc(p.location)}</p>` : '') +
        (p.details ? `<p style="margin:6px 0 0;font-family:${body};font-size:13px;line-height:1.5;color:${t.ink};"${ed(opts, 'details')}>${inlineMarkup(p.details, mo)}</p>` : '')
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${t.rule};border-radius:10px;border-collapse:separate;"><tr>` +
        `<td width="78" bgcolor="${accent}" align="center" valign="middle" style="width:78px;background:${accent};border-radius:9px 0 0 9px;padding:12px 0;">` +
        `<p style="margin:0;font-family:${body};font-size:11px;letter-spacing:2px;font-weight:700;color:${t.accentInk};">${mon}</p>` +
        `<p style="margin:0;font-family:${fontOf('theme', t)};font-size:28px;font-weight:700;line-height:1.1;color:${t.accentInk};">${day}</p></td>` +
        `<td valign="middle" style="padding:12px 16px;">${info}</td></tr></table>`, { pad: `12px ${SIDE}px 18px` })
    }
    case 'divider': {
      const color = resolveColor(s.color, t.rule)
      const width = s.width === 'short' ? '80' : '100%'
      return row(`<table role="presentation" ${s.width === 'short' ? 'width="80" align="center"' : 'width="100%"'} cellpadding="0" cellspacing="0" border="0"><tr><td style="height:2px;line-height:2px;font-size:0;background:${color};width:${width === '80' ? '80px' : '100%'};">&nbsp;</td></tr></table>`, { pad: `16px ${SIDE}px` })
    }
    case 'spacer': {
      const h = { s: 12, m: 24, l: 44 }[s.size] || 24
      return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`
    }
    case 'signature':
      return row(`<div style="font-family:${body};font-size:14px;color:${t.ink};">${signatureHtml(opts.signature, p.signOff, t, opts)}</div>`, { pad: `14px ${SIDE}px 26px` })
    case 'footer':
      return row(paragraphs(p.text, `margin:0 0 8px;font-family:${body};font-size:12px;line-height:1.6;color:${t.muted};text-align:${s.align};`, mo, 'text'), { bg: t.panel, pad: `20px ${SIDE}px 14px` })
    default:
      return ''
  }
}

/** The block as plain text, for the email's text part. */
function blockText(b, opts) {
  const p = b.props || {}
  const strip = (v) => String(v || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  switch (b.type) {
    case 'header': return p.title
    case 'hero': return [p.eyebrow, strip(p.headline).toUpperCase(), strip(p.subhead)].filter(Boolean).join('\n')
    case 'heading': return strip(p.text).toUpperCase()
    case 'text': case 'footer': return strip(p.text)
    case 'image': return p.alt ? `[${p.alt}]` : ''
    case 'columns': return [p.left, p.right].map(c => [c?.title, strip(c?.text)].filter(Boolean).join('\n')).join('\n\n')
    case 'steps': return (p.items || []).map((i, n) => `${n + 1}. ${i.title}${i.text ? `: ${strip(i.text)}` : ''}`).join('\n')
    case 'quote': return `"${strip(p.text)}"${p.cite ? `\n${p.cite}` : ''}`
    case 'button': return `${p.label}: ${p.url}`
    case 'form': return `${p.label}: ${(typeof opts.formUrl === 'function' && opts.formUrl(b)) || '(personal link in the HTML version)'}`
    case 'event': return [p.title, [p.date, p.time].filter(Boolean).join(', '), p.location, strip(p.details)].filter(Boolean).join('\n')
    case 'divider': return '---'
    case 'signature': {
      const s = opts.signature || {}
      return [p.signOff, [s.displayName, s.credentials].filter(Boolean).join(', '), s.title, s.email].filter(Boolean).join('\n')
    }
    default: return ''
  }
}

const PHONE_CSS = '@media only screen and (max-width:620px){.st-wrap{width:100%!important}.st-pad{padding-left:20px!important;padding-right:20px!important}.st-col{display:block!important;width:100%!important;padding-left:0!important;padding-right:0!important}.st-h1{font-size:26px!important}}'

/**
 * The whole email. opts: { brand: { logoUrl, title }, signature, mergePreview, formMode, formUrl }.
 * Returns { html, text }. The input passes sanitizeDesign first, so a stored design that predates a
 * rule is rendered by today's rules.
 */
export function renderStudioEmail(input, opts = {}) {
  const d = sanitizeDesign(input)
  const t = themeFor(d.theme)
  const rows = d.blocks.map(b => renderBlockRows(b, d.theme, opts)).join('')
  const pre = d.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${t.page};opacity:0;">${esc(d.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>`
    : ''
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta name="x-apple-disable-message-reformatting"><title>${esc(d.subject)}</title><style>${PHONE_CSS}</style></head>` +
    `<body style="margin:0;padding:0;background:${t.page};">${pre}` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.page}" style="background:${t.page};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" class="st-wrap" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.surface}" style="width:600px;max-width:600px;background:${t.surface};">${rows}</table>` +
    '</td></tr></table></body></html>'
  const text = d.blocks.map(b => blockText(b, opts)).filter(Boolean).join('\n\n')
  return { html, text }
}

/**
 * After the form engine has put each recipient's own link in the markers' data-url, draw the
 * styled button around each one. A marker with no link is dropped rather than sent broken.
 */
export function finishFormButtons(html, input) {
  const d = sanitizeDesign(input)
  const t = themeFor(d.theme)
  const byId = new Map(d.blocks.filter(b => b.type === 'form').map(b => [b.id, b]))
  return String(html || '').replace(/<div\b[^>]*\bdata-aspire-block=(["'])button\1[^>]*>\s*<\/div>/gi, (tag) => {
    const id = /\sdata-studio-block=(["'])(.*?)\1/i.exec(tag)?.[2]
    const url = /\sdata-url=(["'])(.*?)\1/i.exec(tag)?.[2] || ''
    const b = id ? byId.get(unesc(id)) : null
    if (!b || !/^https:\/\//i.test(unesc(url))) return ''
    const s = b.style
    return buttonHtml({
      label: b.props.label || 'Open the form', href: unesc(url),
      bg: resolveColor(s.bg, t.button), ink: resolveColor(s.ink, t.buttonInk),
      align: s.align, shape: s.shape, width: s.width, font: FONT_STACKS[t.bodyFont],
    })
  })
}

/** The Catalog forms a design's form blocks point at, for the send path's checks. */
export function designFormIds(input) {
  return [...new Set(sanitizeDesign(input).blocks.filter(b => b.type === 'form' && b.props.formId).map(b => b.props.formId))]
}
