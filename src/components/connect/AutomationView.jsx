// CONNECT-AUTOMATION — Automation control + health surface (Connect > Automation subtab).
//
// Purpose (post message-history pruning): controls and health for scheduled communication
// workflows — NOT another message log. Message-level delivery history lives in Outreach > Sent
// History, linked from here.
//
//   • Section 1 "Automation Controls" — Midpoint Check-In auto-send toggle. Canonical home for the
//     cohorts.midpoint_checkin_automation_enabled setting (the Rotation > Check-Ins tab was retired
//     in favor of this control). Client-side update (RLS already allows it); no backend, no schema.
//   • Section 2 "Automation Health" — one card per scheduled cron, from cron_runs (counts only,
//     via the Owner/Admin /api/automation-runs endpoint because cron_runs is RLS-locked).
//
// Owner/Admin only. Read-only except the one cohort-setting toggle.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import Toggle from '../ui/Toggle'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// ── Scheduled jobs: static display metadata. Keyed by the exact cron_runs.cron_name written by
// each cron writer. Schedules mirror vercel.json (UTC), shown in Pacific for the Owner. ──
const JOBS = [
  { key: 'teams-invite-reminders', name: 'Teams Invite Reminders',
    desc: 'Nudges interviewers and candidates to accept the Microsoft Teams interview invite.',
    schedule: 'Weekdays · 8:00 AM PT' },
  { key: 'interview-reminders', name: 'Interview Reminders',
    desc: 'Sends candidates a reminder ahead of their scheduled interview.',
    schedule: 'Daily · 10:00 AM PT' },
  { key: 'coordinator-weekly-digest', name: 'Coordinator Weekly Digest',
    desc: 'Weekly student-activity summary emailed to school coordinators.',
    schedule: 'Fridays · 9:00 AM PT' },
  { key: 'midpoint-checkin', name: 'Midpoint Check-In',
    desc: 'Emails students who reach the midpoint of their required hours (automation-enabled cohorts).',
    schedule: 'Daily · 8:00 AM PT' },
  { key: 'clockout-reminders-scheduled', name: 'Clock-Out Reminders',
    desc: 'Hourly nudge for students with an open shift that may be overdue to clock out.',
    schedule: 'Hourly' },
]

// Global automations with a real automation_settings toggle (NOT midpoint, which is cohort-scoped
// on cohorts.midpoint_checkin_automation_enabled and has its own card). Maps Health cron_name <->
// settings automation_key so a disabled setting can mark the matching Health card as Paused.
const AUTOMATION_KEY_BY_CRON_NAME = {
  'teams-invite-reminders': 'teams_invite_reminders',
  'interview-reminders': 'interview_reminders',
  'coordinator-weekly-digest': 'coordinator_weekly_digest',
  'clockout-reminders-scheduled': 'clockout_reminders',
}
const AUTOMATION_CONTROLS = [
  { automation_key: 'teams_invite_reminders',    cron_name: 'teams-invite-reminders',        title: 'Teams Invite Reminders',    schedule: 'Weekdays · 8:00 AM PT', scope: 'Global' },
  { automation_key: 'interview_reminders',       cron_name: 'interview-reminders',           title: 'Interview Reminders',       schedule: 'Daily · 10:00 AM PT',   scope: 'Global' },
  { automation_key: 'coordinator_weekly_digest', cron_name: 'coordinator-weekly-digest',     title: 'Coordinator Weekly Digest', schedule: 'Fridays · 9:00 AM PT',  scope: 'Global' },
  { automation_key: 'clockout_reminders',        cron_name: 'clockout-reminders-scheduled',  title: 'Clock-Out Reminders',       schedule: 'Hourly',                scope: 'Global' },
]
// Safe fallback descriptions if the settings endpoint omits one.
const CONTROL_FALLBACK_DESC = {
  teams_invite_reminders:    'Reminds interviewers and candidates to accept the Microsoft Teams interview invite.',
  interview_reminders:       'Sends candidates a reminder ahead of their scheduled interview.',
  coordinator_weekly_digest: 'Weekly student-activity summary emailed to school coordinators.',
  clockout_reminders:        'Hourly nudge for students with an open shift that may be overdue to clock out.',
}

// Friendly labels for the numeric counts crons record in cron_runs.details (counts only — no PII).
const COUNT_LABELS = {
  sent_count: 'Sent', fired_count: 'Sent',
  skipped_count: 'Skipped', skipped_no_email_count: 'No email on file',
  skipped_recently_reminded_count: 'Recently reminded',
  failed_count: 'Failed', error_count: 'Errors',
  eligible_count: 'Eligible', checked_count: 'Checked',
  event_count: 'Events', coordinators_resolved: 'Coordinators',
  cohort_count: 'Cohorts', overdue_count: 'Overdue', open_checked: 'Open shifts',
  would_send_count: 'Would send',
}
const ALARM_KEYS = new Set(['failed_count', 'error_count'])
const SENT_KEYS = ['sent_count', 'fired_count']

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
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

// ── Resolve one job's latest run into a display state. `nowIso` is the server clock (avoids an
// impure render-time Date and keeps "stale running" honest across client clock skew). ──
function resolveHealth(run, nowIso, paused) {
  // Paused is authoritative (setting disabled, or fallback skipped_disabled evidence) and wins over
  // run-derived status — a paused automation must never read as failed or stale.
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
  neutral: { dot: '#9ca3af', bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
  paused:  { dot: '#94a3b8', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
}

function HealthCard({ job, run, nowIso, paused }) {
  const health = resolveHealth(run, nowIso, paused)
  const tone = HEALTH_TONES[health.tone] || HEALTH_TONES.neutral
  const chips = chipsFromDetails(run?.details)
  const duration = run && fmtDuration(run.started_at, run.finished_at)
  const dryRun = run?.details && typeof run.details.dry_run === 'boolean' ? run.details.dry_run : null

  return (
    <div style={{
      flex: '1 1 280px', minWidth: 0, background: '#fff', border: '1px solid #e8e4dc',
      borderRadius: 14, padding: '16px 18px', fontFamily: F,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{job.name}</div>
          <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>{job.schedule}</div>
        </div>
        <span style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
          fontWeight: 700, padding: '3px 9px', borderRadius: 20,
          background: tone.bg, color: tone.color, border: `1px solid ${tone.border}`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot }} />
          {health.label}
        </span>
      </div>

      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8, lineHeight: 1.45 }}>{job.desc}</div>

      <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
        <span>Last run: <strong style={{ color: '#374151', fontWeight: 600 }}>{run ? fmtDateTime(run.started_at) : '—'}</strong></span>
        {duration && <span>Duration: <strong style={{ color: '#374151', fontWeight: 600 }}>{duration}</strong></span>}
        {dryRun !== null && (
          <span style={{ fontWeight: 700, color: dryRun ? '#b45309' : '#2F7D5C' }}>{dryRun ? 'Dry run' : 'Live'}</span>
        )}
      </div>

      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {chips.map(c => (
            <span key={c.key} style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 7,
              background: c.alarm ? '#fef2f2' : '#f3f4f6',
              color: c.alarm ? '#b91c1c' : '#4b5563',
              border: `1px solid ${c.alarm ? '#fecaca' : '#e5e7eb'}`,
            }}>{c.label}: {c.value}</span>
          ))}
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
    </div>
  )
}

// ── Automation Controls: Midpoint Check-In auto-send. This is now the canonical home for the
//    cohorts.midpoint_checkin_automation_enabled setting (the Rotation > Check-Ins tab was retired). ──
function MidpointControlCard({ cohortId, toast }) {
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

  const handleToggle = async (val) => {
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

  return (
    <div style={{ flex: '1 1 280px', minWidth: 0, maxWidth: 460, background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14, padding: '16px 18px', fontFamily: F }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Midpoint Check-In Auto-send</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 1.45 }}>
            Sends check-in emails to Active Rotation students once they reach 50% of required hours.
          </div>
          <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            <span>Schedule: <strong style={{ color: '#6b7280', fontWeight: 600 }}>Daily</strong></span>
            <span>Scope: <strong style={{ color: '#6b7280', fontWeight: 600 }}>Active cohort only</strong></span>
          </div>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <Toggle
            checked={enabled}
            onChange={handleToggle}
            disabled={saving || !cohortId || !loaded}
            size="md"
            ariaLabel="Midpoint check-in auto-send"
          />
          <span style={{ fontSize: 11, color: saving ? '#b45309' : enabled ? '#2F7D5C' : '#9ca3af', fontWeight: 600, minHeight: 14 }}>
            {!cohortId ? '' : saving ? 'Saving…' : !loaded ? 'Loading…' : enabled ? 'On' : 'Off'}
          </span>
        </div>
      </div>
      {!cohortId ? (
        <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 10 }}>Select an active cohort to manage this setting.</div>
      ) : loaded && enabled ? (
        <div style={{ fontSize: 11.5, color: '#2F7D5C', marginTop: 10 }}>
          Active — eligible students are emailed automatically each morning.
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 10 }}>
          Off — no automatic midpoint emails are sent.
        </div>
      )}
    </div>
  )
}

// ── A global automation toggle card, driven by /api/automation-settings. Pessimistic: the toggle
//    is disabled while a PATCH is pending; the parent refetches settings on success. ──
function AutomationControlCard({ control, setting, saving, onToggle }) {
  const loaded = !!setting
  const enabled = setting ? setting.enabled === true : false
  const description = setting?.description || CONTROL_FALLBACK_DESC[control.automation_key] || 'Scheduled automated communication.'
  const showUpdated = setting?.source === 'row' && !!setting?.updated_at

  return (
    <div style={{ flex: '1 1 280px', minWidth: 0, maxWidth: 460, background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14, padding: '16px 18px', fontFamily: F }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{control.title}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 1.45 }}>{description}</div>
          <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            <span>Schedule: <strong style={{ color: '#6b7280', fontWeight: 600 }}>{control.schedule}</strong></span>
            <span>Scope: <strong style={{ color: '#6b7280', fontWeight: 600 }}>{control.scope}</strong></span>
          </div>
          {showUpdated && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              Updated {new Date(setting.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <Toggle
            checked={enabled}
            onChange={(v) => onToggle(control.automation_key, v)}
            disabled={saving || !loaded}
            size="md"
            ariaLabel={control.title}
          />
          <span style={{ fontSize: 11, color: saving ? '#b45309' : enabled ? '#2F7D5C' : '#9ca3af', fontWeight: 600, minHeight: 14 }}>
            {saving ? 'Saving…' : !loaded ? 'Loading…' : enabled ? 'On' : 'Off'}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: enabled ? '#2F7D5C' : '#475569', marginTop: 10 }}>
        {enabled
          ? 'Active: scheduled automatic sends are enabled.'
          : 'Paused: no automatic sends. Manual and preview sends still work.'}
      </div>
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

  // Controls source — separate query so a toggle refetches settings only (not all cron_runs), and
  // a settings outage never blocks Automation Health (its own query above).
  const { data: settingsData, isLoading: settingsLoading, isError: settingsError, refetch: refetchSettings } = useQuery({
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

  // Pessimistic toggle: disable the control while its PATCH is pending, refetch settings on success.
  const [savingKey, setSavingKey] = useState(null)
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
      // Apply the server's returned setting to the cache immediately so the toggle, card footer, and
      // the matching Health card flip right away — no full refresh needed.
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
      // Confirm server truth in the background — NOT awaited, so it can't clobber the toast or UI.
      refetchSettings()
    } catch {
      toast?.error?.('Update failed', 'Could not change the automation setting. Please try again.')
    } finally {
      setSavingKey(null)
    }
  }

  if (!ownerAdmin) return <LockedCard />

  const nowIso = data?.now
  const runs = data?.runs || []
  // Latest run per cron_name (runs arrive newest-first).
  const latestByName = {}
  for (const r of runs) if (!latestByName[r.cron_name]) latestByName[r.cron_name] = r

  // Settings, keyed by automation_key.
  const settingsList = settingsData?.settings || []
  const settingByKey = {}
  for (const s of settingsList) settingByKey[s.automation_key] = s

  // Paused for a Health card: setting-disabled is authoritative; if settings are unavailable, fall
  // back to the latest run's skipped_disabled heartbeat. enabled=true never shows Paused.
  const isJobPaused = (job) => {
    const key = AUTOMATION_KEY_BY_CRON_NAME[job.key]
    if (!key) return false // e.g. midpoint — not wired to automation_settings this phase
    const s = settingByKey[key]
    if (s) return s.enabled === false
    return latestByName[job.key]?.details?.skipped_disabled === true
  }

  return (
    <div style={{ padding: '4px 20px 28px', fontFamily: F }}>
      {/* Title */}
      <div style={{ margin: '6px 2px 14px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#191919' }}>Automation</div>
        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 3 }}>
          Manage and monitor scheduled communication workflows.
        </div>
      </div>

      {/* Section 1 — Automation Controls */}
      <div style={{ margin: '6px 2px 12px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#191919' }}>Automation Controls</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 1.5 }}>
          Control scheduled automation sends. Pausing a control stops only the scheduled automatic send. Manual sends, previews, and dry-runs are never affected.
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {/* Midpoint stays first — cohort-scoped, sourced from cohorts (independent of the settings query). */}
        <MidpointControlCard cohortId={cohortId} toast={toast} />

        {settingsError ? (
          <div style={{
            flex: '1 1 280px', minWidth: 0, padding: '16px 18px', background: '#fff',
            border: '1px solid #f3c9c9', borderRadius: 14, color: '#b91c1c', fontSize: 13, fontFamily: F,
          }}>
            Could not load automation controls.{' '}
            <button onClick={() => refetchSettings()} style={{
              background: 'none', border: 'none', color: NAVY, fontWeight: 700, cursor: 'pointer',
              fontFamily: F, fontSize: 13, padding: 0, textDecoration: 'underline',
            }}>Retry</button>
            <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 6 }}>
              Automation Health below is unaffected.
            </div>
          </div>
        ) : settingsLoading ? (
          <div style={{
            flex: '1 1 280px', minWidth: 0, padding: '24px 18px', background: '#fff',
            border: '1px solid #e8e4dc', borderRadius: 14, color: '#9ca3af', fontSize: 13, fontFamily: F,
          }}>
            Loading controls…
          </div>
        ) : (
          AUTOMATION_CONTROLS.map(control => (
            <AutomationControlCard
              key={control.automation_key}
              control={control}
              setting={settingByKey[control.automation_key]}
              saving={savingKey === control.automation_key}
              onToggle={handleToggleControl}
            />
          ))
        )}
      </div>

      {/* Section 2 — Automation Health */}
      <div style={{ margin: '26px 2px 12px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#191919' }}>Automation Health</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
          Status of each scheduled communication job, from the most recent run.
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Loading automation status…</div>
      ) : isError ? (
        <div style={{
          margin: '4px 0', padding: '18px 20px', background: '#fff', border: '1px solid #f3c9c9',
          borderRadius: 12, color: '#b91c1c', fontSize: 13,
        }}>
          Could not load automation data.{' '}
          <button onClick={() => refetch()} style={{
            background: 'none', border: 'none', color: NAVY, fontWeight: 700, cursor: 'pointer',
            fontFamily: F, fontSize: 13, padding: 0, textDecoration: 'underline',
          }}>Retry</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {JOBS.map(job => (
            <HealthCard key={job.key} job={job} run={latestByName[job.key]} nowIso={nowIso} paused={isJobPaused(job)} />
          ))}
        </div>
      )}

      {/* Sent History pointer — message-level logs live in Outreach > Sent History (real deep link). */}
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
    </div>
  )
}
