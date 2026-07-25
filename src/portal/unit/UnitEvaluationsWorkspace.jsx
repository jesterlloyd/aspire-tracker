// src/portal/unit/UnitEvaluationsWorkspace.jsx
//
// UL-EVAL: the activated Evaluations workspace for a Unit Leader. It replaces the pre-release
// placeholder now that released, unit-scoped, quantitative-only results exist.
//
// What a Unit Leader sees here, and ONLY this: released responses for the two approved
// instruments, unit-scoped and quantitative-only. No identity, no preceptor, no timestamps,
// no free text, no ids, no stable tokens, no moderation/release lifecycle, no CSV export.
// It performs NO lifecycle action — releasing and moderating are ASPIRE-staff-only and live
// in the staff Evaluation Dashboard, not here.
//
// SCOPE authority is the server's. The unit picker below only NARROWS the caller's already-
// authorized set; "All assigned units" omits the unit filter so the server returns exactly
// what the caller may see. The picker options come from the portal bootstrap's authorized
// unitKeys, NEVER from the response rows (which could otherwise leak a unit outside scope).
//
// PERFORMANCE: lazy-loaded (see UnitLeaderPortal). Each (timepoint, unit) selection issues
// exactly two parallel reads — one per instrument — and the endpoint returns that instrument's
// summary AND response list together, so the critical path is one round trip, not a summary
// call followed by a list call. Switching the selected instrument is in-memory (no network).
// Filter changes refetch; an unchanged filter never does. A request id guards against a stale
// response overwriting a newer one.

import { useEffect, useMemo, useRef, useState } from 'react'
import { SectionHeading, LoadingState, ErrorState } from './UnitLeaderChrome'
import { ALL_UNITS, getUnitEvaluations } from './unitLeaderApi'
import {
  APPROVED_UL_INSTRUMENTS, UL_TIMEPOINTS, instrumentLabel, instrumentMetricPaths,
  NO_APPROVED_METRICS_MESSAGE,
} from '../../lib/unitEvaluationDisplay'
import {
  EvalKpiCard, EvalInstrumentCard, EvalPicker, EvalMetricAverages, EvalQuantTable,
  EvalEmpty, EvalNoMetrics,
} from '../../components/evaluation/shared/EvalReporting'
import EvalQuantModal from '../../components/evaluation/shared/EvalQuantModal'

const INSTRUMENT_SLUGS = APPROVED_UL_INSTRUMENTS.map(i => i.slug)
const DEFAULT_INSTRUMENT = INSTRUMENT_SLUGS[0]
const DEFAULT_TIMEPOINT = 'post_rotation'

const timepointLabelOf = (tp) => UL_TIMEPOINTS.find(([v]) => v === tp)?.[1] || tp

export default function UnitEvaluationsWorkspace({ unitKeys = [] }) {
  const [instrument, setInstrument] = useState(DEFAULT_INSTRUMENT)
  const [timepoint, setTimepoint] = useState(DEFAULT_TIMEPOINT)
  const [localUnit, setLocalUnit] = useState(ALL_UNITS)

  // byInstrument maps each approved slug → its serialized payload for the CURRENT
  // (timepoint, unit). Instrument selection reads from here without any network call.
  const [byInstrument, setByInstrument] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [modalRow, setModalRow] = useState(null)
  const modalTriggerRef = useRef(null)
  const reqId = useRef(0)

  // One effect, keyed on the two filters that actually require a fetch. Two parallel reads
  // (one per instrument); each returns summary + list together. loading is flipped ON in the
  // filter handlers (below), so this effect never sets state synchronously — the repo forbids
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    const id = ++reqId.current
    const ac = new AbortController()
    let live = true
    Promise.all(INSTRUMENT_SLUGS.map(slug =>
      getUnitEvaluations({ instrument: slug, timepoint, unitKey: localUnit }, ac.signal)))
      .then(results => {
        if (!live || id !== reqId.current) return
        const anyAborted = results.some(r => r.error === 'aborted')
        if (anyAborted) return
        if (results.every(r => r.ok)) {
          const map = {}
          INSTRUMENT_SLUGS.forEach((slug, i) => { map[slug] = results[i].data })
          setByInstrument(map)
          setError(false)
        } else {
          setError(true)
        }
        setLoading(false)
      })
    return () => { live = false; ac.abort() }
  }, [timepoint, localUnit])

  const setTimepointFilter = (v) => { setLoading(true); setModalRow(null); setTimepoint(v) }
  const setUnitFilter = (v) => { setLoading(true); setModalRow(null); setLocalUnit(v) }
  const reload = () => { setLoading(true); reqId.current++; setTimepoint(t => t) }

  const payload = byInstrument?.[instrument] || null
  const metricPaths = instrumentMetricPaths(instrument)
  const responses = payload?.responses || []
  const averages = payload?.quantitative_averages || {}
  const hasMetrics = metricPaths.length > 0

  const unitOptions = useMemo(
    () => [[ALL_UNITS, 'All assigned units'], ...unitKeys.map(k => [k, k])],
    [unitKeys],
  )

  const openRow = (row) => {
    modalTriggerRef.current = typeof document !== 'undefined' ? document.activeElement : null
    setModalRow(row)
  }

  return (
    <>
      <SectionHeading focusKey="evaluations">Evaluations</SectionHeading>

      <p className="ptl-muted" style={{ marginTop: -4 }}>
        Results are released by the ASPIRE team after the rotation and include quantitative
        responses only. Responses are shown without names or identifying details; when only a
        few responses exist, treat them accordingly.
      </p>

      {/* Instrument availability: exactly the two approved instruments, each with its released
          count for the current filter. Selecting one is in-memory. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0 4px' }}>
        {APPROVED_UL_INSTRUMENTS.map(inst => (
          <EvalInstrumentCard
            key={inst.slug}
            label={inst.label}
            count={byInstrument?.[inst.slug]?.released_response_count ?? 0}
            active={instrument === inst.slug}
            onClick={() => setInstrument(inst.slug)}
          />
        ))}
      </div>

      {/* Filters. The unit picker's options are the authorized bootstrap units, never the
          response rows. */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', margin: '10px 0 16px' }}>
        <EvalPicker
          label="Timepoint" value={timepoint} onChange={setTimepointFilter}
          options={UL_TIMEPOINTS} ariaLabel="Filter by timepoint"
        />
        <EvalPicker
          label="Unit" value={localUnit} onChange={setUnitFilter}
          options={unitOptions} ariaLabel="Filter by assigned unit"
        />
      </div>

      {loading ? (
        <LoadingState label="Loading released evaluations" />
      ) : error ? (
        <ErrorState detail="Released evaluations could not be loaded just now." onRetry={reload} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <EvalKpiCard
              value={payload?.released_response_count ?? 0}
              label="Released responses"
              sub={`${instrumentLabel(instrument)} · ${timepointLabelOf(timepoint)}`}
            />
            <EvalKpiCard
              value={metricPaths.length}
              label="Approved metrics"
              sub="Quantitative only"
            />
          </div>

          {!hasMetrics ? (
            <EvalNoMetrics message={NO_APPROVED_METRICS_MESSAGE} />
          ) : responses.length === 0 ? (
            <EvalEmpty
              title="No released responses for this selection"
              detail="When ASPIRE releases responses for this instrument, timepoint, and unit, they appear here."
            />
          ) : (
            <>
              <h3 className="ptl-card-title" style={{ margin: '4px 0 8px' }}>Quantitative averages</h3>
              <EvalMetricAverages averages={averages} />

              <h3 className="ptl-card-title" style={{ margin: '20px 0 8px' }}>Individual responses</h3>
              <EvalQuantTable responses={responses} metricPaths={metricPaths} onOpen={openRow} />
            </>
          )}
        </>
      )}

      {modalRow && (
        <EvalQuantModal
          response={modalRow}
          instrumentSlug={instrument}
          timepointLabel={timepointLabelOf(timepoint)}
          metricPaths={metricPaths}
          returnFocusRef={modalTriggerRef}
          onClose={() => setModalRow(null)}
        />
      )}
    </>
  )
}
