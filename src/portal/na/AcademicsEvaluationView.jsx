// src/portal/na/AcademicsEvaluationView.jsx
//
// KEITH-THEMES-1 (2026-09-29): the Evaluation page of the Nursing Education & Leadership portal. Read-only.
// Shown only to a grant the Owner gave evaluation_themes_access, and it holds only what the Owner has
// shared: the Leadership view of Keith's comment themes. The server has already applied the privacy
// floor, dropped every quote a student did not agree to share, removed names, and left out anything
// that points back to a response or a person; this screen only draws it.
import { useCallback, useEffect, useMemo, useState } from 'react'
// The static brand icon, never the interactive mark: the mark reads provenance and stays staff-only
// (test/keithMark.test.mjs). Leadership still sees that the themes are Keith's.
import { KeithIcon } from '../../components/keith/KeithBrand'
import { LoadingState, EmptyState, ErrorState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { surveyName, timepointQualifier } from '../../lib/evaluation/surveyNames'
import { shareText } from '../../lib/evaluation/commentThemesModel'
import { fetchAcademicsEvaluationThemes } from './nursingAcademicsApi'
import '../../components/evaluation/commentThemes.css'

const tpLabel = (tp) => timepointQualifier(tp) || String(tp).replace(/_/g, ' ')
// The review date is a calendar day (YYYY-MM-DD, Pacific). Read as a local date: new Date('2026-09-29') is UTC
// midnight, which is the evening before on the West Coast.
const day = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''))
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

export default function AcademicsEvaluationView({ active = true }) {
  const [index, setIndex] = useState(null)
  const [indexError, setIndexError] = useState(false)
  const [pick, setPick] = useState({ cohort: null, slug: null, timepoint: null })
  // The loaded cut remembers which pick and refresh it answers, so loading is derived, not set.
  const [loaded, setLoaded] = useState({ key: null, cut: null, error: false })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!active) return undefined
    const ctl = new AbortController()
    fetchAcademicsEvaluationThemes({}, { signal: ctl.signal }).then(r => {
      if (r.error === 'aborted') return
      if (!r.ok) { setIndexError(true); return }
      setIndexError(false); setIndex(r.data)
    })
    return () => ctl.abort()
  }, [active, nonce])

  const cohorts = useMemo(() => index?.cohorts || [], [index])
  const cohort = cohorts.find(c => c.id === pick.cohort) || cohorts[cohorts.length - 1] || null
  const slugs = useMemo(() => [...new Set((cohort?.items || []).map(i => i.slug))], [cohort])
  const slug = slugs.includes(pick.slug) ? pick.slug : slugs[0] || null
  const tps = useMemo(() => (cohort?.items || []).filter(i => i.slug === slug).map(i => i.timepoint), [cohort, slug])
  const timepoint = tps.includes(pick.timepoint) ? pick.timepoint : tps[tps.length - 1] || null

  const cutKey = cohort && slug && timepoint ? `${cohort.id}|${slug}|${timepoint}|${nonce}` : null
  useEffect(() => {
    if (!active || !cutKey) return undefined
    const ctl = new AbortController()
    fetchAcademicsEvaluationThemes({ cohort_id: cohort.id, instrument: slug, timepoint }, { signal: ctl.signal }).then(r => {
      if (r.error === 'aborted') return
      setLoaded({ key: cutKey, cut: r.ok ? r.data : null, error: !r.ok })
    })
    return () => ctl.abort()
  }, [active, cutKey]) // eslint-disable-line react-hooks/exhaustive-deps -- cutKey names cohort, slug and timepoint
  const cutState = !cutKey ? 'idle' : loaded.key !== cutKey ? 'loading' : loaded.error ? 'error' : 'ready'
  const cut = cutState === 'ready' ? loaded.cut : null

  const refresh = useCallback(() => setNonce(n => n + 1), [])
  useRegisterPortalRefresh(refresh, active)

  if (indexError) return <ErrorState title="Evaluation" detail="The evaluation themes could not be loaded." onRetry={refresh} />
  if (!index) return <LoadingState label="Loading evaluation themes" />
  if (!index.published || cohorts.length === 0) {
    return <EmptyState title="Evaluation" detail="No comment themes have been shared with leadership yet." />
  }

  return (
    <div className="ct-portal">
      <section className="ptl-card ct-portal-card" aria-labelledby="ct-portal-title">
        <header className="ct-head">
          <h2 id="ct-portal-title" className="ptl-card-title ct-portal-title">Comment Themes</h2>
        </header>
        <p className="ct-muted">Themes Keith found in students&apos; and preceptors&apos; written comments, reviewed by the ASPIRE team. De-identified; small themes are grouped under Other.</p>
        {/* Selects, not segmented pickers: survey names are long, and a row of selects wraps on a phone. */}
        <div className="ct-filters">
          {cohorts.length > 1 && (
            <label>Cohort
              <select className="ct-move" value={cohort.id} onChange={e => setPick({ cohort: e.target.value, slug: null, timepoint: null })}>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {slugs.length > 1 && (
            <label>Survey
              <select className="ct-move" value={slug} onChange={e => setPick(p => ({ ...p, slug: e.target.value, timepoint: null }))}>
                {slugs.map(s => <option key={s} value={s}>{surveyName(s)}</option>)}
              </select>
            </label>
          )}
          {tps.length > 1 && (
            <label>Timepoint
              <select className="ct-move" value={timepoint} onChange={e => setPick(p => ({ ...p, timepoint: e.target.value }))}>
                {tps.map(t => <option key={t} value={t}>{tpLabel(t)}</option>)}
              </select>
            </label>
          )}
        </div>

        {cutState === 'loading' && <p className="ct-empty">Loading themes…</p>}
        {cutState === 'error' && <p className="ct-empty">These themes could not be loaded. Use Refresh to try again.</p>}
        {cutState === 'ready' && cut && (cut.themes?.length ? (
          <div className="ct-lead">
            <p className="ct-run">
              <KeithIcon size={16} />
              <span><b>{surveyName(slug)}, {tpLabel(timepoint)}: {cut.total} {cut.total === 1 ? 'comment' : 'comments'}.</b>{' '}
                <span className="ct-muted">{cut.reviewed ? `Themes generated by Keith and reviewed by ${cut.reviewed.name} on ${day(cut.reviewed.at)}.` : 'Themes generated by Keith.'}</span></span>
            </p>
            {cut.themes.map(t => (
              <article key={t.name} className="ct-card">
                <div className="ct-card-head"><h3 className="ct-name">{t.name}</h3></div>
                <div className="ct-bar">
                  <span className="ct-meter" aria-hidden="true"><i style={{ width: `${cut.total ? Math.round((t.count / cut.total) * 100) : 0}%` }} /></span>
                  <span className="ct-bar-n">{shareText(t.count, cut.total)}</span>
                </div>
                {t.quotes.length > 0 && <ul className="ct-quotes">{t.quotes.map((q, i) => <li key={i}><q>{q}</q></li>)}</ul>}
              </article>
            ))}
            {cut.other?.count > 0 && (
              <article className="ct-card ct-other">
                <div className="ct-card-head"><h3 className="ct-name">Other</h3></div>
                <div className="ct-bar">
                  <span className="ct-meter" aria-hidden="true"><i style={{ width: `${cut.total ? Math.round((cut.other.count / cut.total) * 100) : 0}%` }} /></span>
                  <span className="ct-bar-n">{shareText(cut.other.count, cut.total)}</span>
                </div>
                {cut.other.note && <p className="ct-muted">{cut.other.note}</p>}
              </article>
            )}
            {cut.note && <p className="ct-muted">{cut.note}</p>}
          </div>
        ) : <p className="ct-empty">No themes have been shared for this survey yet.</p>)}
      </section>
    </div>
  )
}
