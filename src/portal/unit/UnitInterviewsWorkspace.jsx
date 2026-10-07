// NGRP-INTERVIEWS-1 Phase 3 (Owner, 2026-10-05): the Unit Leader Portal's Interviews tab. "Copy the
// table from internship - calendar on top, results table at the bottom, opens to the rubric.
// Interviews today tiles at the very top." Built from the internship Interviews tab's own parts:
// the Interviews Today tiles (OnCampusNow, shown only on a day with interviews), the KPI filter
// cards (FilterKPICard) and the worklist (`ir-worklist` rows), each row opening the NGRP rubric book.
//
// ONE-CALENDAR-1 (Owner, 2026-10-06): the calendar is NOT here. The unit's one calendar is on At a
// Glance (Residency view), where times are opened, blocked and removed; this tab keeps the tiles,
// the results and the rubric.
//
// A unit leader sees only the applicants Talent Acquisition paired with their unit, and only their
// own rubric. Applicants who ranked the unit first show as a count, never by name. An Owner or Admin
// previewing the portal sees it all read-only (the server refuses their writes too).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import OnCampusNow from '../../components/oncampus/OnCampusNow'
import { dayOf, timeOf } from '../../lib/ngrp/interviewScheduleModel'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { INTERVIEW_MODE_LABELS } from '../../lib/ngrp/ngrpStates'
import { pacificDateString } from '../../lib/birthdayEligibility'
import UnitStudentAvatar from './UnitStudentAvatar'
import NgrpRubricBook from './NgrpRubricBook'
import UnitInterviewResults from './UnitInterviewResults'
import { fetchUnitInterviews } from './unitInterviewsApi'

const PT = { timeZone: 'America/Los_Angeles' }
const full = p => `${p.preferred_first_name || p.first_name} ${p.last_name}`.trim()

export default function UnitInterviewsWorkspace({ unitKey = null, toast = null }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  // ONE-CALENDAR-2: At a Glance's Residency view opens a rubric here through ?candidate=.
  const [searchParams] = useSearchParams()
  const [openId, setOpenId] = useState(() => searchParams.get('candidate') || null)
  const today = pacificDateString()

  const load = useCallback(async () => {
    const r = await fetchUnitInterviews(unitKey)
    if (!r.ok) { setStatus('error'); return }
    setData(r.data); setStatus('ready')
  }, [unitKey])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])
  useRegisterPortalRefresh(load)

  const preview = data?.preview === true
  const interviewees = useMemo(() => data?.interviewees || [], [data])
  const slots = useMemo(() => data?.slots || [], [data])
  const byCandidate = useMemo(() => new Map(interviewees.map(i => [i.candidate_id, i])), [interviewees])

  if (openId) {
    return <NgrpRubricBook candidateId={openId} readOnly={preview} toast={toast} onBack={() => { setOpenId(null); load() }} />
  }
  if (status === 'loading') return <div className="ptl-card" role="status">Loading interviews…</div>
  if (status === 'error') return <div className="ptl-card">Interviews could not be loaded. Use Refresh to try again.</div>

  // ── Interviews Today ──
  const todays = slots.filter(s => s.booked && dayOf(s.slot_at) === today)
  const tiles = todays.map(s => {
    const p = s.booked_candidate_id ? byCandidate.get(s.booked_candidate_id) : null
    return {
      key: s.id, name: p ? full(p) : 'Booked', subLabel: `${s.unit_key} · ${timeOf(s.slot_at)}`,
      avatar: <UnitStudentAvatar url={null} name={p ? full(p) : 'Booked'} size={34} />,
      badge: p?.interview_mode ? { label: INTERVIEW_MODE_LABELS[p.interview_mode], tone: 'day' } : null,
      statusText: p?.my_rubric?.status === 'completed' ? 'Scored' : 'Open rubric',
      onClick: p ? () => setOpenId(p.candidate_id) : undefined,
      ariaLabel: p ? `Open the rubric for ${full(p)}` : 'Booked interview',
    }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--aspire-gap-card, 16px)' }}>
      {preview && <p className="ptl-notice ptl-notice-warn" role="status">Preview: you see this tab as a unit leader does. Nothing can be saved from a preview.</p>}
      <OnCampusNow title="Interviews Today" sub={`${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...PT })} · ${tiles.length} scheduled`} rows={tiles} flush />

      <UnitInterviewResults interviewees={interviewees} slots={slots} rankedFirst={data?.rankedFirst || []}
        note="Interview times are opened on At a Glance's calendar, in its Residency view." onOpen={setOpenId} />

    </div>
  )
}
