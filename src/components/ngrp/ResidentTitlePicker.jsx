// HIRE-HISTORY-3 (Owner, 2026-11-04): a resident's title is picked from one list, offered by its
// short name (CN I ... CNS), with Other opening a box for anything else. The value is the stored
// title in full words; a title stored before the list (RN Resident) opens as Other with its words.
// One picker for the binder's past-hire form and the resident details editor.
import { useState } from 'react'
import { POSITION_TITLES, TITLE_SHORT, OTHER_TITLE } from '../../lib/ngrp/ngrpResidents'

export default function ResidentTitlePicker({ id, value, onChange, disabled = false, className, style, inputClassName, inputStyle, emptyLabel = 'Not recorded' }) {
  const listed = POSITION_TITLES.includes(value)
  const [other, setOther] = useState(Boolean(value) && !listed)
  const choice = other ? OTHER_TITLE : listed ? value : ''
  return (
    <>
      <select id={id} className={className} style={style} value={choice} disabled={disabled}
        onChange={e => {
          const v = e.target.value
          if (v === OTHER_TITLE) { setOther(true); if (listed) onChange('') }
          else { setOther(false); onChange(v) }
        }}>
        <option value="">{emptyLabel}</option>
        {POSITION_TITLES.map(t => <option key={t} value={t}>{TITLE_SHORT[t] || t}</option>)}
        <option value={OTHER_TITLE}>Other</option>
      </select>
      {other && (
        <input className={inputClassName} style={{ marginTop: 8, ...inputStyle }} value={value || ''} maxLength={120} disabled={disabled}
          onChange={e => onChange(e.target.value)} placeholder="Type the title" aria-label="Other title" />
      )}
    </>
  )
}
