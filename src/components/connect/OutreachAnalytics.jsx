// OUTREACH-ANALYTICS-1: the compact analytics band above Sent History.
//
// Visual language borrowed from Settings > Keith > Usage & Cost - a KPI band
// over one restrained chart - while the information architecture stays ASPIRE
// Connect's. It answers three questions and stops: how many communications
// went out, who received them, and how volume moved.
//
// The numbers are the SAME numbers the list reports: one row per recipient
// delivery, aggregated server-side through the identical filter chain, so the
// KPI total always equals the "N communications" figure underneath.
import { useState } from 'react'
import { AUDIENCES, AUDIENCE_LABELS } from '../../../lib/server/outreachAnalytics.js'
import { FilterKPICard } from '../KPIBand'

const F = 'Plus Jakarta Sans, sans-serif'

// One restrained hue per audience, drawn from the app's accent family. Stacked
// bars need to be distinguishable at 6px wide, so these are separated by value
// as well as hue.
const AUDIENCE_COLORS = {
  students: '#1D2567',
  academic_partners: '#3E8E7E',
  unit_leaders: '#C2843A',
  other: '#B6BCCB',
}

const AUDIENCE_ACCENTS = {
  students: 'nightfall',
  academic_partners: 'sage',
  unit_leaders: 'dawn',
  other: 'periwinkle',
}

const fmtInt = (n) => Number(n || 0).toLocaleString()

/** Stacked daily bars. Hover gives the date, the total, and the split. */
function ActivityChart({ daily }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...daily.map(d => d.total))
  const H = 116
  const gap = daily.length > 45 ? 1 : 2

  return (
    <div style={{ position: 'relative' }}>
      <div
        role="img"
        aria-label={`Daily outreach volume, ${daily.length} days, peak ${max} communications`}
        style={{ display: 'flex', alignItems: 'flex-end', gap, height: H, padding: '0 2px' }}
        onMouseLeave={() => setHover(null)}
      >
        {daily.map((d, i) => (
          <div
            key={d.date}
            onMouseEnter={() => setHover(i)}
            style={{
              flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column',
              justifyContent: 'flex-end', cursor: d.total ? 'default' : 'default',
              background: hover === i ? 'rgba(29,37,103,0.05)' : 'transparent',
              borderRadius: 2,
            }}
          >
            {d.total === 0 ? (
              <div style={{ height: 2, background: '#eef0f5', borderRadius: 1 }} />
            ) : (
              AUDIENCES.map(a => d[a] > 0 && (
                <div key={a} style={{
                  height: `${(d[a] / max) * (H - 4)}px`,
                  background: AUDIENCE_COLORS[a],
                  opacity: hover === null || hover === i ? 1 : 0.55,
                  transition: 'opacity 0.12s',
                }} />
              ))
            )}
          </div>
        ))}
      </div>

      {/* Tooltip: date, total, and only the audiences actually present. */}
      {hover !== null && daily[hover] && (
        <div style={{
          position: 'absolute', top: -4, left: `${Math.min(80, (hover / Math.max(1, daily.length - 1)) * 100)}%`,
          transform: 'translateY(-100%)', background: '#0f1430', color: '#fff',
          borderRadius: 8, padding: '7px 10px', fontSize: 11.5, fontFamily: F,
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 3,
          boxShadow: '0 4px 14px rgba(15,20,48,0.28)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>
            {new Date(`${daily[hover].date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            {' · '}{fmtInt(daily[hover].total)} sent
          </div>
          {AUDIENCES.filter(a => daily[hover][a] > 0).map(a => (
            <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: 0.9 }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: AUDIENCE_COLORS[a] }} />
              {AUDIENCE_LABELS[a]}: {fmtInt(daily[hover][a])}
            </div>
          ))}
          {daily[hover].total === 0 && <div style={{ opacity: 0.75 }}>No communications</div>}
        </div>
      )}

      {/* Axis ends only - the chart is a shape, not a table. */}
      {daily.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#9ca3af', marginTop: 5 }}>
          <span>{new Date(`${daily[0].date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <span>{new Date(`${daily[daily.length - 1].date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
      )}
    </div>
  )
}

export default function OutreachAnalytics({ data, loading, error, audienceFilter = 'all', onChangeAudience }) {
  if (error) return null                       // the list still stands on its own
  if (loading && !data) {
    return (
      <div style={{ height: 168, borderRadius: 10, background: 'rgba(29,37,103,0.03)', marginBottom: 14 }} aria-hidden="true" />
    )
  }
  // Defensive by contract: the analytics are supplementary, so an unexpected
  // response shape must render NOTHING rather than take the Sent History audit
  // trail down with it. (Caught in review: a non-aggregate payload reached this
  // component and the missing `totals` blanked the whole page.)
  if (!data || !data.totals || !Array.isArray(data.daily)) return null

  const { totals, daily, delivery, truncated } = data
  const empty = !totals.total

  return (
    <div style={{ fontFamily: F, marginBottom: 14 }}>
      {/* KPI band - total first, then the audience split that sums to it. */}
      <div style={{
        display: 'grid', gap: 10, marginBottom: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))',
      }}>
        {/* All five cards use the app's canonical filter primitive. The total
            card restores the unfiltered audience view; each audience card
            applies the exact shared classification used to calculate it. */}
        <FilterKPICard
          label="Communications sent"
          value={fmtInt(totals.total)}
          sub="one per recipient"
          accent="chroma"
          active={audienceFilter === 'all'}
          ariaLabel="Show communications for all audiences"
          onClick={() => onChangeAudience?.('all')}
        />
        {AUDIENCES.map(a => (
          <FilterKPICard
            key={a}
            label={AUDIENCE_LABELS[a]}
            value={fmtInt(totals[a])}
            accent={AUDIENCE_ACCENTS[a]}
            sub={totals.total ? `${Math.round((totals[a] / totals.total) * 100)}%` : null}
            active={audienceFilter === a}
            ariaLabel={`${audienceFilter === a ? 'Clear' : 'Show'} ${AUDIENCE_LABELS[a]} audience filter`}
            onClick={() => onChangeAudience?.(audienceFilter === a ? 'all' : a)}
          />
        ))}
      </div>

      {/* Chart */}
      <div style={{ background: '#fff', border: '1px solid rgba(29,37,103,0.08)', borderRadius: 10, padding: '14px 16px 12px' }}>
        {empty ? (
          <div style={{ padding: '26px 0', textAlign: 'center', color: '#9ca3af', fontSize: 12.5 }}>
            No communications in this period.
          </div>
        ) : (
          <>
            <ActivityChart daily={daily} />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              marginTop: 10, paddingTop: 9, borderTop: '1px solid #f1f3f7',
              fontSize: 11, color: '#6b7280',
            }}>
              {AUDIENCES.map(a => (
                <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: AUDIENCE_COLORS[a] }} />
                  {AUDIENCE_LABELS[a]}
                </span>
              ))}
              {/* Delivery health rides here, and ONLY when the underlying
                  delivery events cover enough of the population to mean
                  something. Otherwise it is honestly absent. */}
              {delivery?.trustworthy && (
                <span style={{ marginLeft: 'auto', color: '#374151' }}>
                  {Math.round(delivery.rate * 100)}% delivered
                  {delivery.failed > 0 && <span style={{ color: '#b45309' }}> · {fmtInt(delivery.failed)} failed</span>}
                </span>
              )}
              {!delivery?.trustworthy && delivery?.failed > 0 && (
                <span style={{ marginLeft: 'auto', color: '#b45309' }}>{fmtInt(delivery.failed)} failed</span>
              )}
            </div>
          </>
        )}
        {truncated && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#b45309' }}>
            Showing the most recent 25,000 communications for this range; narrow the dates for exact totals.
          </div>
        )}
      </div>
    </div>
  )
}
