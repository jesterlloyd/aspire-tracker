// CONNECT-AUTOMATION - Automation control + health surface (Connect > Automation subtab).
//
// One unified card per scheduled automation answers both questions at once: "is it allowed to run?"
// (the toggle / control state) and "what happened last time?" (the health badge + last run). A single
// canonical catalog (AUTOMATION_CARDS) drives order AND data, so controls and health never drift.
//
//   • Global automations (Teams, Interview, Coordinator, Clock-Out) toggle via /api/automation-settings.
//   • Midpoint stays cohort-scoped on cohorts.midpoint_checkin_automation_enabled (its own source).
//   • Health comes from cron_runs via /api/automation-runs (Owner/Admin; the table is RLS-locked).
//
// Owner/Admin only. Message-level history is intentionally NOT here - it lives in Outreach > Sent History.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import Toggle from '../ui/Toggle'
import AutomationEmailPreviewDrawer from './AutomationEmailPreviewDrawer'
import { getPreviewFixture } from '../../lib/notifications/previewFixtures'
import { automationById, isRunStale } from '../../lib/automationCatalog'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// ── Canonical catalog - the SINGLE source of truth for card order, identity, schedule, scope, and
// description. Order: interview-related reminders together, midpoint (cohort-scoped) in the middle,
// then the operational digest/clock-out automations. cron_name maps to cron_runs; automation_key
// maps to automation_settings (null for midpoint, which uses the cohort setting instead). ──
const AUTOMATION_CARDS = [
  { id: 'teams_invite_reminders', title: 'Teams Invite Reminders',
    cron_name: 'teams-invite-reminders', automation_key: 'teams_invite_reminders',
    scope: 'Global', schedule: 'Weekdays · 8:00 AM PT', hasGlobalSetting: true,
    desc: 'Reminds interviewers and candidates to accept the Microsoft Teams interview invite.' },
  { id: 'interview_reminders', title: 'Interview Reminders',
    cron_name: 'interview-reminders', automation_key: 'interview_reminders',
    scope: 'Global', schedule: 'Daily · 10:00 AM PT', hasGlobalSetting: true,
    desc: 'Sends candidates a reminder ahead of their scheduled interview.' },
  { id: 'student_birthday_greetings', title: 'Student Birthday Greetings',
    cron_name: 'student-birthday-greetings', automation_key: 'student_birthday_greetings',
    scope: 'All cohorts', schedule: 'Daily · 9:00 AM PT', hasGlobalSetting: true,
    desc: 'Sends a birthday greeting to students who are on an active rotation, once per year.' },
  { id: 'evaluation_reminders', title: 'Evaluation & Survey Reminders',
    cron_name: 'evaluation-reminders', automation_key: 'evaluation_reminders',
    scope: 'All cohorts', schedule: 'Weekly · Tuesdays 9:00 AM PT', hasGlobalSetting: true,
    desc: 'Reminds students and preceptors about incomplete evaluations and surveys at 7, 14, and 21 days. Stops as soon as the survey is completed.' },
  { id: 'midpoint_checkin', title: 'Midpoint Check-In Auto-send',
    cron_name: 'midpoint-checkin', automation_key: null,
    scope: 'Active cohort only', schedule: 'Daily · 8:00 AM PT', hasMidpointSetting: true,
    desc: 'Sends check-in emails to Active Rotation students once they reach 50% of required hours.' },
  { id: 'coordinator_weekly_digest', title: 'Coordinator Weekly Digest',
    cron_name: 'coordinator-weekly-digest', automation_key: 'coordinator_weekly_digest',
    scope: 'Global', schedule: 'Fridays · 9:00 AM PT', hasGlobalSetting: true,
    desc: 'Weekly student-activity summary emailed to school coordinators.' },
  { id: 'clockout_reminders', title: 'Clock-Out Reminders',
    cron_name: 'clockout-reminders-scheduled', automation_key: 'clockout_reminders',
    scope: 'Global', schedule: 'Hourly', hasGlobalSetting: true,
    desc: 'Hourly nudge for students with an open shift that may be overdue to clock out.' },
]

// Friendly labels for the numeric counts crons record in cron_runs.details (counts only - no PII).
const COUNT_LABELS = {
  sent_count: 'Sent', fired_count: 'Sent',
  skipped_count: 'Skipped', skipped_no_email_count: 'No email on file',
  skipped_recently_reminded_count: 'Recently reminded',
  failed_count: 'Failed', error_count: 'Errors',
  eligible_count: 'Eligible', checked_count: 'Checked',
  event_count: 'Events', coordinators_resolved: 'Coordinators',
  cohort_count: 'Cohorts', overdue_count: 'Overdue', open_checked: 'Open shifts',
  would_send_count: 'Would send',
  // EVALUATION-REMINDERS-1 counts.
  claimed_count: 'Claimed', deliverable_count: 'Deliverable',
  completed_suppressed_count: 'Completed', expired_suppressed_count: 'Window closed',
  missing_email_count: 'No usable email', duplicate_suppressed_count: 'Already reminded',
  send_suppressed_count: 'Suppressed at send', capped_count: 'Deferred to next run',
  scanned_count: 'Scanned',
}
const ALARM_KEYS = new Set(['failed_count', 'error_count'])
const SENT_KEYS = ['sent_count', 'fired_count']

function fmtDateTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return null
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return '<1s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

// ── Resolve one job's latest run into a health display state. `nowIso` is the server clock (avoids
// an impure render-time Date and keeps "stale running" honest across client clock skew). ──
function resolveHealth(run, nowIso, paused, cadence) {
  // Paused is authoritative (setting disabled, or fallback skipped_disabled evidence) and wins over
  // run-derived status - a paused automation must never read as failed or stale.
  if (paused) return { tone: 'paused', label: 'Paused', caption: 'Automatic sends are paused.' }
  if (!run) return { tone: 'neutral', label: 'Never run', caption: 'No recorded runs yet.' }
  const { status, started_at, details } = run
  if (status === 'running') {
    const ageMs = new Date(nowIso).getTime() - new Date(started_at).getTime()
    if (Number.isFinite(ageMs) && ageMs > 2 * 60 * 60 * 1000) {
      return { tone: 'error', label: 'Did not finish', caption: 'Started but never reported completion.' }
    }
    return { tone: 'running', label: 'Running', caption: 'In progress…' }
  }
  if (status === 'error') return { tone: 'error', label: 'Error', caption: null }
  // AUTOMATION-MONITORING-1: a successful run does not stay reassuring forever.
  // An automation that silently stopped executing used to read Healthy
  // indefinitely off a weeks-old run. Each automation carries its own freshness
  // budget, so an hourly job and a weekly one are not judged by one timeout.
  if (cadence && isRunStale({ lastRunIso: started_at, maxAgeHours: cadence.maxAgeHours, nowIso })) {
    return {
      tone: 'warn', label: 'No recent runs',
      caption: 'Last run is older than this automation\u2019s normal schedule.',
    }
  }
  // success
  const sent = SENT_KEYS.map(k => details?.[k]).find(v => typeof v === 'number')
  if (typeof sent === 'number' && sent === 0) {
    return { tone: 'success', label: 'Healthy', caption: 'Ran successfully · nothing to send.' }
  }
  return { tone: 'success', label: 'Healthy', caption: null }
}

function chipsFromDetails(details) {
  if (!details || typeof details !== 'object') return []
  return Object.entries(COUNT_LABELS)
    .filter(([k]) => typeof details[k] === 'number')
    // De-dupe the two "Sent" aliases: prefer sent_count, fall back to fired_count.
    .filter(([k]) => !(k === 'fired_count' && typeof details.sent_count === 'number'))
    .map(([k]) => ({ key: k, label: COUNT_LABELS[k], value: details[k], alarm: ALARM_KEYS.has(k) && details[k] > 0 }))
}

const HEALTH_TONES = {
  success: { dot: '#2F7D5C', bg: '#eef6ee', color: '#2F7D5C', border: '#cfe6d6' },
  error:   { dot: '#b91c1c', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
  running: { dot: '#b45309', bg: '#fff7ed', color: '#b45309', border: '#fed7aa' },
  // AUTOMATION-MONITORING-1: "No recent runs" - a monitoring concern, not a
  // failure, so amber rather than the error red.
  warn:    { dot: '#92400e', bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
  neutral: { dot: '#9ca3af', bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
  paused:  { dot: '#94a3b8', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
}

// ── Midpoint cohort setting (cohorts.midpoint_checkin_automation_enabled). Exact same read/write
// behavior as before - lifted into a hook so the midpoint control + health can share one card. ──
function useMidpointSetting(cohortId, toast) {
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!cohortId) { setLoaded(false); return } // eslint-disable-line react-hooks/set-state-in-effect
    let cancelled = false
    setLoaded(false)
    supabase
      .from('cohorts')
      .select('midpoint_checkin_automation_enabled')
      .eq('id', cohortId)
      .single()
      .then(({ data }) => {
        if (cancelled) return
        setEnabled(!!data?.midpoint_checkin_automation_enabled)
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [cohortId])

  const toggle = async (val) => {
    if (saving || !cohortId) return
    setSaving(true)
    const { error } = await supabase
      .from('cohorts')
      .update({ midpoint_checkin_automation_enabled: val })
      .eq('id', cohortId)
    if (error) {
      toast?.error?.('Failed to update automation setting')
    } else {
      setEnabled(val)
      toast?.success?.(val ? 'Midpoint auto-send enabled' : 'Midpoint auto-send paused')
    }
    setSaving(false)
  }

  return { enabled, loaded, saving, toggle }
}

// ── One unified card: control (toggle + On/Off/Saving) AND health (badge + last run + chips). ──
function AutomationCard({ card, run, health, ctrl, onPreview, canPreview }) {
  const tone = HEALTH_TONES[health.tone] || HEALTH_TONES.neutral
  const chips = chipsFromDetails(run?.details)
  const duration = run && fmtDuration(run.started_at, run.finished_at)
  const dryRun = run?.details && typeof run.details.dry_run === 'boolean' ? run.details.dry_run : null
  const description = ctrl.description || card.desc
  const strong = { color: '#374151', fontWeight: 600 }

  return (
    <div style={{ flex: '1 1 300px', minWidth: 0, maxWidth: 480, background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14, padding: '16px 18px', fontFamily: F }}>
      {/* Header: title + health badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{card.title}</div>
          <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>{card.schedule} · {card.scope}</div>
        </div>
        {/* Right cluster: Preview eye + health badge (badge stays the rightmost status anchor). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {/* The eye is CAPABILITY-DRIVEN: a card with no registered preview
              fixture must not advertise one. Student Birthday Greetings shipped
              without a fixture and the icon opened "No preview available",
              which is an affordance promising something that does not exist. */}
          {canPreview && (
          <button
            onClick={onPreview}
            title="Preview email"
            aria-label="Preview email"
            style={{
              width: 44, height: 44, flexShrink: 0, display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', background: 'none', border: 'none', borderRadius: 8,
              cursor: 'pointer', color: '#9ca3af', padding: 0,
            }}
          >
            <Eye size={16} />
          </button>
          )}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
            fontWeight: 700, padding: '3px 9px', borderRadius: 20,
            background: tone.bg, color: tone.color, border: `1px solid ${tone.border}`,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot }} />
            {health.label}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8, lineHeight: 1.45 }}>{description}</div>

      {/* Control row: toggle + On/Off/Saving (or a Retry when global settings are unavailable). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1efe9' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Scheduled sends</span>
        {ctrl.unavailable ? (
          <span style={{ fontSize: 11.5, color: '#b91c1c' }}>
            Controls unavailable ·{' '}
            <button onClick={ctrl.onRetry} style={{ background: 'none', border: 'none', color: NAVY, fontWeight: 700, cursor: 'pointer', fontFamily: F, fontSize: 11.5, padding: 0, textDecoration: 'underline' }}>Retry</button>
          </span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Toggle checked={ctrl.enabled} onChange={ctrl.onToggle} disabled={ctrl.toggleDisabled} size="md" ariaLabel={ctrl.ariaLabel} />
            <span style={{ fontSize: 11, fontWeight: 600, minWidth: 44, textAlign: 'right', color: ctrl.saving ? '#b45309' : ctrl.enabled ? '#2F7D5C' : '#9ca3af' }}>
              {ctrl.saving ? 'Saving…' : !ctrl.loaded ? 'Loading…' : ctrl.enabled ? 'On' : 'Off'}
            </span>
          </div>
        )}
      </div>
      {ctrl.note && <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 6 }}>{ctrl.note}</div>}

      {/* Last run / duration / dry-run / updated */}
      <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
        <span>Last run: <strong style={strong}>{run ? fmtDateTime(run.started_at) : (health.loading ? '…' : '-')}</strong></span>
        {duration && <span>Duration: <strong style={strong}>{duration}</strong></span>}
        {dryRun !== null && <span style={{ fontWeight: 700, color: dryRun ? '#b45309' : '#2F7D5C' }}>{dryRun ? 'Dry run' : 'Live'}</span>}
        {ctrl.updatedAt && <span>Updated: <strong style={strong}>{new Date(ctrl.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong></span>}
      </div>

      {/* AUTOMATION-MONITORING-1: these counters describe the LATEST RUN only,
          never a running total. Unlabelled, "Sent: 0" read as "this automation
          has never sent anything" when it means "the most recent run sent
          zero" - two very different facts about a healthy automation. */}
      {chips.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
            textTransform: 'uppercase', color: '#9ca3af', marginBottom: 5 }}>
            Last run metrics
          </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map(c => (
            <span key={c.key} style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 7,
              background: c.alarm ? '#fef2f2' : '#f3f4f6',
              color: c.alarm ? '#b91c1c' : '#4b5563',
              border: `1px solid ${c.alarm ? '#fecaca' : '#e5e7eb'}`,
            }}>{c.label}: {c.value}</span>
          ))}
        </div>
        </div>
      )}

      {health.caption && (
        <div style={{ fontSize: 11.5, color: health.tone === 'error' ? '#b91c1c' : '#9ca3af', marginTop: 10 }}>
          {health.caption}
        </div>
      )}

      {run?.status === 'error' && run?.error_text && (
        <div style={{
          marginTop: 8, fontSize: 11.5, color: '#b91c1c', background: '#fef2f2',
          border: '1px solid #fecaca', borderRadius: 8, padding: '7px 9px',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{run.error_text}</div>
      )}

      {/* Footer: control state. Shown once the control state is known (and not unavailable). */}
      {ctrl.loaded && !ctrl.unavailable && (
        <div style={{ fontSize: 11.5, color: ctrl.enabled ? '#2F7D5C' : '#475569', marginTop: 10 }}>
          {ctrl.enabled
            ? 'Active: scheduled automatic sends are enabled.'
            : 'Paused: no automatic sends. Manual and preview sends still work.'}
        </div>
      )}
    </div>
  )
}

function LockedCard() {
  return (
    <div style={{
      margin: '24px 20px', padding: '40px 24px', textAlign: 'center', background: '#fff',
      border: '1px solid #e8e4dc', borderRadius: 14, fontFamily: F,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Restricted</div>
      <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
        Automation controls and health are available to program owners and administrators only.
      </div>
    </div>
  )
}

export default function AutomationView({ active = true, cohortId, toast, refreshKey }) {
  const { isOwner, isAdmin } = useAuth()
  const ownerAdmin = isOwner || isAdmin
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Health source - cron_runs.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['automation-monitor', refreshKey],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No session')
      const res = await fetch('/api/automation-runs', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: active && ownerAdmin,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // Controls source - separate query so a toggle refetches settings only (not all cron_runs), and a
  // settings outage never blocks Health (its own query above).
  const { data: settingsData, isError: settingsError, refetch: refetchSettings } = useQuery({
    queryKey: ['automation-settings', refreshKey],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No session')
      const res = await fetch('/api/automation-settings', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: active && ownerAdmin,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // Pessimistic global toggle: disable while PATCH pending, apply returned setting to cache
  // immediately, then background-refetch to confirm server truth.
  const [savingKey, setSavingKey] = useState(null)
  // Email preview drawer: the card whose synthetic email preview is open (null = closed).
  const [previewCard, setPreviewCard] = useState(null)
  const handleToggleControl = async (automationKey, val) => {
    if (savingKey) return
    setSavingKey(automationKey)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('No session')
      const res = await fetch('/api/automation-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ automation_key: automationKey, enabled: val }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      const updated = body?.setting
      if (updated?.automation_key) {
        queryClient.setQueryData(['automation-settings', refreshKey], (old) => {
          const list = old?.settings || []
          const has = list.some(s => s.automation_key === updated.automation_key)
          const settings = has
            ? list.map(s => (s.automation_key === updated.automation_key ? updated : s))
            : [...list, updated]
          return { ...(old || {}), settings }
        })
      }
      // toast from useToast() is an OBJECT ({ success, error, ... }), not a callable.
      toast?.success?.(val ? 'Automation enabled' : 'Automation paused')
      refetchSettings() // NOT awaited - can't clobber the toast or UI
    } catch {
      toast?.error?.('Update failed', 'Could not change the automation setting. Please try again.')
    } finally {
      setSavingKey(null)
    }
  }

  // Midpoint cohort setting (own source; not in automation_settings).
  const midpoint = useMidpointSetting(cohortId, toast)

  if (!ownerAdmin) return <LockedCard />

  const nowIso = data?.now
  const runs = data?.runs || []
  // Latest run per cron_name (runs arrive newest-first).
  const latestByName = {}
  for (const r of runs) if (!latestByName[r.cron_name]) latestByName[r.cron_name] = r

  // Settings keyed by automation_key.
  const settingsList = settingsData?.settings || []
  const settingByKey = {}
  for (const s of settingsList) settingByKey[s.automation_key] = s

  // Paused for a card's health badge: global setting-disabled is authoritative; if settings are
  // unavailable, fall back to the latest run's skipped_disabled heartbeat. enabled=true never shows
  // Paused. Midpoint keeps its current (run-only) health source.
  const isCardPaused = (card) => {
    if (card.hasMidpointSetting) return false
    const s = settingByKey[card.automation_key]
    if (s) return s.enabled === false
    return latestByName[card.cron_name]?.details?.skipped_disabled === true
  }

  const healthFor = (card) => {
    const run = latestByName[card.cron_name]
    const cadence = automationById(card.id)
    if (isCardPaused(card)) return resolveHealth(run, nowIso, true, cadence) // authoritative even while runs load
    if (isLoading) return { tone: 'neutral', label: 'Loading…', caption: null, loading: true }
    if (isError) return { tone: 'neutral', label: 'Status unavailable', caption: null }
    return resolveHealth(run, nowIso, false, cadence)
  }

  // Normalize each card's control (toggle) state from the right source.
  const ctrlFor = (card) => {
    if (card.hasMidpointSetting) {
      return {
        enabled: midpoint.enabled,
        loaded: !!cohortId && midpoint.loaded,
        saving: midpoint.saving,
        toggleDisabled: midpoint.saving || !cohortId || !midpoint.loaded,
        onToggle: midpoint.toggle,
        ariaLabel: 'Midpoint check-in auto-send',
        note: !cohortId ? 'Select an active cohort to manage this setting.' : null,
        unavailable: false,
        onRetry: null,
        updatedAt: null,
        description: null,
      }
    }
    const s = settingByKey[card.automation_key]
    return {
      enabled: s ? s.enabled === true : false,
      loaded: !!s,
      saving: savingKey === card.automation_key,
      toggleDisabled: savingKey === card.automation_key || !s,
      onToggle: (val) => handleToggleControl(card.automation_key, val),
      ariaLabel: card.title,
      note: null,
      unavailable: !!settingsError,
      onRetry: refetchSettings,
      updatedAt: (s?.source === 'row' && s?.updated_at) ? s.updated_at : null,
      description: s?.description || null,
    }
  }

  return (
    <div style={{ padding: '4px 20px 28px', fontFamily: F }}>
      {/* Title */}
      <div style={{ margin: '6px 2px 14px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#191919' }}>Automations</div>
      </div>

      {/* Single unified section */}
      <div style={{ margin: '6px 2px 12px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#191919' }}>Scheduled Automations</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 1.5 }}>
          Control and monitor scheduled automation sends. Pausing a control stops only the scheduled automatic send. Manual sends, previews, and dry-runs are never affected.
        </div>
      </div>

      {/* Non-blocking run-status banner - cards (and controls) still render if cron_runs fails. */}
      {isError && (
        <div style={{
          margin: '0 2px 12px', padding: '10px 14px', background: '#fff', border: '1px solid #f3c9c9',
          borderRadius: 10, color: '#b91c1c', fontSize: 12.5,
        }}>
          Couldn’t load run status.{' '}
          <button onClick={() => refetch()} style={{
            background: 'none', border: 'none', color: NAVY, fontWeight: 700, cursor: 'pointer',
            fontFamily: F, fontSize: 12.5, padding: 0, textDecoration: 'underline',
          }}>Retry</button>
          {' '}Controls still work.
        </div>
      )}

      {/* Unified grid - one card per automation, in canonical order. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {AUTOMATION_CARDS.map(card => (
          <AutomationCard
            key={card.id}
            card={card}
            run={latestByName[card.cron_name]}
            health={healthFor(card)}
            ctrl={ctrlFor(card)}
            onPreview={() => setPreviewCard(card)}
            canPreview={!!getPreviewFixture(card.id)}
          />
        ))}
      </div>

      {/* Sent History pointer - message-level logs live in Outreach > Sent History (real deep link). */}
      <div style={{
        margin: '16px 2px 0', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8,
        flexWrap: 'wrap', background: '#f6f8fc', border: '1px solid #d9e1f3', borderRadius: 10,
        fontSize: 12, color: '#475569',
      }}>
        <span>For message-level delivery history, use</span>
        <button
          onClick={() => navigate('/connect/outreach?tab=sent_history')}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: F,
            fontSize: 12, fontWeight: 700, color: NAVY, textDecoration: 'underline',
          }}
        >Outreach › Sent History</button>
      </div>

      {/* Email preview drawer - synthetic data, client-side render, sandboxed iframe. */}
      {previewCard && (
        <AutomationEmailPreviewDrawer
          title={previewCard.title}
          entry={getPreviewFixture(previewCard.id)}
          onClose={() => setPreviewCard(null)}
        />
      )}
    </div>
  )
}
