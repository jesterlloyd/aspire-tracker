// KEITH-USAGE-1: Settings → Keith → Usage & Cost - the Owner's operational
// dashboard for Keith. Answers: how much is Keith being used, what is driving
// estimated cost, which models and skills consume the most, and is usage
// healthy. Composed from the same UI-1 primitives as its sibling workspaces
// (SettingsPageHeader, MetricCard, SegmentedTabs, DataTable, StatusBadge,
// SurfaceCard) so the three Keith surfaces read as one system.
//
// Owner/Admin only (the registry hides the Keith section otherwise, plus the
// defensive guard below; api/keith-usage.js is the real authority). All data
// arrives pre-aggregated from that endpoint - the browser never reads Keith
// audit tables and never receives prompts, answers, or document text.
//
// EVERY dollar figure on this page is labeled an estimate. It prices ASPIRE's
// own recorded token counts at official Anthropic rates; the Anthropic Console
// remains the billing authority.
import { useState, useEffect, useCallback } from 'react'
import { ExternalLink, BarChart3 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import SettingsPageHeader from './SettingsPageHeader'
import SurfaceCard from '../ui/SurfaceCard'
import MetricCard from '../ui/MetricCard'
import DataTable from '../ui/DataTable'
import StatusBadge from '../ui/StatusBadge'
import SegmentedTabs from '../ui/SegmentedTabs'
import EmptyState from '../EmptyState'

const secondary = 'var(--color-text-secondary, #6b7280)'

const RANGE_ITEMS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
]

// Outcome pills. Denied and missing-data are deliberately NOT failure-colored:
// an authorization boundary doing its job is not an incident.
const OUTCOME_STYLES = {
  completed:    { label: 'Completed',    bg: '#ecfdf5', color: '#047857', dot: '#10b981' },
  denied:       { label: 'Denied',       bg: '#eef2fb', color: '#1D2567', dot: '#93a4d8' },
  missing_data: { label: 'Missing data', bg: '#fffbeb', color: '#b45309', dot: '#f59e0b' },
  rate_limited: { label: 'Rate limited', bg: '#fff7ed', color: '#c2410c', dot: '#fb923c' },
  error:        { label: 'Error',        bg: '#fef2f2', color: '#b91c1c', dot: '#ef4444' },
}
const OUTCOME_ORDER = ['completed', 'denied', 'missing_data', 'rate_limited', 'error']

// Currency: sub-cent figures get four decimals so a $0.0038 request does not
// render as the lie "$0.00"; anything a cent or larger uses normal cents.
function fmtUsd(n) {
  if (n === null || n === undefined) return null
  const digits = Math.abs(n) > 0 && Math.abs(n) < 0.01 ? 4 : 2
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: digits })
}
const fmtInt = (n) => (n ?? 0).toLocaleString('en-US')
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtClock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

// "Pricing unavailable" wherever a dollar figure cannot be computed honestly.
function CostCell({ value }) {
  if (value === null || value === undefined) {
    return <span style={{ fontSize: 12, color: secondary, fontStyle: 'italic' }}>Pricing unavailable</span>
  }
  return <span>{fmtUsd(value)}</span>
}

async function postUsage(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/keith-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
  return res
}

// Compact daily trend: request bars with the estimated-cost line over them.
// Pure SVG on a viewBox; vector-effect keeps the line's stroke honest when the
// chart stretches. The figure carries a text alternative (figcaption + label),
// and every number it draws also appears in the tables below.
function UsageTrend({ trend }) {
  const W = 600; const H = 120
  const maxReq = Math.max(1, ...trend.map(d => d.requests))
  const maxCost = Math.max(0.0001, ...trend.map(d => d.estimatedCostUsd))
  const slot = W / trend.length
  const barW = Math.max(2, Math.min(26, slot * 0.6))
  const y = (v, max) => H - (v / max) * (H - 8)
  const points = trend.map((d, i) => `${slot * i + slot / 2},${y(d.estimatedCostUsd, maxCost)}`).join(' ')
  const peak = trend.reduce((a, b) => (b.requests > a.requests ? b : a), trend[0])
  const totalReq = trend.reduce((n, d) => n + d.requests, 0)
  const label = `Daily Keith usage: ${fmtInt(totalReq)} requests across ${trend.length} day${trend.length === 1 ? '' : 's'}; busiest day ${peak.day} with ${fmtInt(peak.requests)} requests.`

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        style={{ display: 'block', width: '100%', height: 120 }}
      >
        {trend.map((d, i) => (
          <rect
            key={d.day}
            x={slot * i + (slot - barW) / 2}
            y={y(d.requests, maxReq)}
            width={barW}
            height={H - y(d.requests, maxReq)}
            rx={1.5}
            fill="var(--color-accent-primary, #1D2567)"
            opacity={0.28}
          />
        ))}
        {trend.length > 1 && (
          <polyline
            points={points}
            fill="none"
            stroke="var(--color-accent-primary, #1D2567)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <figcaption style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 6, fontSize: 11.5, color: secondary }}>
        <span>{trend[0]?.day}</span>
        <span>Bars: requests (peak {fmtInt(maxReq)}/day) · Line: estimated cost (peak {fmtUsd(maxCost)}/day)</span>
        <span>{trend[trend.length - 1]?.day}</span>
      </figcaption>
    </figure>
  )
}

const MODEL_COLUMNS = [
  { key: 'label', label: 'Model', render: m => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 600 }}>{m.label}</div>
      <div title={m.model} style={{ fontSize: 11, color: secondary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{m.model}</div>
    </div>
  ) },
  { key: 'requests', label: 'Requests', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: m => fmtInt(m.requests) },
  { key: 'inputTokens', label: 'Input tokens', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: m => fmtInt(m.inputTokens) },
  { key: 'outputTokens', label: 'Output tokens', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: m => fmtInt(m.outputTokens) },
  { key: 'estimatedCostUsd', label: 'Est. cost', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: m => <CostCell value={m.estimatedCostUsd} /> },
  { key: 'avgCostPerRequestUsd', label: 'Avg / request', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums', color: secondary }, render: m => (m.avgCostPerRequestUsd === null ? '-' : fmtUsd(m.avgCostPerRequestUsd)) },
]

const WORKLOAD_COLUMNS = [
  { key: 'label', label: 'Workload', render: w => (
    <span style={{ fontWeight: 600 }}>{w.label}{!w.isSkill && (
      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: secondary }}>chat</span>
    )}{w.isSkill && (
      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: secondary }}>skill</span>
    )}</span>
  ) },
  { key: 'requests', label: 'Requests', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: w => fmtInt(w.requests) },
  { key: 'tokens', label: 'Tokens in / out', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, render: w => (
    <span aria-label={`${fmtInt(w.inputTokens)} input tokens, ${fmtInt(w.outputTokens)} output tokens`}>
      {fmtInt(w.inputTokens)}<span aria-hidden="true" style={{ color: secondary, margin: '0 4px' }}>/</span>{fmtInt(w.outputTokens)}
    </span>
  ) },
  // Wholly unpriceable workload -> "Pricing unavailable"; partially priced ->
  // the priced sum plus an honest count of what it excludes.
  { key: 'estimatedCostUsd', label: 'Est. cost', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, render: w => (
    w.unpriced >= w.requests
      ? <CostCell value={null} />
      : (
        <span>
          {fmtUsd(w.estimatedCostUsd)}
          {w.unpriced > 0 && <span style={{ fontSize: 11, color: secondary, marginLeft: 6 }}>({fmtInt(w.unpriced)} unpriced)</span>}
        </span>
      )
  ) },
  { key: 'avgDurationMs', label: 'Avg latency', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums', color: secondary }, render: w => (w.avgDurationMs === null ? '-' : `${fmtInt(w.avgDurationMs)} ms`) },
  { key: 'reliability', label: 'Errors / rate-limited', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, render: w => (
    <span aria-label={`${w.failures} errors, ${w.rateLimited} rate limited`}>
      <span style={w.failures > 0 ? { color: '#dc2626', fontWeight: 600 } : { color: secondary }}>{w.failures}</span>
      <span aria-hidden="true" style={{ color: secondary, margin: '0 4px' }}>/</span>
      <span style={{ color: secondary }}>{w.rateLimited}</span>
    </span>
  ) },
]

// Seven columns, measured to fit the ~780px workspace at 1500px wide. The
// DataTable card clips (overflow: hidden), so a table wider than its container
// silently loses its rightmost columns - the model therefore rides as a muted
// second line under Workload (the Skills slug pattern) instead of holding a
// column of its own, and the short model name drops the vendor prefix and date
// suffix while `title` keeps the exact id on hover.
const shortModel = (m) => (m ? m.replace(/^claude-/, '').replace(/-\d{8}$/, '') : null)
const RECENT_COLUMNS = [
  { key: 'createdAt', label: 'Time', cellStyle: { whiteSpace: 'nowrap' }, render: r => (
    <div>
      <div style={{ color: 'var(--color-text-primary, #374151)' }}>{fmtDay(r.createdAt)}</div>
      <div style={{ fontSize: 11.5, color: secondary }}>{fmtClock(r.createdAt)}</div>
    </div>
  ) },
  { key: 'user', label: 'User', render: r => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{r.user || '-'}</div>
      <div style={{ fontSize: 11, color: secondary, textTransform: 'capitalize' }}>{r.role || ''}</div>
    </div>
  ) },
  { key: 'skill', label: 'Workload', render: r => (
    <div style={{ minWidth: 0 }}>
      <div>{r.skill || 'Base Keith'}</div>
      {r.model && (
        <div title={r.model} style={{ fontSize: 11, color: secondary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {shortModel(r.model)}
        </div>
      )}
    </div>
  ) },
  { key: 'tokens', label: 'Tokens', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, render: r => (
    <span aria-label={`${fmtInt(r.inputTokens)} input tokens, ${fmtInt(r.outputTokens)} output tokens`}>
      {fmtInt(r.inputTokens)}<span aria-hidden="true" style={{ color: secondary, margin: '0 4px' }}>/</span>{fmtInt(r.outputTokens)}
    </span>
  ) },
  { key: 'estimatedCostUsd', label: 'Est. cost', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }, render: r => <CostCell value={r.estimatedCostUsd} /> },
  { key: 'durationMs', label: 'Latency', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums', color: secondary, whiteSpace: 'nowrap' }, render: r => (r.durationMs === null ? '-' : `${fmtInt(r.durationMs)} ms`) },
  { key: 'outcome', label: 'Outcome', render: r => <StatusBadge value={r.outcome} colorMap={OUTCOME_STYLES} /> },
]

const SECTION_TITLE = {
  margin: '26px 0 10px', fontSize: 14.5, fontWeight: 700,
  color: 'var(--color-text-primary, #191919)', fontFamily: 'Plus Jakarta Sans, sans-serif',
}

export default function KeithUsagePanel() {
  const { isAdmin } = useAuth()
  const [range, setRange] = useState('30d')
  const [summary, setSummary] = useState(null)
  const [pricing, setPricing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Defensive: client visibility is not authorization; the registry already
  // hides the Keith section from non-admins and the endpoint authorizes
  // server-side regardless.
  const allowed = isAdmin

  const load = useCallback(async (selectedRange) => {
    setLoading(true); setError(null)
    try {
      const res = await postUsage({ action: 'usage_summary', range: selectedRange })
      if (!res.ok) throw new Error(`status_${res.status}`)
      const json = await res.json()
      setSummary(json.summary || null)
      setPricing(json.pricing || null)
    } catch {
      setError('We couldn’t load Keith usage. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    load(range) // eslint-disable-line react-hooks/set-state-in-effect
  }, [allowed, range, load])

  if (!allowed) {
    return (
      <div style={{ fontSize: 13, color: secondary, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
        You don’t have access to Keith usage.
      </div>
    )
  }

  const totals = summary?.totals
  const health = summary?.health
  const hasData = (totals?.requests || 0) > 0

  return (
    <section aria-labelledby="settings-keith-usage-heading" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      <div id="settings-keith-usage-heading">
        <SettingsPageHeader
          title="Usage & Cost"
          subtitle="Keith activity, model usage, estimated spend, and operational health"
          accessNote="Owner and Admin access"
          actions={<SegmentedTabs label="Usage time range" items={RANGE_ITEMS} value={range} onChange={setRange} />}
        />
      </div>

      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: secondary, fontSize: 13 }}>
          Loading Keith usage…
        </div>
      ) : error ? (
        <SurfaceCard padding="16px 18px" style={{ color: secondary, fontSize: 13 }}>{error}</SurfaceCard>
      ) : !summary ? null : (
        <>
          {summary.truncated && (
            <SurfaceCard padding="10px 14px" style={{ marginBottom: 14, fontSize: 12.5, color: '#b45309', background: '#fffbeb' }}>
              This period exceeds the reporting window’s row limit, so totals below cover the most recent portion only.
            </SurfaceCard>
          )}

          {/* KPI band */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
            <MetricCard label="Requests" value={fmtInt(totals.requests)} sub={`${fmtInt(summary.outcomes.completed)} completed`} />
            <MetricCard label="Estimated cost" value={fmtUsd(totals.estimatedCostUsd) ?? '-'}
              sub={totals.unpricedRequests > 0 ? `${fmtInt(totals.unpricedRequests)} request${totals.unpricedRequests === 1 ? '' : 's'} unpriced` : 'all requests priced'} />
            <MetricCard label="Input tokens" value={fmtInt(totals.inputTokens)} />
            <MetricCard label="Output tokens" value={fmtInt(totals.outputTokens)} />
            <MetricCard label="Avg. cost / request" value={totals.avgCostPerRequestUsd === null ? '-' : fmtUsd(totals.avgCostPerRequestUsd)}
              sub={totals.avgDurationMs === null ? undefined : `${fmtInt(totals.avgDurationMs)} ms avg latency`} />
            {/* Success rate = completed / (completed + errors). Errors are the
                only other term in the ratio, so they are what the sub-line
                names; rate limits, denials and missing data are reported below
                as their own signals. */}
            <MetricCard label="Success rate" value={health.successRate === null ? '-' : `${health.successRate}%`}
              sub={health.errors > 0 ? `${fmtInt(health.errors)} error${health.errors === 1 ? '' : 's'}` : 'no errors'} />
          </div>

          {!hasData ? (
            <SurfaceCard>
              <EmptyState
                icon={<BarChart3 />}
                heading="No Keith activity in this period"
                subtext="Requests, token usage, and estimated cost will appear here as Keith is used."
              />
            </SurfaceCard>
          ) : (
            <>
              {/* Trend */}
              <SurfaceCard padding="16px 18px" style={{ marginBottom: 4 }}>
                <UsageTrend trend={summary.trend} />
              </SurfaceCard>

              {/* Outcome distribution - counts as pills, never color alone */}
              <div role="list" aria-label="Outcomes in this period" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '14px 0 4px' }}>
                {OUTCOME_ORDER.map(o => (
                  <span key={o} role="listitem" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <StatusBadge value={o} colorMap={OUTCOME_STYLES} />
                    <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: secondary }}>{fmtInt(summary.outcomes[o])}</span>
                  </span>
                ))}
              </div>
              {/* Without this, a period showing rate limits or denials next to a
                  100% success rate reads as a contradiction rather than a
                  deliberate exclusion. */}
              <p style={{ margin: '6px 2px 0', fontSize: 11.5, color: secondary }}>
                Success rate counts completed against errors only. Rate-limited, denied, and missing-data requests are tracked here as separate signals and do not affect it.
              </p>

              <h3 style={SECTION_TITLE}>Model Usage</h3>
              <DataTable columns={MODEL_COLUMNS} rows={summary.models} getRowKey={m => m.model}
                empty={<div style={{ padding: '20px 18px', fontSize: 13, color: secondary }}>No model calls in this period.</div>} />

              <h3 style={SECTION_TITLE}>Keith Workload</h3>
              <DataTable columns={WORKLOAD_COLUMNS} rows={summary.workloads} getRowKey={w => w.key}
                empty={<div style={{ padding: '20px 18px', fontSize: 13, color: secondary }}>No workload activity in this period.</div>} />

              <h3 style={SECTION_TITLE}>Recent Usage</h3>
              <div style={{ overflowX: 'auto' }}>
                <DataTable columns={RECENT_COLUMNS} rows={summary.recent} getRowKey={r => r.id}
                  empty={<div style={{ padding: '20px 18px', fontSize: 13, color: secondary }}>No requests in this period.</div>} />
              </div>
              <p style={{ margin: '8px 2px 0', fontSize: 11.5, color: secondary }}>
                Most recent {fmtInt(summary.recent.length)} requests. Metadata only: Keith never stores or shows questions, answers, or document text here.
              </p>
            </>
          )}

          {/* Provider reconciliation */}
          <h3 style={SECTION_TITLE}>Anthropic Billing Reconciliation</h3>
          <SurfaceCard padding="16px 18px" style={{ fontSize: 13, color: 'var(--color-text-primary, #374151)' }}>
            <p style={{ margin: 0 }}>
              Figures on this page are <strong>estimates</strong>: ASPIRE prices its own recorded input and output
              tokens at official Anthropic per-model rates. The Anthropic Console is the billing authority; the two
              will differ where provider-side features (such as prompt caching) bill at different rates.
            </p>
            <p style={{ margin: '10px 0 0' }}>
              <a href="https://platform.claude.com" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-accent-primary, #1D2567)', fontWeight: 600, textDecoration: 'none' }}>
                Open the Anthropic Console
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            </p>
            {pricing && (
              <p style={{ margin: '10px 0 0', fontSize: 11.5, color: secondary }}>
                Pricing basis: {pricing.perModel.map(p => `${p.label} $${p.inputPerMTok}/$${p.outputPerMTok} per MTok`).join(' · ')} — {pricing.source}, as of {pricing.asOf}.
              </p>
            )}
          </SurfaceCard>
        </>
      )}
    </section>
  )
}
