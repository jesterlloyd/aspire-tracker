// KNOWLEDGE-ENRICH-1: the Owner's vault enrichment workspace.
//
// Three phases on one surface:
//   1. BRIEFING - what will happen, what it costs, what the guards are, and
//      the single button that starts it. Nothing runs until the Owner acts.
//   2. RUN - the client orchestrates: one plan call over the whole corpus,
//      then one conversion call per entry, each landing as a PENDING REVISION.
//      Per-entry status is live; a failure or skip never stops the batch.
//   3. REVIEW - every pending revision in one list: rendered Markdown beside
//      the current body, aliases/tags chips, resolved links, flags, and the
//      change note. Apply and Discard are the EXISTING governance actions -
//      apply_entry_revision (Owner, via the existing RPC) and
//      discard_entry_revision. This surface adds no new write path.
//
// The batch can be re-run safely: entries with a pending revision are skipped
// server-side (and the DB's UNIQUE constraint backstops it), so a re-run only
// fills gaps.
import { useState, useEffect, useCallback, useRef } from 'react'
import { Sparkles, ChevronDown, ChevronRight, Check, X, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import SurfaceCard from '../ui/SurfaceCard'
import Button from '../ui/Button'
import { renderMarkdownLite } from '../../lib/keithMarkdown'
import { CATEGORY_LABELS } from './knowledgeCategories'
import { buildResolver } from '../../lib/wikilinkResolver'

const secondary = 'var(--color-text-secondary, #6b7280)'
const AMBER = '#b45309'

async function post(path, payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
}

const STATUS_COPY = {
  queued: 'Queued',
  running: 'Converting…',
  proposed: 'Revision ready',
  skipped_pending: 'Skipped - already has a pending revision',
  skipped_too_large: 'Skipped - too large for one-call conversion',
  gate_failed: 'Rejected by validation',
  failed: 'Model call failed',
}

export default function KnowledgeEnrichmentPanel({ isOwner, catalog = [], onDataChanged }) {
  // Resolve [[links]] in the rendered preview against the live entry list, so
  // a link the server validated as resolved never renders in the broken style.
  const resolveWikilink = buildResolver(catalog)
  const [phase, setPhase] = useState('briefing') // briefing | planning | running | done
  const [runError, setRunError] = useState(null)
  const [rows, setRows] = useState([])           // [{ id, title, status, detail, links, flags }]
  const [usage, setUsage] = useState({ input: 0, output: 0, calls: 0 })
  const [model, setModel] = useState(null)
  const cancelRef = useRef(false)

  // Review list: pending revisions across the vault, whoever authored them.
  const [revisions, setRevisions] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [reviewMsg, setReviewMsg] = useState(null)

  const loadRevisions = useCallback(async () => {
    let out = []
    try {
      const res = await post('/api/knowledge-admin', { action: 'list_pending_revisions' })
      const json = await res.json().catch(() => null)
      if (res.ok && Array.isArray(json?.revisions)) out = json.revisions
    } catch { /* fall through to the empty list */ }
    setRevisions(out)
  }, [])

  // Initial load, with the stale-response guard the drawer's link effect uses.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let out = []
      try {
        const res = await post('/api/knowledge-admin', { action: 'list_pending_revisions' })
        const json = await res.json().catch(() => null)
        if (res.ok && Array.isArray(json?.revisions)) out = json.revisions
      } catch { /* empty list */ }
      if (!cancelled) setRevisions(out)
    })()
    return () => { cancelled = true }
  }, [])

  // ── The run ────────────────────────────────────────────────────────────────
  const startRun = useCallback(async () => {
    cancelRef.current = false
    setPhase('planning'); setRunError(null); setRows([]); setUsage({ input: 0, output: 0, calls: 0 })
    try {
      const planRes = await post('/api/knowledge-enrich', { action: 'enrich_plan' })
      const planJson = await planRes.json().catch(() => null)
      if (!planRes.ok || !planJson?.plan) {
        setRunError(planJson?.error === 'owner_required'
          ? 'Only the Owner can run enrichment.'
          : 'The corpus analysis failed. Nothing was written; try again.')
        setPhase('briefing')
        return
      }
      setModel(planJson.model)
      setUsage(u => ({ input: u.input + (planJson.usage?.input || 0), output: u.output + (planJson.usage?.output || 0), calls: u.calls + 1 }))

      const manifest = planJson.manifest || []
      const planByEntry = new Map((planJson.plan.entries || []).map(p => [p.id, p]))
      setRows(manifest.map(m => ({
        id: m.id, title: m.title,
        status: m.skip === 'too_large' ? 'skipped_too_large' : 'queued',
        detail: null, links: [], flags: [],
      })))
      setPhase('running')

      // Sequential on purpose: one in-flight model call, resumable, and the
      // Owner can stop between entries.
      for (const m of manifest) {
        if (cancelRef.current) break
        if (m.skip) continue
        setRows(rs => rs.map(r => (r.id === m.id ? { ...r, status: 'running' } : r)))
        try {
          const res = await post('/api/knowledge-enrich', {
            action: 'enrich_entry', entry_id: m.id, plan_entry: planByEntry.get(m.id) || {},
          })
          const json = await res.json().catch(() => null)
          if (res.ok && json?.success) {
            setUsage(u => ({ input: u.input + (json.usage?.input || 0), output: u.output + (json.usage?.output || 0), calls: u.calls + 1 }))
            setRows(rs => rs.map(r => (r.id === m.id
              ? { ...r, status: 'proposed', links: json.links || [], flags: json.flags || [], detail: json.unresolved_unwrapped ? `${json.unresolved_unwrapped} link(s) unwrapped` : null }
              : r)))
          } else if (json?.reason === 'pending_revision_exists') {
            setRows(rs => rs.map(r => (r.id === m.id ? { ...r, status: 'skipped_pending' } : r)))
          } else if (json?.error === 'gate_failed') {
            setRows(rs => rs.map(r => (r.id === m.id ? { ...r, status: 'gate_failed', detail: `${json.reason}${json.detail ? `: ${json.detail}` : ''}` } : r)))
          } else {
            setRows(rs => rs.map(r => (r.id === m.id ? { ...r, status: 'failed', detail: json?.detail || json?.error || `HTTP ${res.status}` } : r)))
          }
        } catch {
          setRows(rs => rs.map(r => (r.id === m.id ? { ...r, status: 'failed', detail: 'network error' } : r)))
        }
      }
      setPhase('done')
      await loadRevisions()
      onDataChanged?.()
    } catch {
      setRunError('The run failed unexpectedly. Any revisions already proposed are intact.')
      setPhase('briefing')
    }
  }, [loadRevisions, onDataChanged])

  // ── Review actions: the EXISTING governance calls ──────────────────────────
  const applyRevision = useCallback(async (entryId) => {
    setBusyId(entryId); setReviewMsg(null)
    try {
      const res = await post('/api/knowledge-admin', { action: 'apply_entry_revision', entry_id: entryId })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setReviewMsg({ tone: 'error', text: res.status === 403 ? 'Only the Owner may apply revisions.' : (json?.message || 'Apply failed. Refresh and try again.') })
        return
      }
      setReviewMsg({ tone: 'info', text: 'Applied. The entry is live and its links are indexed.' })
      await loadRevisions()
      onDataChanged?.()
    } finally {
      setBusyId(null)
    }
  }, [loadRevisions, onDataChanged])

  const discardRevision = useCallback(async (entryId) => {
    setBusyId(entryId); setReviewMsg(null)
    try {
      const res = await post('/api/knowledge-admin', { action: 'discard_entry_revision', entry_id: entryId })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setReviewMsg({ tone: 'error', text: json?.message || 'Discard failed. Refresh and try again.' })
        return
      }
      await loadRevisions()
      onDataChanged?.()
    } finally {
      setBusyId(null)
    }
  }, [loadRevisions, onDataChanged])

  const proposed = rows.filter(r => r.status === 'proposed').length
  const finished = rows.filter(r => r.status !== 'queued' && r.status !== 'running').length

  const sectionLabel = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: secondary, marginBottom: 6 }
  const chip = (bg, color) => ({ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 9px', fontSize: 11.5, fontWeight: 600, background: bg, color })

  return (
    <SurfaceCard padding="18px 20px" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Sparkles size={15} style={{ color: 'var(--color-accent-primary, #1D2567)' }} />
          Vault enrichment
        </span>
        <span style={{ fontSize: 12.5, color: secondary }}>
          AI-drafted Markdown, aliases, tags, and links - every proposal a pending revision you apply or discard.
        </span>
      </div>

      {/* ── Phase 1: briefing + trigger ── */}
      {phase === 'briefing' && (
        <>
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 12.5, color: secondary, lineHeight: 1.65 }}>
            <li>Reads every <strong>Active</strong> entry as one corpus, plans a shared tag vocabulary, aliases, and intentional links, then converts entries one at a time.</li>
            <li><strong>Writes only pending revisions.</strong> Nothing is activated; the live entries and Keith's answers do not change until you apply each one below.</li>
            <li>Hard guards per entry: every number in the source must survive, length must stay near the original, links must resolve against real pages (never to itself), and anything uncertain is flagged for you instead of resolved silently.</li>
            <li>Entries that already have a pending revision are skipped, so a re-run only fills gaps.</li>
          </ul>
          {runError && (
            <div style={{ padding: '8px 12px', marginBottom: 10, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12.5 }}>{runError}</div>
          )}
          {isOwner ? (
            <Button variant="primary" icon={<Sparkles size={14} />} onClick={startRun}>
              Analyze corpus &amp; propose revisions
            </Button>
          ) : (
            <div style={{ fontSize: 12.5, color: secondary }}>Only the Owner can start an enrichment run. Pending proposals still appear below for review.</div>
          )}
        </>
      )}

      {/* ── Phase 2: the run ── */}
      {(phase === 'planning' || phase === 'running' || phase === 'done') && (
        <div style={{ marginBottom: revisions?.length ? 18 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {phase === 'planning' ? 'Analyzing the corpus…'
                : phase === 'running' ? `Converting ${finished}/${rows.length}…`
                  : `Run complete: ${proposed} revision${proposed === 1 ? '' : 's'} proposed`}
            </span>
            {phase === 'running' && (
              <Button variant="quiet" onClick={() => { cancelRef.current = true }}>Stop after current entry</Button>
            )}
            {phase === 'done' && (
              <Button variant="quiet" onClick={() => setPhase('briefing')}>New run</Button>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: secondary, fontVariantNumeric: 'tabular-nums' }}>
              {usage.calls} model call{usage.calls === 1 ? '' : 's'} · {usage.input.toLocaleString()} in / {usage.output.toLocaleString()} out tokens{model ? ` · ${model}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 260, overflowY: 'auto' }}>
            {rows.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, padding: '3px 2px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, alignSelf: 'center',
                  background: r.status === 'proposed' ? '#10b981' : r.status === 'running' ? '#1D2567'
                    : r.status === 'queued' ? '#d1d5db'
                      : r.status.startsWith('skipped') ? '#9ca3af' : '#ef4444' }} />
                <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                <span style={{ color: r.status === 'gate_failed' || r.status === 'failed' ? '#dc2626' : secondary, whiteSpace: 'nowrap' }}>
                  {STATUS_COPY[r.status]}{r.detail ? ` · ${r.detail}` : ''}
                </span>
                {r.flags.length > 0 && (
                  <span title={r.flags.join('\n')} style={{ color: AMBER, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                    <AlertTriangle size={11} />{r.flags.length}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Phase 3: batch review ── */}
      {revisions === null ? null : revisions.length === 0 ? (
        phase === 'briefing' ? (
          <div style={{ fontSize: 12.5, color: secondary, marginTop: 4 }}>No pending revisions to review.</div>
        ) : null
      ) : (
        <div style={{ marginTop: 6 }}>
          <div style={sectionLabel}>Pending revisions ({revisions.length})</div>
          {reviewMsg && (
            <div style={{ padding: '8px 12px', marginBottom: 8, borderRadius: 8, fontSize: 12.5,
              background: reviewMsg.tone === 'error' ? '#fef2f2' : 'var(--color-bg-elevated, #eef2fb)',
              color: reviewMsg.tone === 'error' ? '#dc2626' : 'var(--color-text-primary, #374151)' }}>
              {reviewMsg.text}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {revisions.map(rev => {
              const open = openId === rev.entry_id
              const flagged = /REVIEW FLAGS:/.test(rev.change_note || '')
              return (
                <div key={rev.id} style={{ border: '1px solid var(--color-border-subtle, #f3f4f6)', borderRadius: 10 }}>
                  <button type="button" onClick={() => setOpenId(open ? null : rev.entry_id)}
                    aria-expanded={open}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                      padding: '9px 12px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{rev.entry?.title || rev.title}</span>
                    {rev.entry?.body_format === 'plain' && rev.body_format === 'markdown' && (
                      <span style={chip('var(--color-bg-elevated, #eef2fb)', '#1D2567')}>plain → MD</span>
                    )}
                    {(rev.aliases?.length || 0) > 0 && <span style={{ fontSize: 11.5, color: secondary }}>{rev.aliases.length} alias{rev.aliases.length === 1 ? '' : 'es'}</span>}
                    {(rev.tags?.length || 0) > 0 && <span style={{ fontSize: 11.5, color: secondary }}>{rev.tags.length} tag{rev.tags.length === 1 ? '' : 's'}</span>}
                    {flagged && <span style={{ color: AMBER, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 600 }}><AlertTriangle size={11} />flagged</span>}
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, color: secondary, whiteSpace: 'nowrap' }}>
                      {rev.author_name || 'Unknown author'}
                    </span>
                  </button>

                  {open && (
                    <div style={{ padding: '0 14px 14px', fontSize: 13 }}>
                      {(rev.aliases?.length > 0 || rev.tags?.length > 0) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                          {(rev.aliases || []).map(a => <span key={`a-${a}`} style={chip('var(--color-bg-elevated, #eef2fb)', '#1D2567')}>{a}</span>)}
                          {(rev.tags || []).map(t => <span key={`t-${t}`} style={chip('#f1f0ec', '#6b7280')}>#{t}</span>)}
                        </div>
                      )}

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
                        <div>
                          <div style={sectionLabel}>Current ({rev.entry?.body_format || 'plain'})</div>
                          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, fontSize: 12.5, color: secondary, maxHeight: 320, overflowY: 'auto', padding: '10px 12px', background: 'var(--color-bg-app, #faf8f4)', borderRadius: 8 }}>
                            {rev.entry?.body || '(unavailable)'}
                          </div>
                        </div>
                        <div>
                          <div style={sectionLabel}>Proposed (markdown, rendered)</div>
                          <div style={{ lineHeight: 1.5, fontSize: 12.5, maxHeight: 320, overflowY: 'auto', padding: '10px 12px', background: '#fff', border: '1px solid var(--color-border-subtle, #f3f4f6)', borderRadius: 8 }}>
                            {renderMarkdownLite(rev.body || '', { resolveWikilink })}
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <div style={sectionLabel}>Change note</div>
                        <div style={{ fontSize: 12.5, color: /REVIEW FLAGS:/.test(rev.change_note) ? AMBER : secondary, whiteSpace: 'pre-wrap' }}>{rev.change_note}</div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        {isOwner && (
                          <Button variant="primary" icon={<Check size={13} />} disabled={busyId === rev.entry_id}
                            onClick={() => applyRevision(rev.entry_id)}>
                            {busyId === rev.entry_id ? 'Applying…' : 'Apply'}
                          </Button>
                        )}
                        <Button variant="quiet" icon={<X size={13} />} disabled={busyId === rev.entry_id}
                          onClick={() => discardRevision(rev.entry_id)}>
                          Discard
                        </Button>
                        <span style={{ fontSize: 11.5, color: secondary }}>
                          Apply makes this the live entry (a new version) and indexes its links; Discard deletes only the proposal. Category: {CATEGORY_LABELS[rev.category] || rev.category}.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </SurfaceCard>
  )
}
