// RESIDENCY-PROFILES-TOOLBAR-1 (Owner, 2026-11-03): "make the profiles pages the same". Residency >
// Profiles & Interest carries Student Profiles' toolbar actions, in Student Profiles' order:
//   Copy visible emails · Send Message to All · ↑ Import · + Add Alumnus
// The roster carries no emails or phones, so the two contact actions ask the server for the alumni
// on screen (ngrp-workspace `contacts`); Talent Acquisition gets only alumni who submitted the
// Transition Form, and the rest are counted, never named. Send Message to All is Student Profiles'
// own iPhone group-text modal (StudentMessagesSetup). Import is the ASPIRE team's (Owner, Admin).
import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import StudentMessagesSetup from '../student/StudentMessagesSetup'
import { copyVisibleStudentContacts } from '../../lib/connect/copyStudentContacts'
import { fetchRosterContacts } from '../../lib/ngrp/useNgrpData'
import ImportAlumniCSV from './ImportAlumniCSV'

function withheldLine(withheld) {
  if (!withheld) return null
  return `${withheld} ${withheld === 1 ? 'alumnus is' : 'alumni are'} left out: contact details are shared with Talent Acquisition once the Transition Form is submitted.`
}

export default function ResidencyRosterActions({ cycle, rows, toast, canContact, canImport, canAdd, onAdd, onImported }) {
  const [busy, setBusy] = useState(null)
  const [messages, setMessages] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const ids = rows.map(r => r.student.id)

  const load = async () => {
    const r = await fetchRosterContacts(cycle.id, ids)
    return { people: (r.contacts || []).map(c => ({ id: c.student_id, email: c.email, phone: c.phone })), withheld: r.withheld || 0 }
  }

  const copyEmails = async () => {
    setBusy('copy')
    try {
      const { people, withheld } = await load()
      await copyVisibleStudentContacts(people, 'email', toast, { emailOf: p => p.email })
      const line = withheldLine(withheld)
      if (line) toast?.info?.('Some alumni left out', line)
    } catch {
      toast?.error?.('Emails not loaded', 'Please try again.')
    }
    setBusy(null)
  }

  const openMessages = async () => {
    setBusy('text')
    try {
      setMessages(await load())
    } catch {
      toast?.error?.('Phone numbers not loaded', 'Please try again.')
    }
    setBusy(null)
  }

  return (
    <>
      {canContact && (
        <button type="button" className="profiles-copy-contact ngrp-roster-action" disabled={!ids.length || busy === 'copy'} onClick={copyEmails}>
          {busy === 'copy' ? 'Copying…' : 'Copy visible emails'}
        </button>
      )}
      {canContact && (
        <button type="button" className="profiles-copy-contact ngrp-roster-action" disabled={!ids.length || busy === 'text'} onClick={openMessages}>
          {busy === 'text' ? 'Loading…' : 'Send Message to All'}
        </button>
      )}
      {canImport && (
        <Tooltip label="Add alumni from a CSV of names or emails" placement="bottom" applyAriaLabel={false}>
          <button type="button" className="profiles-copy-contact ngrp-roster-action" onClick={() => setShowImport(true)}>↑ Import</button>
        </Tooltip>
      )}
      {canAdd && (
        <button type="button" className="profiles-copy-contact ngrp-roster-action" onClick={onAdd}>
          <UserPlus size={13} aria-hidden="true" /> Add Alumnus
        </button>
      )}
      {messages && (
        <StudentMessagesSetup students={messages.people} toast={toast} noun="alumni" className="ngrp-messages-overlay"
          note={withheldLine(messages.withheld)} onClose={() => setMessages(null)} />
      )}
      {showImport && (
        <ImportAlumniCSV cycle={cycle} toast={toast} onImported={onImported} onClose={() => setShowImport(false)} />
      )}
    </>
  )
}
