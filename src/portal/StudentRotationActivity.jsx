import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Pencil, Trash2, X } from 'lucide-react'
import {
  CanonicalCalendarLayout,
  CanonicalCalendarSidebar,
  CanonicalCalendarTodayPanel,
  CanonicalCalendarNav,
  CanonicalCalendarMonthTitle,
  CanonicalWeekdayHeader,
  CanonicalMonthCell,
  CanonicalActivityChip,
} from '../components/shared/CanonicalCalendarFoundation'
import { pacificToday, monthGrid, monthLabel } from '../lib/rotationCalendarDates'
import { getUsHolidaysForRange } from '../lib/usHolidays'
import { firstNameOf } from '../lib/masthead'
import { portalShiftStatus } from '../lib/portalShiftStatus'
import {
  reconcileStudentRotationActivity,
  groupStudentActivityByDate,
  fetchMyRotationActivity,
  saveMyPlannedShift,
  cancelMyPlannedShift,
} from '../lib/studentRotationActivity'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatLongDate(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number)
  if (!y || !m || !d) return 'Selected day'
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function miniSummary(count) {
  if (count === 0) return 'No rotation activity'
  return `${count} calendar ${count === 1 ? 'item' : 'items'}`
}

function StudentMiniCalendar({ cells, markedDates, selectedDate, today, onSelectDate }) {
  return (
    <div>
      <div className="canonical-calendar-kicker">Mini Calendar</div>
      <div className="ptl-cal-mini-grid" role="grid" aria-label="Mini rotation activity calendar">
        {DOW.map(day => <div key={day} className="ptl-cal-mini-dow" role="columnheader">{day[0]}</div>)}
        {cells.map(({ ymd, inMonth }) => (
          <button
            key={ymd}
            type="button"
            role="gridcell"
            className={[
              'ptl-cal-mini-cell',
              inMonth ? '' : 'ptl-cal-mini-out',
              ymd === today ? 'ptl-cal-mini-today' : '',
              ymd === selectedDate ? 'ptl-cal-mini-selected' : '',
            ].filter(Boolean).join(' ')}
            aria-label={`${ymd}, ${markedDates.has(ymd) ? 'calendar activity' : 'no calendar activity'}`}
            onClick={() => onSelectDate(ymd)}
          >
            <span>{Number(ymd.slice(8, 10))}</span>
            {markedDates.has(ymd) && <i aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  )
}

function PlanDialog({ form, preceptors, busy, error, onChange, onSave, onClose }) {
  if (!form) return null
  const hasOptions = preceptors.length > 0
  return (
    <>
      <div className="ptl-drawer-backdrop" onMouseDown={onClose} />
      <section className="ptl-plan-modal" role="dialog" aria-modal="true" aria-labelledby="ptl-plan-title">
        <div className="ptl-drawer-head">
          <h2 className="ptl-drawer-title" id="ptl-plan-title">{form.id ? 'Edit planned shift' : 'Add planned shift'}</h2>
          <button type="button" className="ptl-icon-btn" onClick={onClose} aria-label="Close planned shift form"><X size={18} /></button>
        </div>
        <div className="ptl-plan-body">
          <p className="ptl-muted ptl-small">Planning marks your calendar only. Log the actual shift through the Shift Log after you complete it.</p>
          <label className="ptl-plan-field">Date
            <input type="date" value={form.shift_date} onChange={event => onChange({ ...form, shift_date: event.target.value })} />
          </label>
          <label className="ptl-plan-field">Preceptor
            {hasOptions ? (
              <select value={form.preceptor_name} onChange={event => onChange({ ...form, preceptor_name: event.target.value })}>
                <option value="">Select a preceptor</option>
                {preceptors.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            ) : (
              <input type="text" maxLength={200} value={form.preceptor_name}
                onChange={event => onChange({ ...form, preceptor_name: event.target.value })}
                placeholder="Preceptor name" />
            )}
          </label>
          {error && <div className="ptl-form-error" role="status">{error}</div>}
        </div>
        <div className="ptl-drawer-foot">
          <button type="button" className="ptl-slh-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ptl-btn ptl-btn-sm" onClick={onSave} disabled={busy || !form.shift_date || !form.preceptor_name.trim()}>
            {busy ? 'Saving…' : 'Save planned shift'}
          </button>
        </div>
      </section>
    </>
  )
}

export default function StudentRotationActivity({ student, logs = [], readOnly = false, onManageLogs }) {
  const today = pacificToday()
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const [selectedDate, setSelectedDate] = useState(today)
  const [resource, setResource] = useState({ plans: [], rotations: {}, preceptors: {} })
  const [loadError, setLoadError] = useState(null)
  const [form, setForm] = useState(null)
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const loadPlans = useCallback(async () => {
    if (readOnly) {
      setResource({ plans: [], rotations: {}, preceptors: {} })
      setLoadError(null)
      return
    }
    const result = await fetchMyRotationActivity()
    if (!result.ok) {
      setLoadError(result.error === 'migration_required'
        ? 'Shift planning is not switched on yet. Logged shifts and holidays are still shown.'
        : 'Planned shifts and school blackout dates could not be loaded right now.')
      return
    }
    setResource({
      plans: result.plans || [],
      rotations: result.rotations || {},
      preceptors: result.preceptors || {},
    })
    setLoadError(null)
  }, [readOnly])

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) loadPlans() })
    return () => { cancelled = true }
  }, [loadPlans, student?.id])

  const plans = useMemo(
    () => resource.plans.filter(plan => plan.student_id === student?.id),
    [resource.plans, student?.id],
  )
  const activity = useMemo(() => reconcileStudentRotationActivity(logs, plans), [logs, plans])
  const byDay = useMemo(() => groupStudentActivityByDate(activity), [activity])
  const cells = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor])
  const rotation = resource.rotations[student?.id] || { blackout_dates: [] }
  const blackoutDates = useMemo(() => new Set(rotation.blackout_dates || []), [rotation.blackout_dates])
  const holidays = useMemo(
    () => getUsHolidaysForRange(cells[0].ymd, cells[cells.length - 1].ymd),
    [cells],
  )
  const holidaysByDay = useMemo(() => {
    const map = new Map()
    for (const holiday of holidays) {
      const list = map.get(holiday.date) || []
      list.push(holiday)
      map.set(holiday.date, list)
    }
    return map
  }, [holidays])
  const markedDates = useMemo(() => new Set([
    ...byDay.keys(), ...blackoutDates, ...holidaysByDay.keys(),
  ]), [byDay, blackoutDates, holidaysByDay])
  const selectedItems = byDay.get(selectedDate) || []
  const selectedPlan = selectedItems.find(item => item.kind === 'planned') || null
  const selectedLog = selectedItems.find(item => item.kind === 'logged') || null
  const selectedHolidays = holidaysByDay.get(selectedDate) || []
  const isBlackout = blackoutDates.has(selectedDate)
  const preceptors = useMemo(() => {
    const names = [...(resource.preceptors[student?.id] || [])]
    const fallback = String(student?.preceptor_name || '').trim()
    if (fallback && !names.includes(fallback)) names.unshift(fallback)
    return names
  }, [resource.preceptors, student?.id, student?.preceptor_name])

  const step = delta => {
    const next = new Date(Date.UTC(cursor.y, cursor.m + delta, 1))
    setCursor({ y: next.getUTCFullYear(), m: next.getUTCMonth() })
  }
  const goToday = () => {
    setSelectedDate(today)
    setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })
  }
  const openPlan = (date, plan = null) => {
    if (readOnly) return
    setSelectedDate(date)
    setCancelConfirm(false)
    setFormError(null)
    setForm({
      id: plan?.id || null,
      shift_date: plan?.shift_date || date,
      preceptor_name: plan?.preceptor_name || preceptors[0] || '',
    })
  }
  const savePlan = async () => {
    if (!form || !student?.id) return
    setBusy(true); setFormError(null)
    const result = await saveMyPlannedShift({
      planId: form.id,
      studentId: student.id,
      shiftDate: form.shift_date,
      preceptorName: form.preceptor_name.trim(),
    })
    setBusy(false)
    if (!result.ok) {
      const copy = {
        actual_shift_exists: 'An actual shift is already logged for that date.',
        date_already_planned: 'You already have a planned shift on that date.',
        invalid_field: 'Choose a valid date and preceptor.',
      }
      setFormError(copy[result.error] || 'The planned shift could not be saved. Please try again.')
      return
    }
    setSelectedDate(form.shift_date)
    setForm(null)
    await loadPlans()
  }
  const cancelPlan = async () => {
    if (!selectedPlan) return
    if (!cancelConfirm) { setCancelConfirm(true); return }
    setBusy(true)
    const result = await cancelMyPlannedShift(selectedPlan.id)
    setBusy(false)
    if (!result.ok) {
      setLoadError('The planned shift could not be removed. Please try again.')
      return
    }
    setCancelConfirm(false)
    await loadPlans()
  }

  const sidebarCount = selectedItems.length + selectedHolidays.length + (isBlackout ? 1 : 0)
  const sidebar = (
    <CanonicalCalendarSidebar>
      <StudentMiniCalendar cells={cells} markedDates={markedDates} selectedDate={selectedDate} today={today} onSelectDate={setSelectedDate} />
      <CanonicalCalendarTodayPanel
        dateLabel={formatLongDate(selectedDate)}
        summary={miniSummary(sidebarCount)}
        emptyLabel="No shift or calendar note for this day."
      >
        <div className="ptl-student-cal-day">
          {selectedLog && (
            <div className="ptl-student-cal-detail ptl-student-cal-detail-logged">
              <b>Logged shift</b>
              <span>{selectedLog.preceptor_name ? `With ${selectedLog.preceptor_name}` : 'Preceptor not listed'}</span>
              <span>{portalShiftStatus(selectedLog).label}{selectedLog.total_hours != null ? ` · ${selectedLog.total_hours} hours` : ''}</span>
              {!readOnly && <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={onManageLogs}>View or edit log</button>}
            </div>
          )}
          {selectedPlan && (
            <div className="ptl-student-cal-detail ptl-student-cal-detail-planned">
              <b>Planned shift</b>
              <span>With {selectedPlan.preceptor_name}</span>
              {!readOnly && (
                <div className="ptl-student-cal-actions">
                  <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={() => openPlan(selectedDate, selectedPlan)}><Pencil size={13} /> Edit</button>
                  <button type="button" className="ptl-inline-link ptl-inline-btn ptl-plan-remove" onClick={cancelPlan} disabled={busy}><Trash2 size={13} /> {cancelConfirm ? 'Confirm remove' : 'Remove'}</button>
                </div>
              )}
            </div>
          )}
          {selectedHolidays.map(holiday => (
            <div className="ptl-student-cal-detail ptl-student-cal-detail-holiday" key={`${holiday.date}-${holiday.name}`}>
              <b>{holiday.name}</b><span>U.S. federal holiday</span>
            </div>
          ))}
          {isBlackout && (
            <div className="ptl-student-cal-detail ptl-student-cal-detail-blackout">
              <b>School blackout date</b><span>Provided by your clinical placement coordinator</span>
            </div>
          )}
          {!selectedLog && !selectedPlan && !readOnly && (
            <button type="button" className="ptl-btn ptl-btn-sm ptl-student-cal-add-btn" onClick={() => openPlan(selectedDate)}>
              <CalendarPlus size={15} /> Add Shift
            </button>
          )}
        </div>
      </CanonicalCalendarTodayPanel>
    </CanonicalCalendarSidebar>
  )

  const toolbar = (
    <div className="ptl-student-cal-toolbar">
      <div><CanonicalCalendarNav onPrev={() => step(-1)} onNext={() => step(1)} onToday={goToday} prevAriaLabel="Previous month" nextAriaLabel="Next month" /></div>
      <CanonicalCalendarMonthTitle ariaLive="polite">{monthLabel(cursor.y, cursor.m)}</CanonicalCalendarMonthTitle>
      <div aria-hidden="true" />
    </div>
  )

  return (
    <>
      <CanonicalCalendarLayout
        title="Rotation Activity"
        description="Plan upcoming shifts and see completed shift logs in one calendar."
        labelledBy="student-rotation-activity-title"
        sidebar={sidebar}
        toolbar={toolbar}
        footer={<p className="ptl-muted ptl-student-cal-foot">School blackout dates and federal holidays are informational. They do not prevent planning or logging a shift.</p>}
      >
        {loadError && <div className="ptl-student-cal-notice" role="status">{loadError}</div>}
        <div role="grid" aria-label={`Rotation Activity for ${monthLabel(cursor.y, cursor.m)}`}>
          <CanonicalWeekdayHeader days={DOW} />
          <div className="ptl-student-cal-grid">
            {cells.map(({ ymd, inMonth }) => {
              if (!inMonth) return <CanonicalMonthCell key={ymd} isOtherMonth />
              const items = byDay.get(ymd) || []
              const log = items.find(item => item.kind === 'logged') || null
              const plan = items.find(item => item.kind === 'planned') || null
              const dayHolidays = holidaysByDay.get(ymd) || []
              const blackout = blackoutDates.has(ymd)
              const empty = !log && !plan
              const labelParts = [ymd]
              if (log) labelParts.push('logged shift')
              if (plan) labelParts.push('planned shift')
              if (blackout) labelParts.push('school blackout date')
              if (dayHolidays.length) labelParts.push(...dayHolidays.map(item => item.name))
              if (empty && !readOnly) labelParts.push('Add Shift')
              return (
                <CanonicalMonthCell
                  key={ymd}
                  day={Number(ymd.slice(8, 10))}
                  isToday={ymd === today}
                  isSelected={ymd === selectedDate}
                  isFuture={ymd > today}
                  ariaLabel={labelParts.join(', ')}
                  onClick={() => {
                    setSelectedDate(ymd)
                    setCancelConfirm(false)
                    if (empty && !readOnly) openPlan(ymd)
                  }}
                >
                  {log && (
                    <CanonicalActivityChip
                      label="Shift"
                      live={log.lifecycle_state === 'in_progress'}
                      secondary={firstNameOf(log.preceptor_name) ? `with ${firstNameOf(log.preceptor_name)}` : null}
                      ariaLabel={`Logged shift${log.preceptor_name ? ` with ${log.preceptor_name}` : ''}`}
                    />
                  )}
                  {plan && <span className="ptl-student-cal-plan">Shift {firstNameOf(plan.preceptor_name) ? `with ${firstNameOf(plan.preceptor_name)}` : ''}</span>}
                  {dayHolidays.slice(0, 1).map(holiday => <span className="ptl-student-cal-holiday" key={holiday.name}>{holiday.name}</span>)}
                  {blackout && <span className="ptl-student-cal-blackout">School blackout</span>}
                  {empty && !readOnly && <span className="ptl-student-cal-add"><CalendarPlus size={11} /> Add Shift</span>}
                </CanonicalMonthCell>
              )
            })}
          </div>
        </div>
        <div className="ptl-cal-legend">
          <span><span className="ptl-cal-chip" aria-hidden="true">Shift</span> Logged shift</span>
          <span><span className="ptl-student-cal-plan" aria-hidden="true">Shift</span> Planned shift</span>
          <span><span className="ptl-student-cal-holiday" aria-hidden="true">Holiday</span> Federal holiday</span>
          <span><span className="ptl-student-cal-blackout" aria-hidden="true">Blackout</span> School blackout</span>
        </div>
      </CanonicalCalendarLayout>
      <PlanDialog form={form} preceptors={preceptors} busy={busy} error={formError} onChange={setForm} onSave={savePlan} onClose={() => setForm(null)} />
    </>
  )
}
