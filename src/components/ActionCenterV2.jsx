import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { manageStaffConversation } from '../lib/messages/messagesApiClient'
import { completionStatus } from '../lib/catalog/catalogModel'
import { chipCounts, groupQueue } from '../lib/actionCenter/queueModel'
import { formStaff } from './forms/formsApi'
import { sigStaff } from './signatures/sigApi'
import StaffNotificationsPanel from './StaffNotificationsPanel'
import './actionCenter/actionCenter.css'

const EMPTY_ITEMS = Object.freeze([])

function nextMorning(dayOffset) {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(8, 0, 0, 0)
  return d
}

function nextMonday() {
  const d = new Date()
  const days = ((8 - d.getDay()) % 7) || 7
  d.setDate(d.getDate() + days)
  d.setHours(8, 0, 0, 0)
  return d
}

function withQuery(path, key, value) {
  const url = new URL(path, 'https://aspire.internal')
  url.searchParams.set(key, value)
  return `${url.pathname}${url.search}`
}

export default function ActionCenterV2({
  isOpen, onClose, anchorRef, activeCohort, queue = {}, notifications = {}, toast,
  onNavigateNotificationDestination, onNavigateToActivityShift,
  onLaunchSchedulingLink, onOpenOtherCohortItem,
}) {
  const { userProfile } = useAuth()
  const queryClient = useQueryClient()
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const rowRefs = useRef(new Map())
  const pendingFocus = useRef(null)
  const [tab, setTab] = useState('actions')
  const [chip, setChip] = useState('All')
  const [busy, setBusy] = useState(null)
  const [snoozing, setSnoozing] = useState(null)
  const [autoOpen, setAutoOpen] = useState(false)
  const [otherOpen, setOtherOpen] = useState(null)
  const [announcement, setAnnouncement] = useState('')

  const items = queue.items || EMPTY_ITEMS
  const shown = useMemo(() => chip === 'All' ? items : items.filter(item => item.chip === chip), [items, chip])
  const urgent = shown.filter(item => item.urgent)
  const groups = groupQueue(shown.filter(item => !item.urgent))
  const chips = chipCounts(items)
  const unread = notifications.unreadCount || 0

  const navigate = (href) => {
    if (!href) return
    onNavigateNotificationDestination?.(href)
  }

  const openItem = (item) => {
    if (item?.studentId && item?.shiftLogId) {
      onNavigateToActivityShift?.(item.studentId, item.shiftLogId)
      return
    }
    navigate(item?.href)
  }

  useEffect(() => {
    if (!isOpen) return undefined
    const opener = anchorRef?.current || document.activeElement
    const frame = requestAnimationFrame(() => closeRef.current?.focus())
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose?.(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', keydown)
      requestAnimationFrame(() => opener?.focus?.())
    }
  }, [isOpen, anchorRef, onClose])

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    requestAnimationFrame(() => (target === 'close' ? closeRef.current : rowRefs.current.get(target))?.focus?.())
  }, [items])

  if (!isOpen) return null

  const selectNextFocus = itemKey => {
    const index = shown.findIndex(item => item.key === itemKey)
    pendingFocus.current = shown[index + 1]?.key || shown[index - 1]?.key || 'close'
  }

  const invalidate = () => {
    queue.invalidate?.()
    queryClient.invalidateQueries({ queryKey: ['action_snoozes', userProfile?.id] })
  }

  const removeSnooze = async itemKey => {
    const { error } = await supabase.from('action_snoozes').delete().eq('user_id', userProfile.id).eq('item_key', itemKey)
    if (error) throw error
    invalidate()
  }

  const snooze = async (item, until) => {
    setBusy(`${item.key}:snooze`)
    try {
      const { error } = await supabase.from('action_snoozes').upsert({
        user_id: userProfile.id, item_key: item.key, snoozed_until: until.toISOString(),
      }, { onConflict: 'user_id,item_key' })
      if (error) throw error
      selectNextFocus(item.key)
      setSnoozing(null)
      setAnnouncement(`${item.title} snoozed.`)
      invalidate()
      toast?.info?.('Snoozed', `${item.title} will return ${until.toLocaleString()}.`, {
        duration: 5000,
        action: { label: 'Undo', onClick: async () => {
          try { await removeSnooze(item.key); setAnnouncement(`Snooze undone for ${item.title}.`) }
          catch { toast?.error?.('Undo failed', 'The item is still snoozed.') }
        } },
      })
    } catch {
      toast?.error?.('Could not snooze', 'Nothing changed. Try again after the Action Center update is applied.')
    } finally { setBusy(null) }
  }

  const supportDecision = async (item, action) => {
    setBusy(`${item.key}:${action}`)
    try {
      const { error } = await supabase.rpc('record_support_checkin_decision', { p_shift_log_id: item.shiftLogId, p_action: action })
      if (error) throw error
      if (action === 'close_no_help') selectNextFocus(item.key)
      setAnnouncement(action === 'close_no_help' ? `${item.title} closed: no help needed.` : `${item.title} opened as a support request.`)
      invalidate()
      if (action === 'close_no_help') toast?.success?.('Closed: no help needed', item.title, {
        duration: 5000,
        action: { label: 'Undo', onClick: async () => {
          const { error: undoError } = await supabase.rpc('record_support_checkin_decision', { p_shift_log_id: item.shiftLogId, p_action: 'reopen' })
          if (undoError) { toast?.error?.('Undo failed', 'The check-in stayed closed.'); return }
          invalidate(); setAnnouncement(`${item.title} reopened.`)
        } },
      })
    } catch { toast?.error?.('Action not saved', 'Nothing changed. Please try again.') }
    finally { setBusy(null) }
  }

  const sendReminder = async (item) => {
    if (!item.entityId) return
    setBusy(`${item.key}:reminder`)
    let reminded = 0
    try {
      const result = await formStaff('people', { catalog_resource_id: item.entityId })
      const overdue = (result.people || []).filter(person => completionStatus(person) === 'overdue')
      const formIds = overdue.filter(person => person.kind === 'form').map(person => person.id)
      if (formIds.length) reminded += (await formStaff('remind', { ids: formIds })).reminded || 0
      for (const request of overdue.filter(person => person.kind === 'signature')) {
        reminded += (await sigStaff('remind', { id: request.id })).reminded || 0
      }
      if (!reminded) {
        toast?.error?.('No reminder sent', 'The overdue links may have closed. Open the item to review them.')
        return
      }

      const until = nextMorning(1)
      const { error } = await supabase.from('action_snoozes').upsert({
        user_id: userProfile.id, item_key: item.key, snoozed_until: until.toISOString(),
      }, { onConflict: 'user_id,item_key' })
      if (error) throw error
      selectNextFocus(item.key)
      invalidate()
      setAnnouncement(`Reminder sent for ${item.title}. The item is hidden until tomorrow at 8 AM.`)
      toast?.success?.('Reminder sent', `${reminded} ${reminded === 1 ? 'person was' : 'people were'} reminded. This item returns tomorrow at 8 AM if anyone is still overdue.`, {
        duration: 5000,
        action: { label: 'Show again', onClick: async () => {
          try { await removeSnooze(item.key); setAnnouncement(`${item.title} is visible again.`) }
          catch { toast?.error?.('Could not restore item', 'It will return tomorrow at 8 AM.') }
        } },
      })
    } catch {
      if (reminded) {
        invalidate()
        toast?.success?.('Reminder sent', `${reminded} ${reminded === 1 ? 'person was' : 'people were'} reminded, but the item could not be hidden.`)
      } else {
        toast?.error?.('Reminder failed', 'No reminder was sent. Open the item and try again.')
      }
    } finally { setBusy(null) }
  }

  const messageAction = async (item, action) => {
    const id = item.conversation?.id
    if (!id) return
    if (action === 'reply') { navigate(withQuery(item.href, 'focus', 'reply')); return }
    setBusy(`${item.key}:${action}`)
    try {
      if (action === 'assign') {
        await manageStaffConversation({ action: 'assign', conversation_id: id, assignee_profile_id: userProfile.id })
        setAnnouncement(`${item.title} assigned to you.`)
      } else if (action === 'resolve') {
        await manageStaffConversation({ action: 'status', conversation_id: id, status: 'resolved' })
        selectNextFocus(item.key)
        setAnnouncement(`${item.title} closed: no help needed.`)
        toast?.success?.('Closed: no help needed', item.title, {
          duration: 5000,
          action: { label: 'Undo', onClick: async () => {
            try {
              await manageStaffConversation({ action: 'status', conversation_id: id, status: 'open' })
              invalidate(); setAnnouncement(`${item.title} reopened.`)
            } catch { toast?.error?.('Undo failed', 'The thread stayed closed.') }
          } },
        })
      }
      invalidate()
    } catch { toast?.error?.('Action not saved', 'Nothing changed. Please try again.') }
    finally { setBusy(null) }
  }

  const runAction = (item, action) => {
    if (action.key === 'snooze') { setSnoozing(current => current === item.key ? null : item.key); return }
    if (action.key === 'assign' || action.key === 'reply' || action.key === 'resolve') { messageAction(item, action.key); return }
    if (action.key === 'support_open') { supportDecision(item, 'open_request'); return }
    if (action.key === 'support_close') { supportDecision(item, 'close_no_help'); return }
    if (action.key === 'reminder') { sendReminder(item); return }
    if (action.key === 'booking' && item.student) { onLaunchSchedulingLink?.(item.student); onClose?.(); return }
    openItem(item)
  }

  const renderItem = item => {
    const group = item.urgent ? { icon: '!' } : groups.find(g => g.key === item.group) || { icon: item.group?.[0]?.toUpperCase() || '•' }
    return (
      <article className="ac2-card" key={item.key}>
        <button
          ref={node => { if (node) rowRefs.current.set(item.key, node); else rowRefs.current.delete(item.key) }}
          type="button" className="ac2-row" onClick={() => openItem(item)}
          aria-label={`Open ${item.title}${item.qualifier ? `, ${item.qualifier}` : ''}`}>
          <span className="ac2-icon" aria-hidden="true">{group.icon}</span>
          <span>
            <span className="ac2-name">
              {item.title}{item.qualifier ? ` · ${item.qualifier}` : ''}
              {item.tag === 'needs a look' && <em>Needs a look</em>}
            </span>
            {item.meta && <span className="ac2-meta">{item.meta}</span>}
            {item.quote && <span className="ac2-quote">“{item.quote}”</span>}
          </span>
          <span className={`ac2-state${item.urgent ? ' urgent' : ''}`}>{item.urgent ? 'Urgent' : item.ageLabel}</span>
        </button>
        <div className="ac2-actions">
          {item.actions.map(action => (
            <button key={action.key} type="button" className={`ac2-action${action.primary ? ' primary' : ''}`}
              disabled={busy?.startsWith(`${item.key}:`)}
              onClick={event => { event.stopPropagation(); runAction(item, action) }}>
              {busy === `${item.key}:${action.key}` ? 'Working…' : action.label}
            </button>
          ))}
          {snoozing === item.key && (
            <div className="ac2-snooze" role="group" aria-label={`Snooze ${item.title} until`}>
              <span>Snooze until:</span>
              <button type="button" onClick={() => snooze(item, nextMorning(1))}>Tomorrow 8 AM</button>
              <button type="button" onClick={() => snooze(item, nextMonday())}>Monday 8 AM</button>
              <button type="button" onClick={() => setSnoozing(null)}>Cancel</button>
            </div>
          )}
        </div>
      </article>
    )
  }

  const switchTab = next => { setTab(next); requestAnimationFrame(() => document.getElementById(`ac2-tab-${next}`)?.focus()) }
  const tabKey = event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); switchTab(tab === 'actions' ? 'notifications' : 'actions')
    }
  }

  return (
    <>
      <div className="ac2-scrim" aria-hidden="true" onMouseDown={onClose} />
      <aside ref={dialogRef} className="ac2-drawer" role="dialog" aria-modal="true" aria-labelledby="ac2-title">
        <header className="ac2-head">
          <h2 className="ac2-title" id="ac2-title">Action Center</h2>
          <span className="ac2-count" aria-label={`${items.length} action${items.length === 1 ? '' : 's'}`}>{items.length}</span>
          <button ref={closeRef} className="ac2-close" type="button" onClick={onClose} aria-label="Close Action Center">×</button>
        </header>
        <div className="ac2-tabs" role="tablist" aria-label="Action Center views" onKeyDown={tabKey}>
          <button id="ac2-tab-actions" className="ac2-tab" type="button" role="tab" aria-selected={tab === 'actions'} aria-controls="ac2-panel-actions" tabIndex={tab === 'actions' ? 0 : -1} onClick={() => setTab('actions')}>Action needed ({items.length})</button>
          <button id="ac2-tab-notifications" className="ac2-tab" type="button" role="tab" aria-selected={tab === 'notifications'} aria-controls="ac2-panel-notifications" tabIndex={tab === 'notifications' ? 0 : -1} onClick={() => setTab('notifications')}>Notifications{unread > 0 && <span className="ac2-unread-dot" aria-label={`${unread} unread`} />}</button>
        </div>

        {tab === 'actions' && (
          <section id="ac2-panel-actions" role="tabpanel" aria-labelledby="ac2-tab-actions" style={{ display: 'contents' }}>
            <div className="ac2-toolbar">
              <div className="ac2-chips" aria-label="Filter action items">
                <button type="button" className={`ac2-chip${chip === 'All' ? ' on' : ''}`} aria-pressed={chip === 'All'} onClick={() => { setChip('All'); setAnnouncement(`Showing all ${items.length} actions.`) }}>All {items.length}</button>
                {chips.map(entry => <button key={entry.chip} type="button" className={`ac2-chip${chip === entry.chip ? ' on' : ''}`} aria-pressed={chip === entry.chip}
                  onClick={() => { const next = chip === entry.chip ? 'All' : entry.chip; setChip(next); setAnnouncement(next === 'All' ? `Showing all ${items.length} actions.` : `Showing ${entry.count} ${entry.chip} actions.`) }}>{entry.chip} {entry.count}</button>)}
              </div>
              <p className="ac2-scope">Showing {activeCohort?.name || 'this cohort'} plus everything waiting on you personally. Oldest first.</p>
            </div>
            <div className="ac2-body">
              <div className="ac2-clip" aria-hidden="true" />
              {(queue.failures || []).map(failure => <div className="ac2-error" key={failure.key}><span>Couldn’t load {failure.label}.</span><button type="button" onClick={() => failure.retry?.()}>Retry</button></div>)}
              {urgent.length > 0 && <section className="ac2-section" aria-labelledby="ac2-urgent"><h3 className="ac2-section-head" id="ac2-urgent">Urgent <b>{urgent.length}</b></h3>{urgent.map(renderItem)}</section>}
              {groups.map(group => <section className="ac2-section" key={group.key} aria-labelledby={`ac2-${group.key}`}><h3 className="ac2-section-head" id={`ac2-${group.key}`}>{group.label} <b>{group.items.length}</b></h3>{group.items.map(renderItem)}</section>)}
              {!queue.isLoading && shown.length === 0 && !(queue.failures || []).length && !(queue.otherCohorts || []).length && <div className="ac2-empty"><i aria-hidden="true">✓</i><h3>All caught up</h3><p>Nothing needs you in any cohort right now.</p></div>}
              {queue.isLoading && shown.length === 0 && <div className="ac2-empty"><h3>Loading actions…</h3><p>Each area loads independently.</p></div>}
              {(queue.closedAutomatically || []).length > 0 && <>
                <button type="button" className="ac2-collapsed" aria-expanded={autoOpen} onClick={() => setAutoOpen(value => !value)}><span>{queue.closedAutomatically.length} check-in repl{queue.closedAutomatically.length === 1 ? 'y' : 'ies'} closed automatically: no support needed</span><span>{autoOpen ? '▴' : '▾'}</span></button>
                {autoOpen && queue.closedAutomatically.map(row => <div className="ac2-auto-row" key={row.key}><span><strong>{row.title}</strong><br/><q>{row.reply}</q></span><button type="button" className="ac2-action" onClick={() => supportDecision({ ...row, key: row.key }, 'reopen')}>Reopen</button></div>)}
              </>}
              {(queue.otherCohorts || []).map(other => <div key={other.id}>
                <button type="button" className="ac2-collapsed" aria-expanded={otherOpen === other.id} onClick={() => setOtherOpen(current => current === other.id ? null : other.id)}>
                  <span>{other.items.length} more in {other.name}</span><span>{otherOpen === other.id ? '▴' : '▾'}</span>
                </button>
                {otherOpen === other.id && other.items.map(item => <div className="ac2-auto-row" key={`${other.id}:${item.key}`}>
                  <span><strong>{item.title}{item.qualifier ? ` · ${item.qualifier}` : ''}</strong><br/>{item.meta}</span>
                  <button type="button" className="ac2-action" onClick={() => onOpenOtherCohortItem?.(other.id, item.href)}>Open</button>
                </div>)}
              </div>)}
            </div>
          </section>
        )}

        {tab === 'notifications' && (
          <section id="ac2-panel-notifications" role="tabpanel" aria-labelledby="ac2-tab-notifications" className="ac2-body">
            <div className="ac2-clip" aria-hidden="true" />
            <div className="ac2-notif-head"><span>{unread} unread</span>{unread > 0 && <button type="button" className="ac2-mark-all" onClick={() => notifications.markRead?.(null)}>Mark all read</button>}</div>
            <StaffNotificationsPanel items={notifications.items || []} unreadCount={unread} isLoading={notifications.isLoading} isError={notifications.isError}
              onMarkRead={notifications.markRead} onMarkAllRead={() => notifications.markRead?.(null)} onNavigateDestination={onNavigateNotificationDestination} hideHeader />
          </section>
        )}
        <div className="sr-only" aria-live="polite">{announcement}</div>
      </aside>
    </>
  )
}
