// src/components/evaluation/UnitEvaluationReleaseConsole.jsx
//
// Owner/Admin console for releasing Unit Leader evaluation results. It reads the release
// queue and performs exact-row lifecycle actions through /api/evaluation-unit-release-*,
// which call the SECURITY DEFINER RPCs with the caller's JWT. Staff see identity and
// lifecycle metadata here; the server + database enforce every gate and return the exact
// refusal reason, which this console shows verbatim-safe. Unit Leaders never see this.

import { useEffect, useMemo, useRef, useState } from 'react'
import { getReviewQueue, postReleaseAction } from '../../lib/evaluationReviewApi'
import { instrumentCompactLabel } from '../../lib/evaluationLabels'
import {
  availableActions, rowIsReadOnly, ACTION_API, ACTION_STATUS_MESSAGE,
  RELEASE_STATE_LABELS, MODERATION_STATE_LABELS,
} from '../../lib/unitEvaluationReleaseActions'

const F = "'Plus Jakarta Sans', system-ui, sans-serif"
const NAVY = '#1D2567'
const INSTRUMENTS = [
  { slug: 'student_preceptor_eval' },
  { slug: 'preceptor_progress' },
]
const TIMEPOINTS = [['midpoint', 'Midpoint'], ['post_rotation', 'Post-rotation']]
const RELEASE_STATES = ['pending', 'moderated', 'released', 'revoked', 'ineligible']
const MOD_STATES = ['pending', 'cleared', 'blocked']

const STATE_TINT = {
  pending: '#f3f4f6', moderated: '#eef2fb', released: '#e7f5ec', revoked: '#e5e7eb', ineligible: '#fdeceb',
}

function fmtDate(d) {
  if (!d) return '—'
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Badge({ children, tint }) {
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px',
      borderRadius: 10, background: tint || '#f3f4f6', color: '#374151', fontFamily: F, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

// EVAL-RR-UNIFIED-NAV-1: `embedded` renders the console inside the Review & Release
// workspace shell (which already provides the card, border, and padding), dropping only
// this component's page-level outer padding. Queue, counts, filters, actions, legacy
// read-only rows, eligibility, and timing rules are identical in both presentations.
export default function UnitEvaluationReleaseConsole({ embedded = false }) {
  const [filters, setFilters] = useState({ instrument: '', unit_key: '', timepoint: '', release_state: '', moderation_state: '' })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(null)               // response_id currently acting
  const [confirmFor, setConfirmFor] = useState(null)   // { responseId, actionKey }
  const [notice, setNotice] = useState(null)           // { tone, text }
  const [reloadTick, setReloadTick] = useState(0)
  const reqId = useRef(0)

  // Fetch on mount, on any filter change, and on an explicit reload. The effect never
  // setState()s synchronously (repo rule): loading is flipped on in the handlers that
  // change filters/trigger a reload, and off here only after the request resolves. A
  // per-request id ignores a stale response after a rapid filter change.
  useEffect(() => {
    const id = ++reqId.current
    let live = true
    const ac = new AbortController()
    getReviewQueue({
      instrument: filters.instrument || undefined,
      unit_key: filters.unit_key || undefined,
      timepoint: filters.timepoint || undefined,
      release_state: filters.release_state || undefined,
      moderation_state: filters.moderation_state || undefined,
    }, ac.signal).then(res => {
      if (!live || id !== reqId.current) return
      if (res.ok) { setRows(res.data?.rows || []); setError(false) }
      else if (res.error !== 'aborted') setError(true)
      setLoading(false)
    })
    return () => { live = false; ac.abort() }
  }, [filters, reloadTick])

  const reload = () => { setLoading(true); setReloadTick(t => t + 1) }

  // Unit options are derived from the loaded rows' authorized historical units (never
  // constructed from anything the browser supplied).
  const unitOptions = useMemo(
    () => [...new Set(rows.map(r => r.unit_key).filter(Boolean))].sort(),
    [rows],
  )
  const counts = useMemo(() => {
    const c = Object.fromEntries(RELEASE_STATES.map(s => [s, 0]))
    for (const r of rows) if (c[r.release_state] !== undefined) c[r.release_state] += 1
    return c
  }, [rows])

  const setF = (k, v) => { setLoading(true); setFilters(f => ({ ...f, [k]: v })) }

  const runAction = async (row, actionKey) => {
    if (busy) return
    const meta = ACTION_API[actionKey]
    setBusy(row.response_id); setConfirmFor(null); setNotice(null)
    const res = await postReleaseAction({ action: meta.action, responseId: row.response_id, decision: meta.decision })
    setBusy(null)
    const status = res.data?.status || res.error
    const msg = ACTION_STATUS_MESSAGE[status] || 'That action could not be completed.'
    setNotice({ tone: res.ok && res.data?.ok ? 'ok' : 'error', text: msg })
    // Refresh only the queue (affected data), preserving filters.
    if (res.ok) reload()
  }

  const onActionClick = (row, actionKey) => {
    if (ACTION_API[actionKey].confirm) setConfirmFor({ responseId: row.response_id, actionKey })
    else runAction(row, actionKey)
  }

  return (
    <section style={{ padding: embedded ? 0 : '0 20px 24px', fontFamily: F }} aria-label="Release evaluations to Unit Leaders">
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0E1428' }}>Release to Unit Leaders</h3>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#5b6472', maxWidth: 720 }}>
          Unit Leaders see quantitative results only, after the rotation ends plus 7 days, once you
          clear moderation and release. Results can appear when only one response exists, so a
          single-response result is not anonymous — do not treat it as such.
        </p>
      </div>

      {/* Release-state summary */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        {RELEASE_STATES.map(s => (
          <div key={s} style={{ padding: '8px 12px', borderRadius: 10, background: STATE_TINT[s], minWidth: 96 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#0E1428', fontVariantNumeric: 'tabular-nums' }}>{counts[s]}</div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280' }}>{RELEASE_STATE_LABELS[s]}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={filters.instrument} onChange={e => setF('instrument', e.target.value)} style={selStyle} aria-label="Instrument filter">
          <option value="">All instruments</option>
          {INSTRUMENTS.map(i => <option key={i.slug} value={i.slug}>{instrumentCompactLabel(i.slug)}</option>)}
        </select>
        <select value={filters.unit_key} onChange={e => setF('unit_key', e.target.value)} style={selStyle} aria-label="Unit filter">
          <option value="">All units</option>
          {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={filters.timepoint} onChange={e => setF('timepoint', e.target.value)} style={selStyle} aria-label="Timepoint filter">
          <option value="">All timepoints</option>
          {TIMEPOINTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filters.release_state} onChange={e => setF('release_state', e.target.value)} style={selStyle} aria-label="Release state filter">
          <option value="">All release states</option>
          {RELEASE_STATES.map(s => <option key={s} value={s}>{RELEASE_STATE_LABELS[s]}</option>)}
        </select>
        <select value={filters.moderation_state} onChange={e => setF('moderation_state', e.target.value)} style={selStyle} aria-label="Moderation state filter">
          <option value="">All moderation states</option>
          {MOD_STATES.map(s => <option key={s} value={s}>{MODERATION_STATE_LABELS[s]}</option>)}
        </select>
      </div>

      {notice && (
        <p role="status" style={{ margin: '0 0 12px', fontSize: 12.5, fontWeight: 600,
          color: notice.tone === 'ok' ? '#166534' : '#991b1b' }}>{notice.text}</p>
      )}

      {loading ? (
        <p role="status" style={{ color: '#6b7280', fontSize: 13 }}>Loading release queue…</p>
      ) : error ? (
        <div role="alert" style={{ fontSize: 13, color: '#991b1b' }}>
          The release queue could not be loaded. <button onClick={reload} style={linkBtn}>Try again</button>
        </div>
      ) : rows.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 13 }}>No responses match these filters.</p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
          <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontFamily: F }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {['Student', 'Instrument', 'Timepoint', 'Unit', 'Evaluated preceptor', 'Rotation end', 'Eligible', 'Moderation', 'Release', 'Actions']
                  .map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const ro = rowIsReadOnly(r)
                const actions = availableActions(r)
                const confirming = confirmFor?.responseId === r.response_id
                return (
                  <tr key={r.response_id} style={{ borderTop: '1px solid #eef0f2' }}>
                    <td style={tdStyle}>{r.student_name || '—'}</td>
                    <td style={tdStyle}>{instrumentCompactLabel(r.instrument_slug)}</td>
                    <td style={tdStyle}>{r.timepoint || '—'}</td>
                    <td style={tdStyle}>{r.unit_key || '—'}</td>
                    <td style={tdStyle}>{r.evaluated_preceptor || <span style={{ color: '#b91c1c' }}>Unresolved</span>}</td>
                    <td style={tdStyle}>{fmtDate(r.rotation_end)}</td>
                    <td style={tdStyle}>{fmtDate(r.eligible_at)}</td>
                    <td style={tdStyle}><Badge tint={r.moderation_state === 'cleared' ? '#e7f5ec' : r.moderation_state === 'blocked' ? '#fdeceb' : '#f3f4f6'}>{MODERATION_STATE_LABELS[r.moderation_state] || r.moderation_state}</Badge></td>
                    <td style={tdStyle}><Badge tint={STATE_TINT[r.release_state]}>{RELEASE_STATE_LABELS[r.release_state] || r.release_state}</Badge></td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {ro ? (
                        <span style={{ fontSize: 11.5, color: '#9ca3af' }}>Read-only{r.snapshot_source && r.snapshot_source !== 'submission_trigger' ? ' (legacy)' : ''}</span>
                      ) : confirming ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 11.5, color: '#374151' }}>Confirm {ACTION_API[confirmFor.actionKey].label}?</span>
                          <button disabled={busy === r.response_id} onClick={() => runAction(r, confirmFor.actionKey)} style={{ ...actBtn, background: NAVY, color: '#fff' }}>Yes</button>
                          <button onClick={() => setConfirmFor(null)} style={actBtn}>No</button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                          {actions.length === 0 && <span style={{ fontSize: 11.5, color: '#9ca3af' }}>—</span>}
                          {actions.map(k => (
                            <button key={k} disabled={busy === r.response_id}
                              onClick={() => onActionClick(r, k)}
                              style={{ ...actBtn, ...(k === 'moderate_blocked' || k === 'revoke' ? { color: '#991b1b', borderColor: '#f0c9c9' } : {}) }}>
                              {ACTION_API[k].label}
                            </button>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const selStyle = { height: 32, padding: '0 10px', fontFamily: F, fontSize: 12, borderRadius: 7,
  border: '1px solid #e5e7eb', background: '#fff', color: '#374151' }
const thStyle = { padding: '9px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700,
  letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', whiteSpace: 'nowrap' }
const tdStyle = { padding: '9px 12px', fontSize: 12.5, color: '#191919', verticalAlign: 'middle' }
const actBtn = { height: 26, padding: '0 9px', fontFamily: F, fontSize: 11.5, fontWeight: 600,
  borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }
const linkBtn = { background: 'none', border: 'none', color: NAVY, fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0 }
