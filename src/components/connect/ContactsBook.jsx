// CONTACTS-BOOK-1 (2026-09-20): ASPIRE Connect > Contacts as an address book. An
// opt-in layout (Settings > Appearance > Contacts Layout, or the link beside Refresh);
// Classic stays the default and is untouched by this file.
//
// This component draws; it does not fetch. Everything it shows comes from the one
// useContactsDirectory call ContactsView makes for both layouts (`dir`), and every
// change it makes (search, category, selection) goes back through the same hook, so
// switching layouts keeps what the reader was looking at. The Add, Edit and Deactivate
// dialogs, the toast and the preceptor repair tool are ContactsView's (`actions`),
// shared with Classic. The only state that is the book's own is the thumb-index letter
// and the sentence it last announced.
//
// Two pages: the list files by LAST name under letter headers (contactsBookModel.js);
// the record on the right carries the whole contact, Recent Communications and Linked
// Students included, where Classic gives those a third column.
import { useEffect, useRef, useState } from 'react'
import { Mail, Pencil, Phone } from 'lucide-react'
import {
  getPrimaryCategory, getContactCategories, categoryPluralLabel, contactDisplayName,
  contactUnitList, contactServicesMeta, contactDivisionList, PRECEPTOR_ROLES,
} from '../../lib/contactCategories'
import { getStudentPreferredFullName } from '../../lib/studentNameFormatters'
import { copyVisibleContactEmails } from '../../lib/connect/copyContactEmails'
import {
  BOOK_LETTERS, sortForBook, bookRows, lettersPresent, contactLetter, entryLine, bookCountLine,
  initialsOf, commStatus, studentStatusTone, linkedStudentsHeading, shortDate,
} from '../../lib/connect/contactsBookModel'
import './contactsBook.css'

const NOTIF_LABELS = {
  coordinator_weekly_digest: 'Weekly Digest',
  coordinator_weekly_digest_test: 'Weekly Digest (Test)',
}
const notifLabel = (type) => NOTIF_LABELS[type] || type?.replace(/_/g, ' ') || '-'

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

function ThumbIndex({ letter, present, onPick }) {
  return (
    <nav className="ab-thumb" aria-label="Jump to letter">
      {BOOK_LETTERS.map(L => (
        <button
          key={L}
          type="button"
          className="ab-thumb-tab"
          aria-label={`Jump to ${L}`}
          aria-pressed={letter === L}
          disabled={!present.has(L)}
          onClick={() => onPick(L)}
        >
          {L}
        </button>
      ))}
    </nav>
  )
}

function Entry({ contact, current, onOpen, entryRef }) {
  const name = contactDisplayName(contact)
  return (
    <button
      ref={entryRef}
      type="button"
      className={`ab-entry${contact.is_active === false ? ' ab-entry-inactive' : ''}`}
      aria-current={current ? 'true' : undefined}
      onClick={() => onOpen(contact)}
    >
      <Avatar className="ab-av" url={contact.avatar_url} name={contact.full_name} />
      <span className="ab-entry-text">
        <span className="ab-nm">
          {name}{contact.is_active === false && <span className="ab-quiet"> · inactive</span>}
        </span>
        <span className="ab-rl">{entryLine(contact)}</span>
      </span>
    </button>
  )
}

// ── Right page ────────────────────────────────────────────────────────────────

function NamePlate({ contact, actions }) {
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
          <Mail size={14} aria-hidden="true" /> Email
        </button>
        {contact.phone ? (
          <a className="ab-act" href={`tel:${contact.phone}`}>
            <Phone size={14} aria-hidden="true" /> Call
          </a>
        ) : (
          <button type="button" className="ab-act" disabled title="No phone on file" aria-label="Call (no phone on file)">
            <Phone size={14} aria-hidden="true" /> Call
          </button>
        )}
        <button type="button" className="ab-act" onClick={() => actions.onEdit(contact)}>
          <Pencil size={14} aria-hidden="true" /> Edit
        </button>
        {contact.linkedin_url && (
          <a className="ab-act" href={contact.linkedin_url} target="_blank" rel="noreferrer">
            <span aria-hidden="true">in</span> LinkedIn
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

function Record({ contact, dir, actions }) {
  const digest = contact.notification_preferences?.weekly_digest !== false
  return (
    <article className="ab-rec" aria-label={contact.full_name}>
      <NamePlate contact={contact} actions={actions} />
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
    selectedId, selectContact, selected, showInactive, setShowInactive,
    categoryCounts, inactiveCount, activeCount, activeCategories, filtered,
  } = dir

  const [letter, setLetter] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const entriesRef = useRef(null)
  const currentRef = useRef(null)
  const recordRef = useRef(null)

  const inBook = showInactive ? contacts.length : activeCount
  const inCategory = categoryFilter === 'All' ? inBook : (categoryCounts[categoryFilter] || 0)

  // The thumb index answers "which letters does this category have?", so it ignores
  // the search text and the letter itself.
  const categoryPool = contacts.filter(c =>
    (showInactive || c.is_active !== false) &&
    (categoryFilter === 'All' || getContactCategories(c).includes(categoryFilter)))
  const present = lettersPresent(categoryPool)

  const sorted = sortForBook(filtered)
  const visible = letter ? sorted.filter(c => contactLetter(c) === letter) : sorted
  const rows = bookRows(visible)

  // A category or letter change that hides the open record opens the first entry
  // instead, the way turning to a letter in a book shows its first page. Typing in the
  // search box does not: the record stays on what the reader was reading.
  const lastFilterRef = useRef({ categoryFilter, letter })
  useEffect(() => {
    const prev = lastFilterRef.current
    lastFilterRef.current = { categoryFilter, letter }
    if (prev.categoryFilter === categoryFilter && prev.letter === letter) return
    if (visible.length > 0 && !visible.some(c => c.id === selectedId)) selectContact(visible[0].id)
  }, [categoryFilter, letter]) // eslint-disable-line react-hooks/exhaustive-deps

  // A selection that arrives from outside the book (a deep link, Universal Search) and
  // is not under the pressed letter clears the letter, so the entry is on the page.
  // Adjusted during render, React's pattern for state that follows a prop.
  const [seenSelectedId, setSeenSelectedId] = useState(selectedId)
  if (seenSelectedId !== selectedId) {
    setSeenSelectedId(selectedId)
    if (letter && selected && contactLetter(selected) !== letter) setLetter(null)
  }

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
  }, [selectedId, letter, categoryFilter, loading])

  const openEntry = (contact) => {
    selectContact(contact.id)
    setAnnouncement(`Opened ${contactDisplayName(contact)}`)
  }
  const pickLetter = (L) => {
    const next = letter === L ? null : L
    setLetter(next)
    setAnnouncement(next ? `Jumped to ${next}` : 'Letter filter cleared')
  }
  const pickCategory = (cat) => {
    setCategoryFilter(cat)
    setLetter(null)
  }

  return (
    <div className="ab-shell">
      <section className="ab-book material-leather-oxblood" aria-label="Contacts address book">
        <div className="ab-spread">

          <div className="ab-page ab-page-left">
            <ThumbIndex letter={letter} present={present} onPick={pickLetter} />
            <div className="ab-lhead">
              <div className="ab-lhead-top">
                <h2 className="ab-title">Contacts</h2>
                <button type="button" className="ab-add" onClick={actions.onAdd}>+ Add</button>
              </div>
              <input
                className="ab-search"
                type="search"
                value={search}
                onChange={e => { setSearch(e.target.value); setLetter(null) }}
                placeholder="Search name, school, role"
                aria-label="Search contacts"
              />
              <div className="ab-cats" role="group" aria-label="Category">
                {activeCategories.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    className="ab-cat"
                    aria-pressed={categoryFilter === cat}
                    onClick={() => pickCategory(cat)}
                  >
                    {cat === 'All' ? 'All Contacts' : categoryPluralLabel(cat)}
                    <b>{cat === 'All' ? inBook : (categoryCounts[cat] || 0)}</b>
                  </button>
                ))}
              </div>
              <div className="ab-count">
                {loading ? 'Loading…' : error ? 'Failed to load' : bookCountLine({
                  shown: visible.length, inCategory, inBook, isAll: categoryFilter === 'All',
                })}
              </div>
              {!loading && !error && (inactiveCount > 0 || visible.length > 0) && (
                <div className="ab-tools">
                  {inactiveCount > 0 ? (
                    <label>
                      <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                      Show inactive ({inactiveCount})
                    </label>
                  ) : <span />}
                  {visible.length > 0 && (
                    <button
                      type="button"
                      className="ab-link"
                      title="Copy the emails of the visible contacts (comma-separated)"
                      onClick={() => copyVisibleContactEmails(visible, actions.toast)}
                    >
                      Copy visible emails
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="ab-entries" ref={entriesRef}>
              {loading ? (
                <div className="ab-empty">Loading contacts…</div>
              ) : error ? (
                <div className="ab-empty">Failed to load: {error}</div>
              ) : rows.length === 0 ? (
                <div className="ab-empty">No contacts match.</div>
              ) : rows.map(row => row.type === 'letter' ? (
                <div key={`L-${row.letter}`} className="ab-sep" aria-hidden="true">{row.letter}</div>
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

            <div className="ab-foot">
              <button type="button" className="ab-link" onClick={actions.onRepair}>Repair Preceptor Contacts</button>
            </div>
          </div>

          <div className="ab-page ab-page-right">
            <div className="ab-record-scroll" ref={recordRef}>
              {selected ? (
                <Record contact={selected} dir={dir} actions={actions} />
              ) : (
                <div className="ab-blank">
                  {loading ? 'Loading…' : filtered.length > 0
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
