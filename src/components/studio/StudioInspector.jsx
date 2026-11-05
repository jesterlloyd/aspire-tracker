// src/components/studio/StudioInspector.jsx
//
// STUDIO-1: the selected block's Content (its words and links) and Style (its look). Every value
// the panel offers is one the catalog in src/lib/studio/studioBlocks.js accepts, and the
// Readability line measures what the block will actually paint.

import { useRef, useState } from 'react'
import { BLOCKS, SWATCHES, blockColorPairs, contrastRatio, safeUrl, safeImageUrl } from '../../lib/studio/studioBlocks'
import { uploadStudioImage } from '../../lib/studio/studioClient'
import { useCatalogForms } from '../connect/blocks/useCatalogForms'
import { REMINDER_RULES } from '../../lib/forms/formModel'

const STYLE_LABELS = {
  bg: 'Background', ink: 'Text colour', rule: 'Accent rule', accent: 'Accent', color: 'Colour',
  align: 'Alignment', font: 'Typeface', pad: 'Padding', size: 'Size', width: 'Width', radius: 'Corners', shape: 'Shape',
}
const VALUE_LABELS = {
  left: 'Left', center: 'Center', split: 'Split', theme: 'Theme', serif: 'Serif', sans: 'Sans',
  s: 'Small', m: 'Medium', l: 'Large', full: 'Full', inset: 'Inset', short: 'Short', none: 'Square', soft: 'Soft',
  rounded: 'Rounded', pill: 'Pill', square: 'Square', auto: 'Fit',
}

export default function StudioInspector({ block, themeId, onChange, onSaveBlock, imagesEnabled, toast }) {
  const [tab, setTab] = useState('content')
  if (!block) {
    return (
      <div style={{ paddingTop: 16 }}>
        <h3 className="st-h">Nothing Selected</h3>
        <p className="st-sub">Click a block in the email to change its words and look. Drag blocks to reorder them, or use the arrows on a selected block.</p>
        <p className="st-sub" style={{ marginTop: 10 }}>Keyboard: Delete removes the selected block, Cmd or Ctrl + Z undoes.</p>
      </div>
    )
  }
  const def = BLOCKS[block.type]
  const hasStyle = Object.keys(def.styleRules).length > 0
  return (
    <>
      <div className="st-ptabs" role="tablist" aria-label={`${def.label} settings`}>
        <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>Content</button>
        {hasStyle && <button type="button" role="tab" aria-selected={tab === 'style'} onClick={() => setTab('style')}>Style</button>}
      </div>
      {tab === 'content' || !hasStyle
        ? <ContentPanel key={block.id} block={block} onChange={onChange} imagesEnabled={imagesEnabled} toast={toast} />
        : <StylePanel block={block} themeId={themeId} onChange={onChange} />}
      <SaveBlock key={`save-${block.id}`} label={def.label} onSave={onSaveBlock} />
    </>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="st-field">
      <label className="st-label">{label}{children}</label>
      {hint && <div className="st-hint">{hint}</div>}
    </div>
  )
}

function Text({ value, onChange, placeholder, max }) {
  return <input className="st-input" style={{ marginTop: 6, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }} value={value || ''} maxLength={max} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
}

function LinkField({ label, value, onChange, hint, image = false }) {
  const [draft, setDraft] = useState(value || '')
  const ok = !draft.trim() || (image ? safeImageUrl(draft) : safeUrl(draft))
  return (
    <Field label={label} hint={!ok ? (image ? 'Use an https:// image address.' : 'Use an https:// address or an email address.') : hint}>
      <input className="st-input" style={{ marginTop: 6, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }} value={draft}
        placeholder={image ? 'https://…' : 'https://… or name@cshs.org'} aria-invalid={!ok}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { const v = image ? safeImageUrl(draft) : safeUrl(draft); onChange(v); if (v) setDraft(v) }} />
    </Field>
  )
}

/** A textarea with the light markup the renderer reads, and an Insert first name chip. */
function RichText({ value, onChange, rows = 7 }) {
  const ref = useRef(null)
  const wrap = (before, after = before, fallback = 'text') => {
    const el = ref.current
    if (!el) return
    const v = el.value
    const [a, b] = [el.selectionStart, el.selectionEnd]
    const inner = v.slice(a, b) || fallback
    const next = v.slice(0, a) + before + inner + after + v.slice(b)
    onChange(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + before.length, a + before.length + inner.length) })
  }
  const insert = (text) => {
    const el = ref.current
    const v = el?.value || ''
    const a = el ? el.selectionStart : v.length
    onChange(v.slice(0, a) + text + v.slice(a))
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(a + text.length, a + text.length) } })
  }
  return (
    <>
      <div className="st-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="st-btn st-btn-sm" onClick={() => wrap('**')} aria-label="Bold"><b>B</b></button>
        <button type="button" className="st-btn st-btn-sm" onClick={() => wrap('*')} aria-label="Italic"><i>I</i></button>
        <button type="button" className="st-btn st-btn-sm" onClick={() => {
          const url = window.prompt('Link address (https:// or an email address)')
          const safe = safeUrl(url)
          if (safe) wrap('[', `](${safe})`, 'link text')
        }}>Link</button>
        <button type="button" className="st-btn st-btn-sm" onClick={() => insert('[First Name]')}>+ First name</button>
        <button type="button" className="st-btn st-btn-sm" onClick={() => insert('[School]')}>+ School</button>
      </div>
      <textarea ref={ref} className="st-textarea" rows={rows} value={value || ''} onChange={e => onChange(e.target.value)} />
      <div className="st-hint">A blank line starts a new paragraph. **bold**, *italic*, [words](https://link).</div>
    </>
  )
}

function ImageInput({ value, alt, onUrl, onAlt, imagesEnabled, toast, altLabel = 'Alt text' }) {
  const [busy, setBusy] = useState(false)
  const pick = useRef(null)
  return (
    <>
      <LinkField key={value} label="Image address" value={value} image onChange={onUrl} />
      {imagesEnabled && (
        <div className="st-field">
          <input ref={pick} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            if (f.size > 5 * 1024 * 1024) { toast?.error?.('Too large', 'Images must be 5 MB or smaller.'); return }
            setBusy(true)
            try { onUrl(await uploadStudioImage(f)) } catch (err) { toast?.error?.('Not uploaded', err.message) } finally { setBusy(false) }
          }} />
          <button type="button" className="st-btn st-btn-sm" onClick={() => pick.current?.click()} disabled={busy}>{busy ? 'Uploading…' : 'Upload an image'}</button>
          <div className="st-hint">Uploaded images are public so every inbox can show them. Do not upload anything private.</div>
        </div>
      )}
      <Field label={altLabel} hint="Describe the image for screen readers and for inboxes that block pictures.">
        <Text value={alt} onChange={onAlt} max={240} />
      </Field>
    </>
  )
}

function ContentPanel({ block, onChange, imagesEnabled, toast }) {
  const p = block.props
  const set = (patch) => onChange({ props: patch })
  const forms = useCatalogForms(block.type === 'form')
  switch (block.type) {
    case 'header':
      return (<>
        <Field label="Wordmark"><Text value={p.title} onChange={v => set({ title: v })} max={160} /></Field>
        <Field label="Tagline"><Text value={p.tagline} onChange={v => set({ tagline: v })} max={160} /></Field>
        <label className="st-row" style={{ fontSize: 13, marginBottom: 14 }}>
          <input type="checkbox" checked={p.showLogo} onChange={e => set({ showLogo: e.target.checked })} />
          Show the organization's logo instead of the wordmark
        </label>
      </>)
    case 'hero':
      return (<>
        <Field label="Small line above"><Text value={p.eyebrow} onChange={v => set({ eyebrow: v })} max={160} /></Field>
        <Field label="Headline"><Text value={p.headline} onChange={v => set({ headline: v })} max={240} /></Field>
        <Field label="Supporting line"><Text value={p.subhead} onChange={v => set({ subhead: v })} max={600} /></Field>
        <ImageInput value={p.imageUrl} alt={p.imageAlt} onUrl={v => set({ imageUrl: v })} onAlt={v => set({ imageAlt: v })} imagesEnabled={imagesEnabled} toast={toast} altLabel="Photo alt text" />
        <div className="st-hint">A photo sits above the coloured band, so the headline always stays readable.</div>
      </>)
    case 'heading':
      return <Field label="Heading"><Text value={p.text} onChange={v => set({ text: v })} max={160} /></Field>
    case 'text':
      return <div className="st-field"><span className="st-label">Text</span><RichText value={p.text} onChange={v => set({ text: v })} rows={10} /></div>
    case 'image':
      return (<>
        <ImageInput value={p.url} alt={p.alt} onUrl={v => set({ url: v })} onAlt={v => set({ alt: v })} imagesEnabled={imagesEnabled} toast={toast} />
        <LinkField label="Opens when clicked (optional)" value={p.link} onChange={v => set({ link: v })} />
        <Field label="Caption (optional)"><Text value={p.caption} onChange={v => set({ caption: v })} max={300} /></Field>
      </>)
    case 'columns':
      return (<>
        {['left', 'right'].map(side => (
          <fieldset key={side} style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
            <legend className="st-label">{side === 'left' ? 'Left column' : 'Right column'}</legend>
            <Field label="Title"><Text value={p[side].title} onChange={v => set({ [side]: { ...p[side], title: v } })} max={160} /></Field>
            <div className="st-field"><span className="st-label">Text</span><RichText value={p[side].text} rows={4} onChange={v => set({ [side]: { ...p[side], text: v } })} /></div>
            <ImageInput value={p[side].imageUrl} alt={p[side].imageAlt} onUrl={v => set({ [side]: { ...p[side], imageUrl: v } })} onAlt={v => set({ [side]: { ...p[side], imageAlt: v } })} imagesEnabled={imagesEnabled} toast={toast} />
          </fieldset>
        ))}
      </>)
    case 'steps':
      return (<>
        {p.items.map((it, i) => (
          <fieldset key={i} style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
            <legend className="st-label">Step {i + 1}</legend>
            <Text value={it.title} onChange={v => set({ items: p.items.map((x, j) => j === i ? { ...x, title: v } : x) })} max={160} placeholder="Title" />
            <Text value={it.text} onChange={v => set({ items: p.items.map((x, j) => j === i ? { ...x, text: v } : x) })} max={600} placeholder="One line" />
            {p.items.length > 2 && <button type="button" className="st-btn st-btn-sm st-btn-ghost st-btn-danger" onClick={() => set({ items: p.items.filter((_, j) => j !== i) })}>Remove step</button>}
          </fieldset>
        ))}
        {p.items.length < 4 && <button type="button" className="st-btn st-btn-sm" onClick={() => set({ items: [...p.items, { title: 'Another step', text: '' }] })}>+ Add a step</button>}
      </>)
    case 'quote':
      return (<>
        <div className="st-field"><span className="st-label">Quote</span><RichText value={p.text} rows={4} onChange={v => set({ text: v })} /></div>
        <Field label="Who said it"><Text value={p.cite} onChange={v => set({ cite: v })} max={160} /></Field>
      </>)
    case 'button':
      return (<>
        <Field label="Label"><Text value={p.label} onChange={v => set({ label: v })} max={80} /></Field>
        <LinkField key={block.id} label="Link" value={p.url} onChange={v => set({ url: v })}
          hint={p.url ? '' : 'Required. Studio never fills in a link for you, so the send waits until this is set.'} />
      </>)
    case 'form':
      return (<>
        <Field label="Catalog form" hint="Each person gets their own link, and their answers are filed in the Catalog. A form must be published to be sent.">
          <select className="st-select" style={{ marginTop: 6 }} value={p.formId} onChange={e => {
            const f = (forms || []).find(x => x.id === e.target.value)
            set({ formId: e.target.value, formTitle: f?.title || '' })
          }}>
            <option value="">{forms === null ? 'Loading forms…' : 'Choose a form'}</option>
            {(forms || []).map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
          </select>
        </Field>
        <Field label="Button label"><Text value={p.label} onChange={v => set({ label: v })} max={80} /></Field>
        <Field label="Due date (optional)">
          <input type="date" className="st-input" style={{ marginTop: 6 }} value={p.dueAt} onChange={e => set({ dueAt: e.target.value })} />
        </Field>
        <Field label="Reminders">
          <select className="st-select" style={{ marginTop: 6 }} value={p.reminders} onChange={e => set({ reminders: e.target.value })}>
            <option value="">The form's own setting</option>
            {REMINDER_RULES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </Field>
      </>)
    case 'event':
      return (<>
        <Field label="Title"><Text value={p.title} onChange={v => set({ title: v })} max={160} /></Field>
        <Field label="Date"><input type="date" className="st-input" style={{ marginTop: 6 }} value={p.date} onChange={e => set({ date: e.target.value })} /></Field>
        <Field label="Time"><Text value={p.time} onChange={v => set({ time: v })} max={80} placeholder="5:30 to 6:30 PM" /></Field>
        <Field label="Where"><Text value={p.location} onChange={v => set({ location: v })} max={240} placeholder="Room, building or Virtual" /></Field>
        <div className="st-field"><span className="st-label">Details (optional)</span><RichText value={p.details} rows={3} onChange={v => set({ details: v })} /></div>
      </>)
    case 'signature':
      return (<>
        <Field label="Sign-off"><Text value={p.signOff} onChange={v => set({ signOff: v })} max={80} /></Field>
        <p className="st-hint">Your name, title and contact line come from your Connect signature in Settings &gt; General &gt; Profile.</p>
      </>)
    case 'footer':
      return <div className="st-field"><span className="st-label">Footer text</span><RichText value={p.text} rows={4} onChange={v => set({ text: v })} /></div>
    default:
      return <p className="st-sub">This block has nothing to write.</p>
  }
}

function StylePanel({ block, themeId, onChange }) {
  const def = BLOCKS[block.type]
  const s = block.style
  const pairs = blockColorPairs(block, themeId)
  return (
    <>
      {Object.entries(def.styleRules).map(([key, rule]) => (
        <div className="st-field" key={key}>
          <span className="st-label">{STYLE_LABELS[key] || key}</span>
          {rule === 'color'
            ? (
              <div className="st-swatches" role="group" aria-label={STYLE_LABELS[key] || key}>
                <button type="button" className="st-swatch st-swatch-theme" aria-pressed={s[key] === 'theme'} onClick={() => onChange({ style: { [key]: 'theme' } })} aria-label="Follow the theme">T</button>
                {SWATCHES.map(c => (
                  <button key={c} type="button" className="st-swatch" style={{ background: c }} aria-pressed={s[key] === c} aria-label={c} onClick={() => onChange({ style: { [key]: c } })} />
                ))}
              </div>
            )
            : (
              <div className="st-seg" role="group" aria-label={STYLE_LABELS[key] || key} style={{ display: 'flex', flexWrap: 'wrap' }}>
                {rule.map(v => (
                  <button key={v} type="button" aria-pressed={s[key] === v} onClick={() => onChange({ style: { [key]: v } })}>{VALUE_LABELS[v] || v}</button>
                ))}
              </div>
            )}
        </div>
      ))}
      {pairs.length > 0 && (
        <div className="st-field">
          <span className="st-label">Readability</span>
          {pairs.map(pr => {
            const r = contrastRatio(pr.ink, pr.bg)
            const ok = r >= 4.5
            return (
              <div key={pr.label} className="st-check">
                <i className={`st-dot ${ok ? 'st-dot-ok' : 'st-dot-bad'}`} aria-hidden="true">{ok ? '✓' : '!'}</i>
                <span>{pr.label}: {r}:1 {ok ? '' : '(below 4.5:1, hard to read)'}</span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function SaveBlock({ label, onSave }) {
  const [open, setOpen] = useState(false)
  const [nm, setNm] = useState('')
  if (!open) return <button type="button" className="st-btn st-btn-sm st-btn-ghost" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>Save this block for reuse</button>
  return (
    <form style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); if (nm.trim()) { onSave(nm.trim()); setOpen(false); setNm('') } }}>
      <span className="st-label">Name for this {label.toLowerCase()}</span>
      <div className="st-row">
        <input className="st-input" value={nm} onChange={e => setNm(e.target.value)} maxLength={80} autoFocus placeholder="NGRP key dates" />
        <button type="submit" className="st-btn st-btn-sm st-btn-primary" disabled={!nm.trim()}>Save</button>
      </div>
    </form>
  )
}
