import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X, Trash2, Copy, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { safeWrite } from '../lib/safeWrite'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function addMinutes(timeStr, mins) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function getInitials(name) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] || '') : '')).toUpperCase()
}

// status column added by migration; fall back to is_booked for pre-migration rows
const getStatus = (slot) => slot.status || (slot.is_booked ? 'booked' : 'available')

// ── Sub-components ────────────────────────────────────────────────────────────

function KPI({ label, value, color, bg }) {
  return (
    <div style={{ background: bg, padding: '10px 8px', borderRadius: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'DM Sans' }}>{value}</div>
      <div style={{ fontSize: 9, color, opacity: 0.85, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'DM Sans', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function SectionHeader({ title, count, badgeBg, badgeColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#1D2567', fontFamily: 'DM Sans' }}>{title}</span>
      <span style={{ background: badgeBg, color: badgeColor, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>{count}</span>
    </div>
  )
}

function InterviewerChip({ name, colorMap }) {
  const color = colorMap?.[name] || '#9CA3AF'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: color + '22', color: color,
      border: `1px solid ${color}44`,
      padding: '2px 7px', borderRadius: 999,
      fontSize: 10, fontWeight: 700, fontFamily: 'DM Sans',
    }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: '#fff', fontWeight: 700 }}>
        {getInitials(name)}
      </span>
      {name?.split(' ')[0]}
    </span>
  )
}

function StatusPill({ status }) {
  const styles = {
    booked:    { bg: '#E0E7FF', color: '#3730A3', label: 'Booked' },
    available: { bg: '#D1FAE5', color: '#065F46', label: 'Available' },
    blocked:   { bg: '#FEF3C7', color: '#92400E', label: 'Blocked' },
  }
  const s = styles[status] || styles.available
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, fontFamily: 'DM Sans' }}>
      {s.label}
    </span>
  )
}

function CopyEmailBtn({ email }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted, #6B7280)' }}>{email}</span>
      <button
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy email'}
        style={{
          background: copied ? '#EEF7F0' : 'none',
          border: 'none', cursor: 'pointer', padding: '1px 4px',
          borderRadius: 4, display: 'inline-flex', alignItems: 'center',
          color: copied ? '#2F7D5C' : 'var(--text-muted, #9CA3AF)',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { if (!copied) e.currentTarget.style.color = 'var(--text-heading, #191919)' }}
        onMouseLeave={e => { if (!copied) e.currentTarget.style.color = 'var(--text-muted, #9CA3AF)' }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  )
}

function MBtn({ variant, disabled, onClick, children, title, style: extraStyle }) {
  const v = {
    primary: { background: '#1D2567', color: '#fff',     border: 'none' },
    outline: { background: '#fff',    color: '#1D2567',  border: '1px solid #D1D5DB' },
    danger:  { background: '#fff',    color: '#991B1B',  border: '1px solid #FECACA' },
  }[variant] || { background: '#fff', color: '#1D2567', border: '1px solid #D1D5DB' }
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      ...v,
      padding: '4px 10px', borderRadius: 6,
      fontSize: 11, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
      fontFamily: 'DM Sans', opacity: disabled ? 0.6 : 1,
      display: 'inline-flex', alignItems: 'center', gap: 4,
      ...extraStyle,
    }}>{children}</button>
  )
}

const slotCard = {
  background: '#FAFAFA', borderRadius: 8,
  border: '1px solid #F3F4F6',
  padding: '10px 12px', marginBottom: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
}

// ── Block Time modal ──────────────────────────────────────────────────────────

function BlockTimeModal({ slot, onSubmit, onClose }) {
  const [reason, setReason] = useState('Break')
  const [saving, setSaving] = useState(false)
  const REASONS = ['Break', 'Meeting', 'Unavailable', 'Other']

  const handleSubmit = async () => {
    setSaving(true)
    await onSubmit(slot, reason)
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 320, fontFamily: 'DM Sans', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1D2567' }}>
            Block {fmtTime(slot.slot_time)} – {fmtTime(addMinutes(slot.slot_time, slot.duration_minutes))}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', lineHeight: 0 }}><X size={16} /></button>
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>What is this time blocked for?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {REASONS.map(r => (
            <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
              <input type="radio" name="block-reason" value={r} checked={reason === r} onChange={() => setReason(r)} style={{ accentColor: '#1D2567' }} />
              {r}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <MBtn variant="outline" onClick={onClose}>Cancel</MBtn>
          <MBtn variant="primary" disabled={saving} onClick={handleSubmit}>
            {saving ? 'Blocking…' : 'Block Time'}
          </MBtn>
        </div>
      </div>
    </div>
  )
}

// ── Main drawer ───────────────────────────────────────────────────────────────

export default function InterviewDayDrawer({
  date, cohortId,
  blocks, slots, colorMap,
  isAdmin, userProfile,
  highlightedSlotId,
  onClose, onDeleteBlock, onCancelBooking, onRefresh, onAddAvailability,
}) {
  const queryClient = useQueryClient()

  const [cancelling,    setCancelling]    = useState(null)
  const [markingTeams,  setMarkingTeams]  = useState(null)

  // Scroll to and briefly pulse the highlighted slot (from Week view click)
  useEffect(() => {
    if (!highlightedSlotId) return
    const el = document.getElementById(`slot-row-${highlightedSlotId}`)
    if (!el) return
    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.style.transition = 'box-shadow 0.3s ease'
      el.style.boxShadow  = '0 0 0 2px #1D2567'
      setTimeout(() => { el.style.boxShadow = 'none' }, 1500)
    }, 180) // brief delay so the drawer finishes its own mount animation
    return () => clearTimeout(timer)
  }, [highlightedSlotId])
  const [deletingBlock, setDeletingBlock] = useState(null)
  const [deletingSlot, setDeletingSlot] = useState(null)
  const [blockingSlot, setBlockingSlot] = useState(null)   // slot object for BlockTimeModal
  const [toastMsg,     setToastMsg]     = useState(null)

  if (!date) return null

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const scheduledSlots = (slots || []).filter(s => getStatus(s) === 'booked')
  const availableSlots = (slots || []).filter(s => getStatus(s) === 'available')
  const blockedSlots   = (slots || []).filter(s => getStatus(s) === 'blocked')
  const totalSlots     = (slots || []).length

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['interview_calendar',  cohortId] })
    queryClient.invalidateQueries({ queryKey: ['interview_slots',     cohortId] })
    queryClient.invalidateQueries({ queryKey: ['slots_by_date',       cohortId] })
    queryClient.invalidateQueries({ queryKey: ['availability_blocks', cohortId] })
    queryClient.invalidateQueries({ queryKey: ['interview_sessions',  cohortId] })
    onRefresh?.()
  }

  const showToast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 3000) }

  const handleMarkTeamsInviteSent = async (sessionId) => {
    setMarkingTeams(sessionId)
    await safeWrite(
      () => supabase.from('interview_sessions').update({
        teams_meeting_booked:  true,
        teams_invite_sent_at:  new Date().toISOString(),
        teams_invite_sent_by:  userProfile?.id || null,
      }).eq('id', sessionId),
      { name: 'mark teams invite sent' }
    )
    setMarkingTeams(null)
    showToast('Teams invite marked as sent')
    queryClient.invalidateQueries({ queryKey: ['interview_calendar',  cohortId] })
    queryClient.invalidateQueries({ queryKey: ['interview_sessions',  cohortId] })
    onRefresh?.()
  }

  const handleCancelBooking = async (slot) => {
    const student = Array.isArray(slot.students) ? slot.students[0] : slot.students
    const name = student ? `${student.first_name} ${student.last_name}` : 'this student'
    if (!window.confirm(`Cancel ${name}'s booking? Their status will return to Form Received.`)) return
    setCancelling(slot.id)
    await onCancelBooking(slot)
    setCancelling(null)
    invalidateAll()
  }

  const handleDeleteBlock = async (block) => {
    const blockSlots  = (slots || []).filter(s => s.block_id === block.id)
    const bookedCount = blockSlots.filter(s => getStatus(s) === 'booked').length
    if (bookedCount > 0) {
      alert(`Cancel ${bookedCount} booking${bookedCount !== 1 ? 's' : ''} before deleting this block.`)
      return
    }
    if (!window.confirm(`Delete ${block.interviewer_name}'s block (${block.start_time}–${block.end_time})?`)) return
    setDeletingBlock(block.id)
    await onDeleteBlock(block.id)
    setDeletingBlock(null)
    invalidateAll()
  }

  const handleDeleteSlot = async (slotId) => {
    if (!window.confirm('Delete this single slot? The parent availability block stays intact.')) return
    setDeletingSlot(slotId)
    await safeWrite(
      () => supabase.from('interview_slots').delete().eq('id', slotId),
      { name: 'delete interview slot' }
    )
    setDeletingSlot(null)
    showToast('Slot deleted')
    invalidateAll()
  }

  const handleBlockSlot = async (slot, reason) => {
    await safeWrite(
      () => supabase.from('interview_slots').update({ status: 'blocked', blocked_reason: reason }).eq('id', slot.id),
      { name: 'block interview slot' }
    )
    setBlockingSlot(null)
    showToast(`Blocked: ${reason}`)
    invalidateAll()
  }

  const handleUnblockSlot = async (slotId) => {
    await safeWrite(
      () => supabase.from('interview_slots').update({ status: 'available', blocked_reason: null }).eq('id', slotId),
      { name: 'unblock interview slot' }
    )
    showToast('Slot unblocked')
    invalidateAll()
  }

  const canDelete = (block) =>
    isAdmin ||
    block.created_by_user_id === userProfile?.id ||
    block.interviewer_name   === userProfile?.full_name

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 59 }} />

      {/* Drawer panel */}
      <div style={{
        position: 'fixed',
        ...(isMobile
          ? { left: 0, right: 0, bottom: 0, maxHeight: '85vh', borderRadius: '16px 16px 0 0' }
          : { top: 0, right: 0, bottom: 0, width: 460 }),
        background: '#fff',
        boxShadow: isMobile ? '0 -4px 24px rgba(0,0,0,0.12)' : '-4px 0 28px rgba(0,0,0,0.10)',
        overflowY: 'auto',
        zIndex: 60,
        fontFamily: 'DM Sans, sans-serif',
      }}>

        {/* ── Dark header band ── */}
        <div style={{
          background: 'linear-gradient(135deg, #1c2452 0%, #1D2567 100%)',
          color: '#fff',
          padding: '20px 20px 18px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
                Day Management
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, lineHeight: 1.2 }}>{dateLabel}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 5 }}>
                {scheduledSlots.length} scheduled · {availableSlots.length} available · {blockedSlots.length} blocked
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', flexShrink: 0 }}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 20px 32px' }}>

          {/* ── KPI cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 22 }}>
            <KPI label="Scheduled"   value={scheduledSlots.length} color="#1E3A8A" bg="#EFF6FF" />
            <KPI label="Available"   value={availableSlots.length} color="#065F46" bg="#F0FDF4" />
            <KPI label="Blocked"     value={blockedSlots.length}   color="#7C2D12" bg="#FFF7ED" />
            <KPI label="Total Slots" value={totalSlots}            color="#1D2567" bg="#F4F1EC" />
          </div>

          {/* ── Section 1: Scheduled Interviews ── */}
          {scheduledSlots.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <SectionHeader title="Scheduled Interviews" count={scheduledSlots.length} badgeBg="#E0E7FF" badgeColor="#3730A3" />
              {scheduledSlots.map(slot => {
                const student = Array.isArray(slot.students) ? slot.students[0] : slot.students
                const endTime = addMinutes(slot.slot_time, slot.duration_minutes)
                const session = Array.isArray(slot.interview_sessions) ? slot.interview_sessions[0] : slot.interview_sessions
                const teamsInviteSent = !!session?.teams_meeting_booked
                return (
                  <div key={slot.id} id={`slot-row-${slot.id}`} style={slotCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 2 }}>
                          {fmtTime(slot.slot_time)} – {fmtTime(endTime)} · {slot.duration_minutes} min
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1D2567' }}>
                          {student ? `${student.first_name} ${student.last_name}` : '—'}
                        </div>
                        {student?.school && (
                          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 1 }}>
                            {student.school}{student.program_type ? ` · ${student.program_type}` : ''}
                          </div>
                        )}
                        {student?.school_email && (
                          <div style={{ marginTop: 3 }}>
                            <CopyEmailBtn email={student.school_email} />
                          </div>
                        )}
                      </div>
                      <StatusPill status="booked" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <InterviewerChip name={slot.interviewer_name} colorMap={colorMap} />
                    </div>
                    {/* Teams invite status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      {teamsInviteSent ? (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#EEF7F0', color: '#2F7D5C' }}>
                          ● Teams invite sent
                        </span>
                      ) : (
                        <>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#FBF5E8', color: '#C08A2A' }}>
                            ● Teams invite pending
                          </span>
                          {session?.id && (
                            <MBtn variant="outline" disabled={markingTeams === session.id} onClick={() => handleMarkTeamsInviteSent(session.id)}>
                              {markingTeams === session.id ? '…' : 'Mark sent'}
                            </MBtn>
                          )}
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      <MBtn variant="outline" onClick={() => handleCancelBooking(slot)} disabled={cancelling === slot.id}>
                        {cancelling === slot.id ? '…' : 'Cancel Interview'}
                      </MBtn>
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* ── Section 2: Open Availability Slots ── */}
          {availableSlots.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <SectionHeader title="Open Availability Slots" count={availableSlots.length} badgeBg="#D1FAE5" badgeColor="#065F46" />
              {availableSlots.map(slot => {
                const endTime = addMinutes(slot.slot_time, slot.duration_minutes)
                return (
                  <div key={slot.id} id={`slot-row-${slot.id}`} style={slotCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>
                        {fmtTime(slot.slot_time)} – {fmtTime(endTime)} · {slot.duration_minutes} min
                      </div>
                      <StatusPill status="available" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <InterviewerChip name={slot.interviewer_name} colorMap={colorMap} />
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <MBtn variant="outline" onClick={() => setBlockingSlot(slot)}>Block Time</MBtn>
                      <MBtn variant="danger" disabled={deletingSlot === slot.id} onClick={() => handleDeleteSlot(slot.id)}>
                        {deletingSlot === slot.id ? '…' : <><Trash2 size={10} /> Delete</>}
                      </MBtn>
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* ── Section 3: Blocked Times ── */}
          {blockedSlots.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <SectionHeader title="Blocked Times" count={blockedSlots.length} badgeBg="#FEF3C7" badgeColor="#92400E" />
              {blockedSlots.map(slot => {
                const endTime = addMinutes(slot.slot_time, slot.duration_minutes)
                return (
                  <div key={slot.id} id={`slot-row-${slot.id}`} style={slotCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>
                        {fmtTime(slot.slot_time)} – {fmtTime(endTime)} · {slot.duration_minutes} min
                      </div>
                      <StatusPill status="blocked" />
                    </div>
                    {slot.blocked_reason && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#7C2D12' }}>
                        Reason: {slot.blocked_reason}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <InterviewerChip name={slot.interviewer_name} colorMap={colorMap} />
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <MBtn variant="outline" onClick={() => handleUnblockSlot(slot.id)}>Unblock</MBtn>
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* Empty state */}
          {totalSlots === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#9CA3AF', fontSize: 13 }}>
              No activity on this day
            </div>
          )}

          {/* ── Block-level management (admin) ── */}
          {isAdmin && (blocks || []).length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <SectionHeader title="Availability Blocks" count={(blocks||[]).length} badgeBg="#F4F1EC" badgeColor="#1D2567" />
              {(blocks || []).map(block => (
                <div key={block.id} style={{ ...slotCard, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#1D2567' }}>{block.interviewer_name}</div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 1 }}>
                      {fmtTime(block.start_time)} – {fmtTime(block.end_time)} · {block.duration_minutes} min slots
                    </div>
                  </div>
                  {canDelete(block) && (
                    <MBtn variant="danger" disabled={deletingBlock === block.id} onClick={() => handleDeleteBlock(block)}>
                      {deletingBlock === block.id ? '…' : <><Trash2 size={10} /> Delete</>}
                    </MBtn>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* ── Quick action ── */}
          <div style={{ paddingTop: 14, borderTop: '1px solid #E5E7EB' }}>
            <button
              onClick={() => onAddAvailability(date)}
              style={{
                width: '100%', padding: '10px 14px',
                background: '#1D2567', color: '#fff', border: 'none',
                borderRadius: 8, fontFamily: 'DM Sans', fontWeight: 600,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              + Add Availability for This Day
            </button>
          </div>
        </div>
      </div>

      {/* Block Time modal */}
      {blockingSlot && (
        <BlockTimeModal
          slot={blockingSlot}
          onSubmit={handleBlockSlot}
          onClose={() => setBlockingSlot(null)}
        />
      )}

      {/* Toast */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1D2567', color: '#fff', padding: '8px 18px',
          borderRadius: 999, fontSize: 13, fontWeight: 600,
          fontFamily: 'DM Sans', zIndex: 200, pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(29,37,103,0.25)',
        }}>
          {toastMsg}
        </div>
      )}
    </>
  )
}
