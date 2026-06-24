// CONNECT-AUTOMATION-MONITOR-V1 — read-only "Automation" monitor (Connect > Automation subtab).
//
// Surfaces existing observability with NO new schema, crons, or toggles:
//   • Section 1 "Automation Health"  — one card per scheduled cron, from cron_runs (counts-only).
//   • Section 2 "Recent Communication Activity" — latest notification_log rows (whitelisted, PII).
//
// Both come from /api/automation-runs (Owner/Admin gated, service-role read) because cron_runs is
// RLS-locked to clients. The whole monitor is Owner/Admin only — notification_log carries recipient
// PII. Strictly read-only; no actions beyond opening a student profile.
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

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
// Keys that signal a problem when > 0 (rendered red).
const ALARM_KEYS = new Set(['failed_count', 'error_count'])
// Keys that represent "messages actually sent" (used for the calm "nothing to send" caption).
const SENT_KEYS = ['sent_count', 'fired_count']

const MESSAGE_TYPE_LABELS = {
  direct_message_sent:              'Direct Message',
  evaluation_invitation_sent:       'Survey Invitation',
  evaluation_invitation_test:       'Survey Invitation (Test)',
  coordinator_weekly_digest:        'Weekly Digest',
  coordinator_weekly_digest_test:   'Weekly Digest (Test)',
  interview_reminder:               'Interview Reminder',
  midpoint_checkin:                 'Midpoint Check-In',
  form_received:                    'Form Received',
  unit_form_received:               'Unit Form Received',
  teams_invite_reminder:            'Teams Invite Reminder',
  teams_invite_reminder_escalation: 'Teams Invite Escalation',
}
const messageTypeLabel = (t) => MESSAGE_TYPE_LABELS[t] || t || '—'

const FAILED_STATUSES  = new Set(['failed', 'bounced', 'complained'])
const POSITIVE_STATUSES = new Set(['sent', 'delivered', 'opened', 'clicked'])

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
function resolveHealth(run, nowIso) {
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
  success: { dot: '#2F7D5C', bg: '#eef6ee', color: '#2F7D5C', border: '#cfe6d6', text: 'Healthy' },
  error:   { dot: '#b91c1c', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
  running: { dot: '#b45309', bg: '#fff7ed', color: '#b45309', border: '#fed7aa' },
  neutral: { dot: '#9ca3af', bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
}

function HealthCard({ job, run, nowIso }) {
  const health = resolveHealth(run, nowIso)
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
          <span style={{
            fontWeight: 700, color: dryRun ? '#b45309' : '#2F7D5C',
          }}>{dryRun ? 'Dry run' : 'Live'}</span>
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

function statusPill(status) {
  const s = String(status || '').toLowerCase()
  if (FAILED_STATUSES.has(s))  return { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' }
  if (POSITIVE_STATUSES.has(s)) return { bg: '#eef6ee', color: '#2F7D5C', border: '#cfe6d6' }
  return { bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' }
}

function ActivityRow({ row, onNavigateToStudent }) {
  const failed = FAILED_STATUSES.has(String(row.status || '').toLowerCase())
  const pill = statusPill(row.status)
  const canOpen = !!row.student_id && typeof onNavigateToStudent === 'function'
  const recipient = row.recipient_name || row.recipient_email || '—'
  const meta = [row.recipient_role || row.recipient_type, fmtDateTime(row.sent_at)].filter(Boolean).join(' · ')
  const engagement = [
    row.delivered_at && 'Delivered',
    row.opened_at && 'Opened',
  ].filter(Boolean).join(' · ')

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
      padding: '11px 14px', background: failed ? '#fffafa' : '#fff',
      border: `1px solid ${failed ? '#f3c9c9' : '#eee9e0'}`, borderRadius: 11, fontFamily: F,
    }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {canOpen ? (
            <button onClick={() => onNavigateToStudent(row.student_id)} style={{
              fontSize: 13.5, fontWeight: 700, color: NAVY, background: 'none', border: 'none',
              padding: 0, cursor: 'pointer', fontFamily: F, textAlign: 'left',
            }}>{recipient}</button>
          ) : (
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#191919' }}>{recipient}</span>
          )}
          <span style={{
            fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 6,
            background: '#EEF2FB', color: NAVY, border: '1px solid #c3cdf0',
          }}>{messageTypeLabel(row.notification_type)}</span>
        </div>
        {row.recipient_name && row.recipient_email && (
          <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2, wordBreak: 'break-word' }}>{row.recipient_email}</div>
        )}
        <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>{meta || '—'}</div>
        {row.subject && (
          <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2, wordBreak: 'break-word' }}>
            <span style={{ color: '#9ca3af' }}>Subject:</span> {row.subject}
          </div>
        )}
        {failed && row.error_message && (
          <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3, wordBreak: 'break-word' }}>{row.error_message}</div>
        )}
      </div>
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, textTransform: 'capitalize',
          background: pill.bg, color: pill.color, border: `1px solid ${pill.border}`,
        }}>{row.status || '—'}</span>
        {engagement && <span style={{ fontSize: 10.5, color: '#9ca3af' }}>{engagement}</span>}
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
        Automation monitoring includes recipient communication records and is available to program
        owners and administrators only.
      </div>
    </div>
  )
}

export default function AutomationView({ active = true, onNavigateToStudent, refreshKey }) {
  const { isOwner, isAdmin } = useAuth()
  const ownerAdmin = isOwner || isAdmin

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

  if (!ownerAdmin) return <LockedCard />

  const nowIso = data?.now
  const runs = data?.runs || []
  const activity = data?.activity || []
  // Latest run per cron_name (runs arrive newest-first).
  const latestByName = {}
  for (const r of runs) if (!latestByName[r.cron_name]) latestByName[r.cron_name] = r

  return (
    <div style={{ padding: '4px 20px 28px', fontFamily: F }}>
      {/* Title + scope note — this version is monitoring-only; controls arrive in a follow-up phase
          (so it's clear this has NOT replaced Rotation > Check-ins / the midpoint auto-send toggle). */}
      <div style={{ margin: '6px 2px 12px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#191919' }}>Automation</div>
        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 3 }}>
          Monitor scheduled communication jobs and recent system-sent messages.
        </div>
      </div>
      <div style={{
        margin: '0 2px 16px', padding: '9px 12px', display: 'flex', alignItems: 'flex-start', gap: 8,
        background: '#f6f8fc', border: '1px solid #d9e1f3', borderRadius: 10,
        fontSize: 11.5, color: '#475569', lineHeight: 1.5,
      }}>
        <span style={{ flexShrink: 0, color: NAVY, fontWeight: 700 }}>Monitoring only</span>
        <span>
          Controls for automation settings, including midpoint check-in auto-send, will be added in a
          follow-up phase.
        </span>
      </div>

      {/* Section 1 — Automation Health */}
      <div style={{ margin: '6px 2px 12px' }}>
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
            <HealthCard key={job.key} job={job} run={latestByName[job.key]} nowIso={nowIso} />
          ))}
        </div>
      )}

      {/* Section 2 — Recent Communication Activity */}
      <div style={{ margin: '26px 2px 12px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#191919' }}>Recent Communication Activity</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
          Latest system-sent messages and their delivery status.
        </div>
      </div>

      {!isLoading && !isError && (
        activity.length === 0 ? (
          <div style={{
            margin: '4px 0', padding: '24px 20px', textAlign: 'center', background: '#fff',
            border: '1px solid #e8e4dc', borderRadius: 14, color: '#6b7280', fontSize: 13.5,
          }}>
            No recent communication activity.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activity.map(row => (
              <ActivityRow key={row.id} row={row} onNavigateToStudent={onNavigateToStudent} />
            ))}
          </div>
        )
      )}
    </div>
  )
}
