// HOME-1 (2026-09-24): the launcher, "What do you want to do today?"
//
// An ARIA combobox (role="combobox", aria-expanded, aria-controls, aria-activedescendant)
// over a role="listbox" of results in three groups: Actions, People, Keith. ⌘K (Ctrl+K
// on Windows) focuses the field from anywhere on the page. Up and Down move, Enter runs,
// Escape clears. Six quick-action chips sit under the field, in a fixed order. Every
// option comes from src/lib/home/launcherModel.js, already filtered by permission, so the
// list never offers what the viewer cannot complete.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, PenLine, ListChecks, Mail, CalendarDays, FileText, UserPlus, Send, Clock, Kanban, MessageSquare, HelpCircle,
} from 'lucide-react'
import { searchLauncher, moveSelection, quickActions } from '../../lib/home/launcherModel'
import { askKeith } from '../../lib/keithBus'

const ICON = { sign: PenLine, form: ListChecks, out: Mail, cal: CalendarDays, file: FileText, person: UserPlus, rel: Send, clock: Clock, board: Kanban, msg: MessageSquare, help: HelpCircle }

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

export default function Launcher({ actions = [], people = [], canAskKeith = true, onRun, onOpenPerson }) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const blurTimer = useRef(null)

  const result = useMemo(() => searchLauncher(query, { actions, people, canAskKeith }), [query, actions, people, canAskKeith])
  const options = result.options
  const expanded = open && options.length > 0
  const quick = useMemo(() => quickActions(actions), [actions])

  // ⌘K / Ctrl+K focuses the field from anywhere on the page.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => () => clearTimeout(blurTimer.current), [])

  const clear = () => { setQuery(''); setSel(0); setOpen(false) }

  const run = (opt) => {
    if (!opt) return
    if (opt.kind === 'keith') askKeith(opt.text)
    else if (opt.kind === 'person') onOpenPerson?.(opt.person)
    else onRun?.(opt.action)
    clear()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); clear(); return }
    if (!options.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setSel(i => moveSelection(i, 1, options.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setSel(i => moveSelection(i, -1, options.length)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(options[sel] || options[0]) }
  }

  const activeId = expanded && options[sel] ? `hm-opt-${options[sel].id}` : undefined

  return (
    <div className="hm-cmdwrap">
      <div className="hm-cmd">
        <Search className="hm-cmd-ico" size={20} aria-hidden="true" />
        <input
          ref={inputRef}
          id="hm-launcher"
          type="text"
          autoComplete="off"
          role="combobox"
          aria-expanded={expanded}
          aria-controls="hm-cmd-results"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label="What do you want to do today? Search actions, people, or ask Keith"
          placeholder="What do you want to do today?"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSel(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120) }}
          onKeyDown={onKeyDown}
        />
        <kbd className="hm-cmd-kbd" aria-hidden="true">{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
        <div id="hm-cmd-results" role="listbox" aria-label="Suggestions" className={`hm-results${expanded ? ' is-open' : ''}`}>
          {expanded && result.groups.actions.length > 0 && <div className="hm-results-grp" role="presentation">Actions</div>}
          {expanded && result.groups.actions.map((o, i) => (
            <div key={o.id} id={`hm-opt-${o.id}`} role="option" aria-selected={sel === i}
              onMouseDown={(e) => { e.preventDefault(); run(o) }} onMouseEnter={() => setSel(i)}>
              <span className="hm-opt-t">{o.title} <small>· {o.where}</small></span>
              <span className="hm-opt-kind">Action</span>
            </div>
          ))}
          {expanded && result.groups.people.length > 0 && <div className="hm-results-grp" role="presentation">People</div>}
          {expanded && result.groups.people.map((o, j) => {
            const i = result.groups.actions.length + j
            return (
              <div key={o.id} id={`hm-opt-${o.id}`} role="option" aria-selected={sel === i}
                onMouseDown={(e) => { e.preventDefault(); run(o) }} onMouseEnter={() => setSel(i)}>
                <span className="hm-opt-t">{o.title} <small>· {o.where}</small></span>
                <span className="hm-opt-actions">
                  {o.person.message && (
                    <button type="button" tabIndex={-1} className="hm-opt-sec"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRun?.({ key: 'message-person', to: o.person.message }); clear() }}>
                      Message
                    </button>
                  )}
                  {o.person.form && (
                    <button type="button" tabIndex={-1} className="hm-opt-sec"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRun?.({ key: 'form-person', to: o.person.form }); clear() }}>
                      Send a form
                    </button>
                  )}
                </span>
              </div>
            )
          })}
          {expanded && result.groups.keith && (() => {
            const o = result.groups.keith
            const i = options.length - 1
            return (
              <>
                <div className="hm-results-grp" role="presentation">Keith</div>
                <div id={`hm-opt-${o.id}`} role="option" aria-selected={sel === i} className="hm-opt-keith"
                  onMouseDown={(e) => { e.preventDefault(); run(o) }} onMouseEnter={() => setSel(i)}>
                  <span className="hm-opt-t">{o.title}</span>
                  <span className="hm-opt-kind hm-opt-kind-keith">Keith</span>
                </div>
              </>
            )
          })()}
        </div>
      </div>
      {quick.length > 0 && (
        <div className="hm-chips" aria-label="Quick actions">
          {quick.map(a => {
            const I = ICON[a.icon] || Send
            return (
              <button key={a.key} type="button" className="hm-chip" onClick={() => onRun?.(a)}>
                <I size={14} aria-hidden="true" /> {a.title}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
