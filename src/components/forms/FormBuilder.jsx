// src/components/forms/FormBuilder.jsx
//
// FORMS-PHASE3: /catalog/forms/:id/edit (brief section 5). Left: add a question. Centre:
// the form as respondents see it, one card per question, drag (or Move up / Move down) to
// reorder. Right: the selected question, or the form's settings. The draft saves itself;
// Publish changes freezes it as the next version, and only published versions are sent.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  QUESTION_TYPES, PREFILL_SOURCES, REMINDER_RULES, questionType, hasOptions, takesAnswer, newQuestion, moveQuestion,
  definitionIssues, prefillFits, prefillSource, DEFAULT_SETTINGS, starterUpdateFor,
} from '../../lib/forms/formModel'
import FormRenderer from './FormRenderer'
import { formStaff } from './formsApi'
import { supabase } from '../../lib/supabase'

const SAMPLE = {
  'student.full_name': 'Ava Reyes', 'student.preferred_name': 'Ava Reyes', 'student.first_name': 'Ava', 'student.last_name': 'Reyes', 'student.email': 'ava.reyes@example.edu', 'student.phone': '(310) 555-0101',
  'student.school': 'UCLA', 'placement.unit': '6 NE', 'placement.start_date': '2026-10-05', 'placement.end_date': '2026-12-11', 'placement.preceptor': 'Maria Lopez, RN',
}

export default function FormBuilder({ formId, notify, onBack, onResponses }) {
  const [form, setForm] = useState(null)
  const [draft, setDraft] = useState(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [sel, setSel] = useState(null)
  const [tab, setTab] = useState('question')
  const [save, setSave] = useState('saved')   // saved | saving | unsaved | error
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [paper, setPaper] = useState(null)        // PAPER-ORIGINAL-1: { layout, name, onFile } for a form with a paper layout
  const [catalogPdfs, setCatalogPdfs] = useState(null)
  const [paperBusy, setPaperBusy] = useState(false)
  const dirty = useRef(false)
  const drag = useRef(null)
  const [over, setOver] = useState(null)          // the card a dragged question would land on
  const [dragging, setDragging] = useState(null)  // the card being dragged

  useEffect(() => {
    let live = true
    formStaff('get', { id: formId }).then(r => {
      if (!live) return
      setForm(r.form); setDraft(r.form.draft); setSettings({ ...DEFAULT_SETTINGS, ...(r.form.settings || {}) }); setPaper(r.paper || null)
      setSel(r.form.draft.questions[0]?.id || null)
    }).catch(e => setError(e.message))
    return () => { live = false }
  }, [formId])

  // The draft saves itself a moment after the last change.
  useEffect(() => {
    if (!dirty.current || !draft) return undefined
    setSave('unsaved')
    const t = setTimeout(async () => {
      setSave('saving')
      try { const r = await formStaff('save', { id: formId, draft, settings }); setForm(r.form); dirty.current = false; setSave('saved') }
      catch (e) { setSave('error'); notify?.(e.message, 'err') }
    }, 800)
    return () => clearTimeout(t)
  }, [draft, settings, formId, notify])

  const change = useCallback((fn) => { dirty.current = true; setDraft(d => fn(d)) }, [])
  const changeSettings = (patch) => { dirty.current = true; setSettings(s => ({ ...s, ...patch })) }
  const setQ = (id, patch) => change(d => ({ ...d, questions: d.questions.map(q => q.id === id ? { ...q, ...patch } : q) }))
  const add = (type) => {
    const q = newQuestion(type)
    change(d => {
      const at = sel ? d.questions.findIndex(x => x.id === sel) + 1 : d.questions.length
      const qs = [...d.questions]; qs.splice(at || qs.length, 0, q)
      return { ...d, questions: qs }
    })
    setSel(q.id); setTab('question')
  }
  const remove = (id) => {
    change(d => ({ ...d, questions: d.questions.filter(q => q.id !== id) }))
    setSel(null)
  }
  const move = (id, dir) => change(d => { const i = d.questions.findIndex(q => q.id === id); return { ...d, questions: moveQuestion(d.questions, i, i + dir) } })

  const issues = useMemo(() => draft ? definitionIssues(draft) : [], [draft])
  const doPublish = async () => {
    setPublishing(true)
    try {
      if (dirty.current) { await formStaff('save', { id: formId, draft, settings }); dirty.current = false }
      const r = await formStaff('publish', { id: formId })
      setForm(r.form); setSave('saved')
      notify?.(`Published version ${r.form.current_version}. New links use it; answers already given keep theirs.`)
    } catch (e) { notify?.(e.message, 'err') } finally { setPublishing(false) }
  }

  // PAPER-ORIGINAL-1: the Catalog's own PDFs, read once, the same list Signatures offers.
  useEffect(() => {
    if (!paper || paper.onFile || catalogPdfs) return
    supabase.from('catalog_resources').select('id, title, kind, file_type_label, storage_path, resource_type, is_active')
      .eq('resource_type', 'internal_file').order('title')
      .then(({ data }) => setCatalogPdfs((data || []).filter(r => r.is_active !== false && (r.kind || 'file') === 'file'
        && !/^(sig-template|form):/.test(String(r.storage_path || ''))
        && (String(r.file_type_label || '').toUpperCase() === 'PDF' || /\.pdf$/i.test(r.storage_path || '')))))
  }, [paper, catalogPdfs])
  const choosePaper = async (resourceId) => {
    if (!resourceId) return
    setPaperBusy(true)
    try { const r = await formStaff('paper_set', { id: formId, resource_id: resourceId }); setPaper(r.paper); notify?.(`${r.paper.name} is on file. New submissions are filed on it.`) }
    catch (e) { notify?.(e.message, 'err') } finally { setPaperBusy(false) }
  }
  const removePaper = async () => {
    setPaperBusy(true)
    try { const r = await formStaff('paper_clear', { id: formId }); setPaper(r.paper) }
    catch (e) { notify?.(e.message, 'err') } finally { setPaperBusy(false) }
  }

  // STARTER-RESET-1: a starter form whose starter has changed offers the new one; it never swaps itself.
  const starter = form && save === 'saved' ? starterUpdateFor({ ...form, draft }) : null
  const [replacing, setReplacing] = useState(false)
  const replaceWithStarter = async () => {
    if (!window.confirm(`Replace this draft with the updated ${starter.title} starter? Your published versions and every answer already given are kept. Publish changes afterwards to send it.`)) return
    setReplacing(true)
    try {
      const r = await formStaff('use_starter', { id: formId })
      dirty.current = false
      setForm(r.form); setDraft(r.form.draft); setSel(r.form.draft.questions[0]?.id || null); setSave('saved')
      notify?.('Draft replaced with the updated starter. Check it, then Publish changes.')
    } catch (e) { notify?.(e.message, 'err') } finally { setReplacing(false) }
  }

  if (error) return <div className="fm"><p className="fm-err" role="alert">{error}</p><button type="button" className="fm-btn" onClick={onBack}>‹ Catalog</button></div>
  if (!draft) return <div className="fm"><p className="fm-hint">Loading the form…</p></div>

  const q = draft.questions.find(x => x.id === sel) || null
  const status = form.status === 'draft' ? 'Draft, never published' : form.draft_dirty || save !== 'saved' ? `Version ${form.current_version} published · edits not yet published` : `Version ${form.current_version} published`

  return (
    <div className="fm">
      <div className="fm-head">
        <div>
          <div className="fm-crumb"><button type="button" onClick={onBack}>‹ Catalog</button><span>/</span><span>Forms</span></div>
          <h1>{draft.title} <span className={`fm-tag${form.status === 'published' && !form.draft_dirty ? ' fm-tag-ok' : ''}`}>{status}</span></h1>
          <p className="fm-save" aria-live="polite">{save === 'saving' ? 'Saving…' : save === 'unsaved' ? 'Unsaved changes' : save === 'error' ? 'Not saved. Check your connection.' : 'All changes saved'}</p>
        </div>
        <div className="fm-row">
          {form.current_version > 0 && <button type="button" className="fm-btn" onClick={onResponses}>Responses</button>}
          <button type="button" className="fm-btn" onClick={() => setPreview(true)}>Preview as {settings.audience === 'schools' ? 'school' : settings.audience === 'preceptors' ? 'preceptor' : 'student'}</button>
          <button type="button" className="fm-btn fm-pri" onClick={doPublish} disabled={publishing || issues.length > 0 || (form.status === 'published' && !form.draft_dirty && save === 'saved')}
            title={issues[0] || undefined}>{publishing ? 'Publishing…' : form.status === 'draft' ? 'Publish' : 'Publish changes'}</button>
        </div>
      </div>
      {starter && (
        <div className="fm-note fm-starter" role="status">
          <span>The {starter.title} starter has been updated since this draft was made{starter.slug === 'student-parking-request' ? ': it now asks Parking Services\' own questions' : ''}.</span>
          <button type="button" className="fm-btn" onClick={replaceWithStarter} disabled={replacing}>{replacing ? 'Replacing…' : 'Use the updated starter'}</button>
        </div>
      )}
      {paper && (
        <div className="fm-card fm-paper">
          <p className="fm-h3">Paper form</p>
          {paper.onFile ? (
            <div className="fm-paper-row">
              <p className="fm-hint">Submissions are filed on {paper.name}, the PDF chosen from the Catalog, with each answer typed into its box.</p>
              <button type="button" className="fm-btn" onClick={removePaper} disabled={paperBusy}>{paperBusy ? 'Removing…' : 'Remove'}</button>
            </div>
          ) : (
            <div className="fm-paper-row">
              <label className="fm-hint" htmlFor="fm-paper-pick">Choose {paper.name} from the Catalog to file every submission on that exact PDF. {paper.redrawn ? 'Until then, ASPIRE draws a copy of it.' : 'Until then, submissions are filed as a plain list of answers.'}</label>
              <select id="fm-paper-pick" value="" disabled={paperBusy || !catalogPdfs} onChange={e => choosePaper(e.target.value)}>
                <option value="">{paperBusy ? 'Copying…' : catalogPdfs ? 'Choose a Catalog PDF…' : 'Loading the Catalog…'}</option>
                {(catalogPdfs || []).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      {issues.length > 0 && <p className="fm-note" role="status">Before publishing: {issues[0]}{issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}</p>}

      <div className="fm-grid">
        <aside className="fm-card fm-pal" aria-label="Add a question">
          <p className="fm-h3">Add a question</p>
          <div className="fm-palgrid">
            {QUESTION_TYPES.map(t => <button key={t.key} type="button" onClick={() => add(t.key)}><span className="fm-pi" aria-hidden="true">{t.glyph}</span>{t.label}</button>)}
          </div>
          <p className="fm-hint">A new question goes below the one selected. Drag a card, or use Move up and Move down, to reorder.</p>
        </aside>

        <section className="fm-canvas" aria-label="The form">
          <div className="fm-formcard">
            <div className="fm-fhd">
              <input className="fm-title" value={draft.title} onChange={e => change(d => ({ ...d, title: e.target.value }))} aria-label="Form title" />
              <textarea className="fm-desc" rows={2} value={draft.description || ''} placeholder="A sentence that tells people what this is for and how long it takes."
                onChange={e => change(d => ({ ...d, description: e.target.value }))} aria-label="Form description" />
              <label className="fm-conf">
                <span>After they submit</span>
                <textarea rows={2} maxLength={500} value={draft.confirmation || ''} placeholder="Shown on the thank-you screen. For example: Email your copy to linen@example.org. An email address becomes a link."
                  onChange={e => change(d => ({ ...d, confirmation: e.target.value }))} />
              </label>
            </div>
            {!draft.questions.length && <p className="fm-empty">No questions yet. Add one from the left.</p>}
            <ol className="fm-qs">
              {draft.questions.map((x, i) => (
                <li key={x.id} className={`fm-q${x.id === sel ? ' fm-q-sel' : ''}${x.type === 'section' ? ' fm-q-section' : ''}${over === i && dragging != null && dragging !== i ? (dragging < i ? ' fm-q-drop-after' : ' fm-q-drop-before') : ''}${dragging === i ? ' fm-q-dragging' : ''}`} draggable
                  onDragStart={(e) => { drag.current = i; setDragging(i); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', x.id) } catch { /* Firefox needs data to start a drag */ } }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== i) setOver(i) }}
                  onDragEnd={() => { drag.current = null; setOver(null); setDragging(null) }}
                  onDrop={(e) => {
                    e.preventDefault()
                    // FORM-DRAG-1: read the picked-up index NOW. The state updater runs later, after
                    // drag.current is cleared below, which is why every drop used to move nothing.
                    const from = drag.current
                    drag.current = null; setOver(null); setDragging(null)
                    if (from != null && from !== i) change(d => ({ ...d, questions: moveQuestion(d.questions, from, i) }))
                  }}>
                  <button type="button" className="fm-qbtn" aria-pressed={x.id === sel} onClick={() => { setSel(x.id); setTab('question') }}>
                    <span className="fm-grip" aria-hidden="true">⋮⋮</span>
                    <span className="fm-qmain">
                      <span className="fm-ql">{x.label}{x.required && takesAnswer(x) && <span className="fm-req"> *</span>}</span>
                      {x.help && <span className="fm-qh">{x.help}</span>}
                      <span className="fm-ctrl">{x.prefill ? <span className="fm-fake fm-pre">Filled automatically<em>{prefillSource(x.prefill)?.label}</em></span> : <FakeControl q={x} />}</span>
                    </span>
                    <span className="fm-ty">{questionType(x.type)?.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <aside className="fm-card fm-props" aria-label="Question and form settings">
          <div className="fm-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'question'} onClick={() => setTab('question')}>Question</button>
            <button type="button" role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>Form settings</button>
          </div>
          {tab === 'question' && (q ? <QuestionProps q={q} set={(p) => setQ(q.id, p)} remove={() => remove(q.id)}
            moveUp={() => move(q.id, -1)} moveDown={() => move(q.id, 1)} first={draft.questions[0]?.id === q.id} last={draft.questions.at(-1)?.id === q.id} />
            : <p className="fm-hint">Select a question to edit it.</p>)}
          {tab === 'settings' && <SettingsProps s={settings} set={changeSettings} />}
        </aside>
      </div>

      {preview && (
        <div className="fm-scrim" onMouseDown={() => setPreview(false)}>
          <div className="fm-previewwrap" role="dialog" aria-modal="true" aria-label="Preview" onMouseDown={e => e.stopPropagation()}>
            <div className="fm-prevbar"><b>Preview</b><button type="button" className="fm-btn fm-sm" onClick={() => setPreview(false)}>Close</button></div>
            <FormRenderer key={JSON.stringify(draft).length} definition={draft} preview
              prefill={Object.fromEntries(draft.questions.filter(x => x.prefill && SAMPLE[x.prefill]).map(x => [x.id, SAMPLE[x.prefill]]))} />
          </div>
        </div>
      )}
    </div>
  )
}

function FakeControl({ q }) {
  if (q.type === 'section') return null
  if (hasOptions(q)) return <span className="fm-opts">{(q.options || []).slice(0, 8).map(o => <span key={o}>{o}</span>)}{q.allowOther && <span>Other…</span>}</span>
  if (q.type === 'signature') return <span className="fm-fake fm-sigbox">Signs here</span>
  if (q.type === 'paragraph') return <span className="fm-fake fm-tall">Long answer</span>
  if (q.type === 'date') return <span className="fm-fake">mm / dd / yyyy</span>
  if (q.type === 'number') return <span className="fm-fake fm-narrow">0</span>
  if (q.type === 'file') return <span className="fm-fake">Choose a file</span>
  return <span className="fm-fake">Short answer</span>
}

function QuestionProps({ q, set, remove, moveUp, moveDown, first, last }) {
  const sources = PREFILL_SOURCES.filter(s => prefillFits(q.type, s.key))
  return (
    <div className="fm-panel">
      <div className="fm-field"><label htmlFor="fm-ql">{q.type === 'section' ? 'Heading' : 'Question'}</label><input id="fm-ql" value={q.label} onChange={e => set({ label: e.target.value })} /></div>
      <div className="fm-field"><label htmlFor="fm-qh">Help text</label><input id="fm-qh" value={q.help || ''} placeholder="Optional" onChange={e => set({ help: e.target.value })} /></div>
      {hasOptions(q) && (
        <div className="fm-field"><label htmlFor="fm-qo">Options, one per line</label>
          <textarea id="fm-qo" rows={Math.min(8, Math.max(3, (q.options || []).length + 1))} value={(q.options || []).join('\n')} onChange={e => set({ options: e.target.value.split('\n') })} /></div>
      )}
      {hasOptions(q) && (
        <label className="fm-tg"><span>Add an "Other" choice with a text box</span>
          <input type="checkbox" checked={q.allowOther === true} onChange={e => set({ allowOther: e.target.checked || undefined })} /></label>
      )}
      {q.type === 'number' && (
        <div className="fm-two">
          <div className="fm-field"><label htmlFor="fm-qmin">Smallest</label><input id="fm-qmin" type="number" value={q.min ?? ''} onChange={e => set({ min: e.target.value === '' ? null : Number(e.target.value) })} /></div>
          <div className="fm-field"><label htmlFor="fm-qmax">Largest</label><input id="fm-qmax" type="number" value={q.max ?? ''} onChange={e => set({ max: e.target.value === '' ? null : Number(e.target.value) })} /></div>
        </div>
      )}
      {takesAnswer(q) && sources.length > 0 && (
        <div className="fm-field"><label htmlFor="fm-qp">Prefill from</label>
          <select id="fm-qp" value={q.prefill || ''} onChange={e => set({ prefill: e.target.value || undefined })}>
            <option value="">None</option>
            {['Student record', 'Placement'].map(g => <optgroup key={g} label={g}>{sources.filter(s => s.group === g).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>)}
          </select>
          <p className="fm-hint">Prefilled answers come from ASPIRE, so people do not retype what you already know. They can still correct them.</p></div>
      )}
      {q.type === 'signature' && <p className="fm-hint">A typed or drawn signature printed on the form's PDF. For a legally binding signature, send a Signature template instead.</p>}
      {takesAnswer(q) && <label className="fm-tg"><span>Required</span><input type="checkbox" checked={!!q.required} onChange={e => set({ required: e.target.checked })} /></label>}
      <div className="fm-tg"><span>Question type</span><span className="fm-mono">{questionType(q.type)?.label}</span></div>
      <div className="fm-row">
        <button type="button" className="fm-btn fm-sm" onClick={moveUp} disabled={first}>Move up</button>
        <button type="button" className="fm-btn fm-sm" onClick={moveDown} disabled={last}>Move down</button>
        <button type="button" className="fm-btn fm-sm fm-danger" onClick={remove}>Delete question</button>
      </div>
    </div>
  )
}

function SettingsProps({ s, set }) {
  return (
    <div className="fm-panel">
      <div className="fm-field"><label htmlFor="fm-who">Who fills it</label>
        <select id="fm-who" value={s.audience} onChange={e => set({ audience: e.target.value })}>
          <option value="students">Students</option><option value="preceptors">Preceptors</option><option value="schools">Schools</option>
        </select></div>
      <label className="fm-tg"><span>File a PDF to the person's record</span><input type="checkbox" checked={s.filePdf} onChange={e => set({ filePdf: e.target.checked })} /></label>
      <div className="fm-field"><label htmlFor="fm-fwd">Email each filled PDF to</label>
        <input id="fm-fwd" type="email" value={s.forwardTo || ''} placeholder="office@cshs.org" onChange={e => set({ forwardTo: e.target.value })} />
        <p className="fm-hint">Optional. ASPIRE emails the filled form there from its own address under your name, copies the person who submitted it, and replies come to you. Applies to every submission from now on.</p></div>
      <label className="fm-tg"><span>Notify me on each submission</span><input type="checkbox" checked={s.notifyOnSubmit} onChange={e => set({ notifyOnSubmit: e.target.checked })} /></label>
      <label className="fm-tg"><span>Close after the due date</span><input type="checkbox" checked={s.closeAfterDue} onChange={e => set({ closeAfterDue: e.target.checked })} /></label>
      <div className="fm-field"><label htmlFor="fm-rem">Reminders</label>
        <select id="fm-rem" value={s.reminders} onChange={e => set({ reminders: e.target.value })}>{REMINDER_RULES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}</select></div>
      <label className="fm-tg"><span>Export answers (CSV)</span><input type="checkbox" checked={s.exportCsv} onChange={e => set({ exportCsv: e.target.checked })} /></label>
      <p className="fm-hint">Settings are saved with the draft and take effect for links sent after you publish.</p>
    </div>
  )
}
