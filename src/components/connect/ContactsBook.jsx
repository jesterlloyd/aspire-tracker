// CONTACTS-BOOK-1 (2026-09-20): ASPIRE Connect > Contacts as an address book. An
// opt-in layout (Settings > Appearance > Contacts Layout, or the link beside Refresh);
// Classic stays the default and is untouched by this file.
//
// This component draws; it does not fetch. Everything it shows comes from the one
// useContactsDirectory call ContactsView makes for both layouts (`dir`), and every
// change it makes (search, category, selection) goes back through the same hook, so
// switching layouts keeps what the reader was looking at. The Add, Edit, Deactivate and
// flag writes, and the toast, are ContactsView's (`actions`). The book's own state is
// the letter bubble, the Flagged only filter, and the sentence it last announced.
//
// Two pages bound in cognac: the list files by LAST name under letter headers
// (contactsBookModel.js); the record on the right carries the whole contact, Recent
// Communications and Linked Students included, where Classic gives those a third column.
//
// CONTACTS-BOOK-3 (Owner, 2026-09-20): the book lists inactive contacts, marked, instead
// of hiding them behind a toggle, so any contact can be opened and reactivated here; it
// carries the canonical follow-up ribbon; its header is search and Add on one row, the
// categories, then the count with Flagged only and Copy visible emails.
import { useEffect, useRef, useState } from 'react'
import { Mail, Pencil, Phone } from 'lucide-react'
import FlagRibbon from '../rubric/FlagRibbon'
import {
  getPrimaryCategory, categoryPluralLabel, contactDisplayName,
  contactUnitList, contactServicesMeta, contactDivisionList, PRECEPTOR_ROLES,
} from '../../lib/contactCategories'
import { getStudentPreferredFullName } from '../../lib/studentNameFormatters'
import { copyVisibleContactEmails } from '../../lib/connect/copyContactEmails'
import { isContactFlagged, contactFlagAvailable } from '../../lib/contactFollowUpFlag'
import { contactMatches, countCategories, CATEGORY_ORDER } from '../../lib/connect/contactsDirectoryFilter'
import {
  BOOK_LETTERS, sortForBook, bookRows, lettersPresent, nearestLetter, entryLine, bookCountLine,
  initialsOf, commStatus, studentStatusTone, linkedStudentsHeading, shortDate,
} from '../../lib/connect/contactsBookModel'
import './contactsBook.css'

const NOTIF_LABELS = {
  coordinator_weekly_digest: 'Weekly Digest',
  coordinator_weekly_digest_test: 'Weekly Digest (Test)',
}
const notifLabel = (type) => NOTIF_LABELS[type] || type?.replace(/_/g, ' ') || '-'

// How long the letter bubble stays after a press, a drag or a keyboard jump.
const BUBBLE_LINGER_MS = 650

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

function relativeDays(iso) {
  if (!iso) return null
  const diff = Math.floor((Date.now() - new Date(iso)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 30) return `${diff}d ago`
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`
  return `${Math.floor(diff / 365)}y ago`
}

function Avatar({ className, url, name }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={className} aria-hidden="true">
      {initialsOf(name)}
      {url && !failed && <img src={url} alt="" decoding="async" loading="lazy" onError={() => setFailed(true)} />}
    </span>
  )
}

function CopyValue({ value, label }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button type="button" className="ab-copy" onClick={copy} aria-label={copied ? `${label} copied` : `Copy ${label}`}>
      {copied ? '✓' : '⎘'}
    </button>
  )
}

function Section({ title, count, children }) {
  return (
    <section className="ab-sec" aria-label={title}>
      <h4 className="ab-sec-h">
        <span>{title}</span>
        {count != null && <em>{count}</em>}
      </h4>
      {children}
    </section>
  )
}

function Field({ label, children }) {
  return (
    <div className="ab-fld">
      <span className="ab-fld-k">{label}</span>
      <span className="ab-fld-v">{children}</span>
    </div>
  )
}

// ── Left page ─────────────────────────────────────────────────────────────────

// The index is a scrubber, not a filter (CONTACTS-BOOK-2, Owner 2026-09-20). Press a
// letter, or press and drag through the column with a mouse or a finger, and the list
// scrolls to the first contact filed under it; the whole list stays scrollable.
// CONTACTS-BOOK-3 (Owner): the letter bubble appears only for a press, a drag or a
// keyboard jump. Hovering never shows it; a hovered letter lifts on a paper face and a
// shadow instead (contactsBook.css), and only a pressed or dragged letter goes dark.
// The column captures the pointer, so a drag keeps working when it strays sideways, and
// `touch-action: none` keeps a finger from scrolling the page instead. A letter with
// nothing under it is disabled and lets the pointer through to the column, so a drag
// passes over it to the nearest letter that has entries. Keyboard: each letter is a
// button, and Enter or Space jumps; a pointer press is handled on the column, so a
// button's own click only acts when it came from the keyboard (detail 0).
function ThumbIndex({ present, active, onPoint, onJump, onRelease, onKeyJump }) {
  const navRef = useRef(null)
  const dragging = useRef(false)
  const last = useRef(null)

  const letterAt = (clientY) => {
    let best = null
    let bestGap = Infinity
    for (const tab of navRef.current?.querySelectorAll('[data-letter]') || []) {
      const r = tab.getBoundingClientRect()
      const gap = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0
      if (gap < bestGap) { bestGap = gap; best = tab.dataset.letter }
    }
    return best
  }
  const point = (L) => {
    if (!L || L === last.current) return
    last.current = L
    onPoint(L)
    onJump(L)
  }
  const end = (pressed) => {
    if (!dragging.current) return
    dragging.current = false
    last.current = null
    onRelease(pressed)
  }

  return (
    <nav
      ref={navRef}
      className="ab-thumb"
      aria-label="Jump to letter"
      onPointerDown={e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        e.preventDefault()
        dragging.current = true
        last.current = null
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* capture unavailable */ }
        point(letterAt(e.clientY))
      }}
      onPointerMove={e => { if (dragging.current) point(letterAt(e.clientY)) }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
    >
      {BOOK_LETTERS.map(L => (
        <button
          key={L}
          type="button"
          className="ab-thumb-tab"
          data-letter={L}
          data-active={active === L ? 'true' : undefined}
          aria-label={`Jump to ${L}`}
          disabled={!present.has(L)}
          onClick={e => { if (e.detail === 0) onKeyJump(L) }}
        >
          {L}
        </button>
      ))}
    </nav>
  )
}

function Entry({ contact, current, onOpen, entryRef }) {
  const name = contactDisplayName(contact)
  const inactive = contact.is_active === false
  const flagged = isContactFlagged(contact)
  return (
    <button
      ref={entryRef}
      type="button"
      className={`ab-entry${inactive ? ' ab-entry-inactive' : ''}`}
      aria-current={current ? 'true' : undefined}
      onClick={() => onOpen(contact)}
    >
      <Avatar className="ab-av" url={contact.avatar_url} name={contact.full_name} />
      <span className="ab-entry-text">
        <span className="ab-nm">
          {name}{inactive && <span className="ab-quiet"> · inactive</span>}
        </span>
        <span className="ab-rl">{entryLine(contact)}</span>
      </span>
      {flagged
        ? <span className="ab-flagmark" aria-hidden="true" />
        : <span aria-hidden="true" />}
      {flagged && <span className="sr-only">, flagged for follow-up</span>}
    </button>
  )
}

// ── Right page ────────────────────────────────────────────────────────────────

// Email, Call and Edit wear Student Profiles' icons at its size (Mail, Phone, Pencil at
// 15px), so the two records read alike; LinkedIn is the wordmark from /public, as
// Classic shows it.
function NamePlate({ contact, actions, flagAvailable }) {
  const flagged = isContactFlagged(contact)
  return (
    <div className="ab-plate">
      <Avatar className="ab-photo" url={contact.avatar_url} name={contact.full_name} />
      <h3 className="ab-name">{contact.full_name}</h3>
      {contact.preferred_name && <div className="ab-goes-by">goes by {contact.preferred_name}</div>}
      <div className="ab-role">
        {contact.role && <span className="ab-role-badge">{contact.role}</span>}
        {contact.role_qualifier && <span className="ab-role-note">· {contact.role_qualifier}</span>}
        {contact.is_active === false && <span className="ab-flag">Inactive</span>}
      </div>
      {contact.organization && <div className="ab-org">{contact.organization}</div>}
      {/* The ribbon's state in words, the rubric's pattern: a pull is not self-explaining. */}
      <div className="ab-flagnote">
        {!flagAvailable
          ? 'Follow-up flags are not enabled yet.'
          : flagged
            ? <><b>Flagged for follow-up.</b> Pull the ribbon up to clear.</>
            : 'Not flagged. Pull the ribbon down to flag for follow-up.'}
      </div>
      <div className="ab-acts">
        <button
          type="button"
          className="ab-act ab-act-primary"
          disabled={!contact.email}
          title={contact.email ? undefined : 'No email on file'}
          onClick={() => actions.navigate(
            `/connect/outreach?mode=message&contactId=${contact.id}`,
            { state: { fromContact: { id: contact.id, name: contact.full_name, email: contact.email } } }
          )}
        >
          <Mail size={15} aria-hidden="true" /> Email
        </button>
        {contact.phone ? (
          <a className="ab-act" href={`tel:${contact.phone}`}>
            <Phone size={15} aria-hidden="true" /> Call
          </a>
        ) : (
          <button type="button" className="ab-act" disabled title="No phone on file" aria-label="Call (no phone on file)">
            <Phone size={15} aria-hidden="true" /> Call
          </button>
        )}
        <button type="button" className="ab-act" onClick={() => actions.onEdit(contact)}>
          <Pencil size={15} aria-hidden="true" /> Edit
        </button>
        {contact.linkedin_url && (
          <a className="ab-act ab-act-linkedin" href={contact.linkedin_url} target="_blank" rel="noreferrer">
            <img src="/linkedin-logo.svg" alt="LinkedIn" height={17} />
          </a>
        )}
      </div>
    </div>
  )
}

// Email, phone and affiliation, in that order: the Classic profile's Contact,
// Affiliation and Last Contact cards, written as fields on one page.
function ContactSection({ contact }) {
  const category = getPrimaryCategory(contact)
  const units = contactUnitList(contact)
  const divisions = contactDivisionList(contact)
  const servicesLabel = contactServicesMeta(category, contact.role)?.label || 'Services'
  const school = [contact.school_name, contact.program_type].filter(Boolean).join(' · ')
  return (
    <Section title="Contact">
      <div>
        <Field label="Email">
          {contact.email
            ? <>{contact.email}<CopyValue value={contact.email} label="email" /></>
            : <span className="ab-quiet">No email on file</span>}
        </Field>
        {contact.phone && (
          <Field label="Phone">{contact.phone}<CopyValue value={contact.phone} label="phone" /></Field>
        )}
        {school && <Field label="School">{school}</Field>}
        {units.length > 0 && <Field label={units.length > 1 ? 'Units' : 'Unit'}>{units.join(', ')}</Field>}
        {contact.services && <Field label={servicesLabel}>{contact.services}</Field>}
        {divisions.length > 0 && <Field label="Divisions">{divisions.join(', ')}</Field>}
        {!school && units.length === 0 && contact.organization && (
          <Field label="Affiliation">{contact.organization}</Field>
        )}
        {(contact.last_contacted_at || contact.last_contact_summary) && (
          <Field label="Last contact">
            {contact.last_contacted_at && (
              <>
                {relativeDays(contact.last_contacted_at)}
                <span className="ab-quiet"> · {shortDate(contact.last_contacted_at)}
                  {contact.last_contact_type ? ` · ${contact.last_contact_type.replace(/_/g, ' ')}` : ''}</span>
              </>
            )}
            {contact.last_contact_summary && <div className="ab-quiet">{contact.last_contact_summary}</div>}
          </Field>
        )}
      </div>
    </Section>
  )
}

function CommsSection({ contact, commHistory, loadingComm, navigate }) {
  return (
    <Section title="Recent Communications" count={loadingComm ? null : `${commHistory.length} shown`}>
      {loadingComm ? (
        <div className="ab-quiet">Loading…</div>
      ) : commHistory.length === 0 ? (
        <div className="ab-quiet">No communication history on file. Sent emails and digest records will appear here.</div>
      ) : (
        <div>
          {commHistory.map(log => {
            const subject = log.subject || notifLabel(log.notification_type)
            const st = commStatus(log.status)
            return (
              <div className="ab-log-row" key={log.id}>
                <span className="ab-log-sj" title={subject}>{subject}</span>
                <span className={`ab-log-st ab-tone-${st.tone}`}>{st.label}</span>
                <span className="ab-log-dt">{shortDate(log.sent_at)}</span>
              </div>
            )
          })}
        </div>
      )}
      <button
        type="button"
        className="ab-seeall"
        onClick={() => navigate(`/connect/outreach?tab=sent_history&contact_id=${contact.id}`)}
      >
        View all communications for this contact →
      </button>
    </Section>
  )
}

function StudentsSection({ contact, linkedStudents, linkedStudentsTotal, loadingStudents }) {
  const isPreceptor = PRECEPTOR_ROLES.has(contact.role)
  const hasSource = isPreceptor ? !!contact.email : !!contact.school_name
  const ready = hasSource && !loadingStudents
  return (
    <Section title="Linked Students" count={ready ? linkedStudentsHeading(linkedStudents, linkedStudentsTotal) : null}>
      {!hasSource ? (
        <div className="ab-quiet">Linked students and cohort relationships will appear here when available.</div>
      ) : loadingStudents ? (
        <div className="ab-quiet">Loading…</div>
      ) : linkedStudents.length === 0 ? (
        <div className="ab-quiet">
          {isPreceptor
            ? 'No students currently assigned to this preceptor.'
            : `No current students at ${contact.school_name} in the active cohort.`}
        </div>
      ) : (
        <div>
          {linkedStudents.map(s => {
            const name = getStudentPreferredFullName(s)
            return (
              <div className="ab-stud" key={s.id}>
                <span className="ab-stud-av" aria-hidden="true">{initialsOf(name)}</span>
                <span>{name}</span>
                <span className={`ab-stud-st ab-tone-${studentStatusTone(s.status)}`}>{s.status || '-'}</span>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

function Record({ contact, dir, actions, flagAvailable }) {
  const digest = contact.notification_preferences?.weekly_digest !== false
  return (
    <article className="ab-rec" aria-label={contact.full_name}>
      <NamePlate contact={contact} actions={actions} flagAvailable={flagAvailable} />
      <ContactSection contact={contact} />
      <Section title="Notes">
        {contact.notes
          ? <div className="ab-note">{contact.notes}</div>
          : <div className="ab-note ab-note-empty">No notes yet.</div>}
      </Section>
      {/* Only what the system stores: the weekly digest is the one preference a contact has. */}
      <Section title="Notification Preferences">
        <div className="ab-prefs">
          <span className={`ab-pill ab-tone-${digest ? 'ok' : 'neutral'}`}>Weekly digest {digest ? 'on' : 'off'}</span>
        </div>
      </Section>
      <CommsSection contact={contact} commHistory={dir.commHistory} loadingComm={dir.loadingComm} navigate={actions.navigate} />
      <StudentsSection
        contact={contact}
        linkedStudents={dir.linkedStudents}
        linkedStudentsTotal={dir.linkedStudentsTotal}
        loadingStudents={dir.loadingStudents}
      />
      <div className="ab-closing">
        <button type="button" className="ab-link" onClick={() => actions.onDeactivate(contact)}>
          {contact.is_active === false ? 'Reactivate Contact' : 'Deactivate Contact'}
        </button>
      </div>
    </article>
  )
}

// ── The book ──────────────────────────────────────────────────────────────────

export default function ContactsBook({ dir, actions }) {
  const {
    contacts, loading, error, search, setSearch, categoryFilter, setCategoryFilter,
    selectedId, selectContact, selected,
  } = dir

  const [announcement, setAnnouncement] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  // The bubble keeps its letter while it fades, so it never flashes empty on the way out.
  const [bubbleLetter, setBubbleLetter] = useState(null)
  const [bubbleOn, setBubbleOn] = useState(false)
  const bubbleTimer = useRef(null)
  const lastJump = useRef(null)
  const entriesRef = useRef(null)
  const currentRef = useRef(null)
  const recordRef = useRef(null)

  // The book lists every contact, inactive ones marked (Owner, CONTACTS-BOOK-3), so it
  // applies the shared filter and counts with inactive contacts included. Classic keeps
  // its own toggle; the hook's `filtered` and `categoryCounts` are Classic's.
  const categoryCounts = countCategories(contacts, { showInactive: true })
  const categories = CATEGORY_ORDER.filter(cat => cat === 'All' || (categoryCounts[cat] || 0) > 0)
  const inCategory = categoryFilter === 'All' ? contacts.length : (categoryCounts[categoryFilter] || 0)
  const flagAvailable = contacts.length > 0 && contactFlagAvailable(contacts[0])
  const matching = contacts.filter(c => contactMatches(c, { search, categoryFilter, showInactive: true }))
  const shown = flaggedOnly && flagAvailable ? matching.filter(isContactFlagged) : matching

  const sorted = sortForBook(shown)
  const rows = bookRows(sorted)
  // A letter is live when the list has something filed under it: the index moves the
  // list, so a letter with no entries in it has nowhere to go.
  const present = lettersPresent(sorted)

  // A category or Flagged only change that hides the open record opens the first entry
  // instead. Typing in the search box does not: the record stays on what the reader
  // was reading.
  const lastViewRef = useRef({ categoryFilter, flaggedOnly })
  useEffect(() => {
    const prev = lastViewRef.current
    lastViewRef.current = { categoryFilter, flaggedOnly }
    if (prev.categoryFilter === categoryFilter && prev.flaggedOnly === flaggedOnly) return
    if (sorted.length > 0 && !sorted.some(c => c.id === selectedId)) selectContact(sorted[0].id)
  }, [categoryFilter, flaggedOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  // The selected entry scrolls into view inside the list (never the page around it),
  // and the record returns to its top.
  useEffect(() => {
    const box = entriesRef.current
    const el = currentRef.current
    if (box && el) {
      const top = el.offsetTop
      const bottom = top + el.offsetHeight
      if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
        box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: reducedMotion() ? 'auto' : 'smooth' })
      }
    }
    if (recordRef.current) recordRef.current.scrollTop = 0
  }, [selectedId, categoryFilter, flaggedOnly, loading])

  useEffect(() => () => clearTimeout(bubbleTimer.current), [])

  // Scroll the list so the letter's header is its first line. Instant, because a drag
  // asks for a new letter on every move and a smooth scroll would lag behind the finger.
  const jumpTo = (L) => {
    const target = nearestLetter(L, present)
    const box = entriesRef.current
    const header = target && box ? box.querySelector(`[data-letter="${target}"]`) : null
    if (!header) return null
    box.scrollTop = header.offsetTop
    lastJump.current = target
    return target
  }
  const showBubble = (L) => {
    clearTimeout(bubbleTimer.current)
    setBubbleLetter(L)
    setBubbleOn(true)
  }
  const fadeBubble = () => {
    clearTimeout(bubbleTimer.current)
    bubbleTimer.current = setTimeout(() => setBubbleOn(false), BUBBLE_LINGER_MS)
  }
  // A press or a drag leaves the bubble up for a moment so the reader sees where they
  // landed, then announces the letter once, not on every letter the drag passed.
  const releaseIndex = (pressed) => {
    if (pressed && lastJump.current) setAnnouncement(`Jumped to ${lastJump.current}`)
    fadeBubble()
  }
  const keyJump = (L) => {
    const target = jumpTo(L)
    if (!target) return
    showBubble(target)
    setAnnouncement(`Jumped to ${target}`)
    fadeBubble()
  }

  const openEntry = (contact) => {
    selectContact(contact.id)
    setAnnouncement(`Opened ${contactDisplayName(contact)}`)
  }

  return (
    <div className="ab-shell">
      <section className="ab-book material-leather-cognac material-forestack" aria-label="Contacts address book">
        {/* The gilt rule tooled into the cover. Its own element: the cover's two
            pseudo-elements draw the page stack either side of the spread. */}
        <span className="ab-tooling" aria-hidden="true" />

        {/* The ribbon is sewn into the cover, as in the rubric and the chart, and hangs
            over the record's page. */}
        {selected && (
          <FlagRibbon
            flagged={isContactFlagged(selected)}
            disabled={!flagAvailable || !actions.onFlag}
            onFlag={() => actions.onFlag(selected, true)}
            onUnflag={() => actions.onFlag(selected, false)}
            classPrefix="ab-ribbon"
            labelOn={`${selected.full_name} is flagged for follow-up. Pull the ribbon up, or press, to remove the flag.`}
            labelOff={flagAvailable
              ? `Pull the ribbon down, or press, to flag ${selected.full_name} for follow-up.`
              : 'The follow-up flag is not enabled on this database yet.'}
          />
        )}

        <div className="ab-spread">

          <div className="ab-page ab-page-left">
            <ThumbIndex
              present={present}
              active={bubbleOn ? bubbleLetter : null}
              onPoint={showBubble}
              onJump={jumpTo}
              onRelease={releaseIndex}
              onKeyJump={keyJump}
            />
            <div className="ab-lhead">
              <h2 className="sr-only">Contacts</h2>
              <div className="ab-lhead-row">
                <input
                  className="ab-search"
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, school, role"
                  aria-label="Search contacts"
                />
                <button type="button" className="ab-add" onClick={actions.onAdd}>+ Add contact</button>
              </div>
              <div className="ab-cats" role="group" aria-label="Category">
                {categories.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    className="ab-cat"
                    aria-pressed={categoryFilter === cat}
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat === 'All' ? 'All Contacts' : categoryPluralLabel(cat)}
                    <b>{cat === 'All' ? contacts.length : (categoryCounts[cat] || 0)}</b>
                  </button>
                ))}
              </div>
              <div className="ab-lhead-row ab-lhead-meta">
                <span className="ab-count">
                  {loading ? 'Loading…' : error ? 'Failed to load' : bookCountLine({ shown: sorted.length, inCategory })}
                </span>
                {!loading && !error && (
                  <span className="ab-meta-tools">
                    {flagAvailable && (
                      <button
                        type="button"
                        className="ab-flagfilter"
                        aria-pressed={flaggedOnly}
                        onClick={() => setFlaggedOnly(v => !v)}
                      >
                        <i aria-hidden="true" />Flagged only
                      </button>
                    )}
                    {sorted.length > 0 && (
                      <button
                        type="button"
                        className="ab-link"
                        title="Copy the emails of the contacts in this list (comma-separated)"
                        onClick={() => copyVisibleContactEmails(sorted, actions.toast)}
                      >
                        Copy visible emails
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* The bubble sits over the list, not inside its scroller, so it stays dead centre
                however far the list moves under it. */}
            <div className="ab-entries-wrap">
              <div className="ab-entries" ref={entriesRef}>
                {loading ? (
                  <div className="ab-empty">Loading contacts…</div>
                ) : error ? (
                  <div className="ab-empty">Failed to load: {error}</div>
                ) : rows.length === 0 ? (
                  <div className="ab-empty">{flaggedOnly ? 'No flagged contacts here.' : 'No contacts match.'}</div>
                ) : rows.map(row => row.type === 'letter' ? (
                  <div key={`L-${row.letter}`} className="ab-sep" data-letter={row.letter} aria-hidden="true">{row.letter}</div>
                ) : (
                  <Entry
                    key={row.contact.id}
                    contact={row.contact}
                    current={row.contact.id === selectedId}
                    entryRef={row.contact.id === selectedId ? currentRef : undefined}
                    onOpen={openEntry}
                  />
                ))}
              </div>
              <div className={`ab-bubble${bubbleOn ? ' ab-bubble-on' : ''}`} aria-hidden="true">{bubbleLetter}</div>
            </div>
          </div>

          <div className="ab-page ab-page-right">
            <div className="ab-record-scroll" ref={recordRef}>
              {selected ? (
                <Record contact={selected} dir={dir} actions={actions} flagAvailable={flagAvailable} />
              ) : (
                <div className="ab-blank">
                  {loading ? 'Loading…' : sorted.length > 0
                    ? 'Choose a contact from the list to open their record.'
                    : 'No contacts match your current search or filter.'}
                </div>
              )}
            </div>
          </div>

        </div>
      </section>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  )
}
