// src/components/evaluation/CommentThemes.jsx
//
// KEITH-THEMES-1 (2026-09-29): the Comments section of one instrument on Evaluation > Responses.
// Reference: 2 · Comment themes in docs/mockups/keith-workflow.html (Owner view and Leadership view).
//
//   Run line   "Keith read [N] comments and found [N] themes." with the time, the Keith mark, Run again
//              and Export table. A version a person edited is never replaced without a confirmation.
//   A card per theme, largest first: the mark, the name, a bar "[n] of [N]", two or three verbatim
//              quotes that open their response, Rename, Merge, Accept, and Move on each quote.
//   Other      the comments no theme holds.
//   Leadership view  the de-identified cut: the privacy floor, consented quotes with names removed, no
//              links. What the Nursing Education & Leadership portal shows.
// In SHADOW the Owner and Admin see the themes and a line saying leadership does not; the Owner shares.
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import SegmentedPicker from '../shared/SegmentedPicker'
import KeithMark from '../keith/KeithMark'
import { refreshKeithProvenance } from '../keith/keithProvenanceStore'
import { commentThemes } from '../../lib/evaluation/commentThemesApi'
import { qualifies, shareText } from '../../lib/evaluation/commentThemesModel'
import { timepointQualifier } from '../../lib/evaluation/surveyNames'
import './commentThemes.css'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const tpLabel = (tp) => timepointQualifier(tp) || tp.replace(/_/g, ' ')

function Bar({ n, total }) {
  const pct = total ? Math.round((n / total) * 100) : 0
  return (
    <div className="ct-bar">
      <span className="ct-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      <span className="ct-bar-n">{shareText(n, total)}</span>
    </div>
  )
}

function MoveSelect({ comment, themes, currentId, onMove, busy }) {
  return (
    <select className="ct-move" aria-label={`Move this comment to another theme`} disabled={busy} value=""
      onChange={e => { const v = e.target.value; if (v) onMove(comment.id, v === '__other' ? null : v) }}>
      <option value="">Move…</option>
      {themes.filter(t => t.id !== currentId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      {currentId && <option value="__other">Other</option>}
    </select>
  )
}

// An accepted theme folds to one line: what is still open is what still needs a look (THEMES-FOLD-1).
function FoldedCard({ theme, total, onShow }) {
  return (
    <article className="ct-card ct-folded" aria-label={`${theme.name}, accepted`}>
      <div className="ct-card-head">
        <KeithMark provenanceId={theme.provenanceId} />
        <h4 className="ct-name">{theme.name}</h4>
        <span className="ct-grow" />
        <button type="button" className="ct-link" aria-expanded="false" onClick={onShow}>Show</button>
      </div>
      <Bar n={theme.count} total={total} />
    </article>
  )
}

function OwnerCard({ theme, total, themes, busy, onRename, onMerge, onAccept, onMove, onOpenResponse, onHide }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(theme.name)
  return (
    <article className="ct-card" aria-label={theme.name}>
      <div className="ct-card-head">
        <KeithMark provenanceId={theme.provenanceId} />
        {renaming ? (
          <form className="ct-rename" onSubmit={e => { e.preventDefault(); onRename(theme, name); setRenaming(false) }}>
            <label className="sr-only" htmlFor={`ct-name-${theme.id}`}>Theme name</label>
            <input id={`ct-name-${theme.id}`} value={name} maxLength={80} onChange={e => setName(e.target.value)} autoFocus />
            <button type="submit" className="ct-btn ct-btn-pri" disabled={busy}>Save</button>
            <button type="button" className="ct-btn" onClick={() => { setName(theme.name); setRenaming(false) }}>Cancel</button>
          </form>
        ) : <h4 className="ct-name">{theme.name}</h4>}
        {onHide && <><span className="ct-grow" /><button type="button" className="ct-link" aria-expanded="true" onClick={onHide}>Hide</button></>}
      </div>
      <Bar n={theme.count} total={total} />
      {theme.reason && <p className="ct-reason">{theme.reason}</p>}
      <ul className="ct-quotes">
        {theme.quotes.map(q => (
          <li key={q.id}>
            <q>{q.text}</q>
            <span className="ct-quote-acts">
              <button type="button" className="ct-link" onClick={() => onOpenResponse(q.assignmentId)}>Open response</button>
              <MoveSelect comment={q} themes={themes} currentId={theme.id} onMove={onMove} busy={busy} />
            </span>
          </li>
        ))}
      </ul>
      <div className="ct-acts">
        <button type="button" className="ct-btn" disabled={busy} onClick={() => setRenaming(true)}>Rename</button>
        <select className="ct-move" aria-label={`Merge ${theme.name} into another theme`} disabled={busy || themes.length < 2} value=""
          onChange={e => e.target.value && onMerge(theme, e.target.value)}>
          <option value="">Merge into…</option>
          {themes.filter(t => t.id !== theme.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {theme.state === 'accepted'
          ? <span className="ct-accepted">Accepted</span>
          : <button type="button" className="ct-btn ct-btn-pri" disabled={busy} onClick={() => onAccept(theme)}>{theme.state === 'edited' ? 'Accept with changes' : 'Accept'}</button>}
      </div>
    </article>
  )
}

function LeadershipView({ view }) {
  if (!view?.version) return <p className="ct-empty">No themes yet. Run Keith in the Owner view first.</p>
  return (
    <div className="ct-lead">
      {!view.published && <p className="ct-muted">Preview: this is exactly what leadership will see once you share. They see nothing yet.</p>}
      {view.themes.map(t => (
        <article key={t.name} className="ct-card">
          <div className="ct-card-head"><h4 className="ct-name">{t.name}</h4></div>
          <Bar n={t.count} total={view.total} />
          {t.quotes.length > 0 && <ul className="ct-quotes">{t.quotes.map((q, i) => <li key={i}><q>{q}</q></li>)}</ul>}
          {t.quotesWithheld > 0 && t.quotes.length === 0 && <p className="ct-muted">Quotes are not shown for this theme.</p>}
        </article>
      ))}
      {view.other?.count > 0 && (
        <article className="ct-card ct-other">
          <div className="ct-card-head"><h4 className="ct-name">Other</h4></div>
          <Bar n={view.other.count} total={view.total} />
          {view.other.note && <p className="ct-muted">{view.other.note}</p>}
        </article>
      )}
      <p className="ct-muted">{view.note}</p>
    </div>
  )
}

export default function CommentThemes({ cohortId, instrument, instrumentName, onOpenResponse }) {
  const { userProfile } = useAuth()
  const isOwner = userProfile?.is_owner === true
  const qc = useQueryClient()
  const [timepoint, setTimepoint] = useState(null)
  const [audience, setAudience] = useState('owner')
  const [busy, setBusy] = useState(false)
  // The outcome of the last action, said in the section itself (Responses has no toast host).
  const [note, setNote] = useState(null)
  // Keyed by instrument and timepoint, so switching either closes Other and any pending confirmation.
  const [otherOpenFor, setOtherOpenFor] = useState(null)
  const [confirmFor, setConfirmFor] = useState(null)
  // Accepted themes a person has opened again. Keyed by theme id, which is unique to one version.
  const [shown, setShown] = useState(() => new Set())
  const toggleShown = (id, on) => setShown(prev => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next })
  const enabled = !!cohortId && qualifies(instrument)

  const { data: tps } = useQuery({
    queryKey: ['comment_theme_timepoints', cohortId, instrument],
    queryFn: () => commentThemes('timepoints', { cohort_id: cohortId, instrument }),
    enabled, retry: false, staleTime: 60_000,
  })
  const timepoints = useMemo(() => tps?.timepoints || [], [tps])
  const tp = timepoint && timepoints.includes(timepoint) ? timepoint : timepoints[timepoints.length - 1] || null
  const key = ['comment_themes', cohortId, instrument, tp, audience]
  const { data: view, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => commentThemes('view', { cohort_id: cohortId, instrument, timepoint: tp, audience }),
    enabled: enabled && !!tp, retry: false, staleTime: 30_000,
  })
  const { data: settings } = useQuery({ queryKey: ['comment_theme_settings'], queryFn: () => commentThemes('settings'), enabled: enabled && isOwner, retry: false })
  const here = `${instrument}|${tp}`
  const otherOpen = otherOpenFor === here
  const setOtherOpen = (fn) => setOtherOpenFor(fn(otherOpen) ? here : null)
  const confirming = confirmFor === here

  if (!enabled || view?.available === false) return null
  const refresh = () => qc.invalidateQueries({ queryKey: ['comment_themes', cohortId, instrument] })
  const act = async (fn, done) => {
    setBusy(true)
    setNote(null)
    try { const r = await fn(); await refresh(); done?.(r) } catch (e) { setNote({ kind: 'error', text: `Not saved. ${e.message || 'Please try again.'}` }) } finally { setBusy(false) }
  }
  // A version a person edited is never replaced without asking: the first Run again explains, the
  // second (Run again anyway) confirms.
  const run = (force = false) => act(async () => {
    try { return await commentThemes('run', { cohort_id: cohortId, instrument, timepoint: tp, force }) } catch (e) {
      if (e.code === 'edited') { setConfirmFor(here); return null }
      throw e
    }
  }, (r) => { if (r) { setConfirmFor(null); setNote({ kind: 'ok', text: `Themes ready: Keith read ${r.comments} comments and found ${r.themes} themes.` }) } })
  const exportTable = () => act(async () => {
    const r = await commentThemes('export', { cohort_id: cohortId, instrument, timepoint: tp })
    const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = r.fileName; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  })
  const themes = view?.themes || []
  const reviewed = themes.filter(t => t.state === 'accepted').length
  const touch = (t) => refreshKeithProvenance(t?.provenanceId)

  return (
    <section className="ct-section" aria-labelledby="ct-title">
      <header className="ct-head">
        <h3 id="ct-title">Comments</h3>
        {timepoints.length > 1 && (
          <SegmentedPicker size="sm" ariaLabel="Timepoint" value={tp} onChange={setTimepoint} options={timepoints.map(t => ({ value: t, label: tpLabel(t) }))} />
        )}
        <span className="ct-grow" />
        <SegmentedPicker size="sm" ariaLabel="View" value={audience} onChange={setAudience}
          options={[{ value: 'owner', label: 'Owner view' }, { value: 'leadership', label: 'Leadership view' }]} />
      </header>

      {view && view.mode !== 'off' && (
        <p className={`ct-mode ct-mode-${view.mode}`}>
          {view.mode === 'shadow' ? 'Shadow mode: leadership does not see these themes yet.' : 'Shared with leadership, de-identified.'}
          {isOwner && <button type="button" className="ct-link" disabled={busy} onClick={() => act(() => commentThemes('set_mode', { mode: view.mode === 'shadow' ? 'on' : 'shadow' }))}>{view.mode === 'shadow' ? 'Share with leadership' : 'Stop sharing'}</button>}
        </p>
      )}

      <p className={`ct-note${note?.kind === 'error' ? ' ct-note-error' : ''}`} role="status">{note?.text || ''}</p>

      {!tp && <p className="ct-empty">No responses with comments yet for {instrumentName}.</p>}
      {tp && isLoading && <p className="ct-empty">Loading comments…</p>}

      {tp && view && audience === 'leadership' && (
        <>
          <LeadershipView view={view} />
          {isOwner && settings && (
            <form className="ct-floor" onSubmit={e => { e.preventDefault(); const n = Number(new FormData(e.currentTarget).get('floor')); act(() => commentThemes('set_floor', { floor: n }), () => qc.invalidateQueries({ queryKey: ['comment_theme_settings'] })) }}>
              <label>Privacy floor <input name="floor" type="number" min={1} max={20} defaultValue={settings.floor} key={settings.floor} /> comments</label>
              <button type="submit" className="ct-btn" disabled={busy}>Save</button>
            </form>
          )}
        </>
      )}

      {tp && view && audience === 'owner' && (
        <>
          <div className="ct-run">
            {view.version ? (
              <>
                <KeithMark provenanceId={view.version.provenanceId} />
                <span><b>Keith read {view.total} comments and found {themes.length} {themes.length === 1 ? 'theme' : 'themes'}.</b> <span className="ct-muted">{when(view.version.createdAt)} · version {view.version.version}{view.version.newComments ? ` · ${view.version.newComments} new ${view.version.newComments === 1 ? 'comment' : 'comments'} since` : ''}</span>
                  {themes.length > 0 && (
                    <span className={`ct-progress${reviewed === themes.length ? ' ct-progress-done' : ''}`}>
                      <span className="ct-meter" aria-hidden="true"><i style={{ width: `${Math.round((reviewed / themes.length) * 100)}%` }} /></span>
                      {reviewed === themes.length ? 'All themes reviewed' : `${reviewed} of ${themes.length} themes reviewed`}
                    </span>
                  )}
                </span>
              </>
            ) : (
              <span><b>Keith has not read these comments yet.</b> <span className="ct-muted">{view.liveComments} {view.liveComments === 1 ? 'comment' : 'comments'} {tpLabel(tp) ? `at ${tpLabel(tp)}` : ''}</span></span>
            )}
            <span className="ct-grow" />
            <button type="button" className="ct-btn ct-btn-pri" disabled={busy || !view.liveComments || view.mode === 'off'} onClick={() => run(false)}>{busy ? 'Working…' : view.version ? 'Run again' : 'Run'}</button>
            {view.version && <button type="button" className="ct-btn" disabled={busy} onClick={exportTable}>Export table</button>}
          </div>
          {confirming && (
            <div className="ct-confirm" role="alert">
              <span>Someone has edited these themes. Running again makes a new version from Keith; the edited one stays in the history.</span>
              <button type="button" className="ct-btn ct-btn-pri" disabled={busy} onClick={() => run(true)}>Run again anyway</button>
              <button type="button" className="ct-btn" onClick={() => setConfirmFor(null)}>Keep this version</button>
            </div>
          )}
          {themes.map(t => (t.state === 'accepted' && !shown.has(t.id)) ? (
            <FoldedCard key={t.id} theme={t} total={view.total} onShow={() => toggleShown(t.id, true)} />
          ) : (
            <OwnerCard key={t.id} theme={t} total={view.total} themes={themes} busy={busy} onOpenResponse={onOpenResponse}
              onHide={t.state === 'accepted' ? () => toggleShown(t.id, false) : null}
              onRename={(th, name) => act(() => commentThemes('rename', { theme_id: th.id, name }), () => touch(th))}
              onMerge={(th, into) => act(() => commentThemes('merge', { theme_id: th.id, into_id: into }), () => { touch(th); touch(themes.find(x => x.id === into)) })}
              onAccept={(th) => act(() => commentThemes('accept', { theme_id: th.id }), () => { touch(th); toggleShown(th.id, false) })}
              onMove={(cid, to) => act(() => commentThemes('move', { version_id: view.version.id, comment_id: cid, to_theme_id: to }), () => { touch(t); touch(themes.find(x => x.id === to)) })} />
          ))}
          {view.version && view.other?.length > 0 && (
            <article className="ct-card ct-other">
              <div className="ct-card-head"><h4 className="ct-name">Other</h4>
                <button type="button" className="ct-link" aria-expanded={otherOpen} onClick={() => setOtherOpen(v => !v)}>{otherOpen ? 'Hide' : 'Show'} {view.other.length}</button></div>
              <Bar n={view.other.length} total={view.total} />
              {otherOpen && (
                <ul className="ct-quotes">
                  {view.other.map(q => (
                    <li key={q.id}><q>{q.text}</q>
                      <span className="ct-quote-acts">
                        <button type="button" className="ct-link" onClick={() => onOpenResponse(q.assignmentId)}>Open response</button>
                        <MoveSelect comment={q} themes={themes} currentId={null} onMove={(cid, to) => act(() => commentThemes('move', { version_id: view.version.id, comment_id: cid, to_theme_id: to }))} busy={busy} />
                      </span></li>
                  ))}
                </ul>
              )}
            </article>
          )}
        </>
      )}
    </section>
  )
}
