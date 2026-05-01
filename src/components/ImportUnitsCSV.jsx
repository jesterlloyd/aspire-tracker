import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { parseCSV } from '../lib/utils'

const EXPECTED_FIELDS = [
  { key: 'unit_name',       label: 'Unit Name',        required: true },
  { key: 'contact_person',  label: 'Contact Person' },
  { key: 'total_slots',     label: 'Number of Slots' },
  { key: 'shift_preference',label: 'Shift Preference' },
  { key: 'preceptors',      label: 'Preceptors' },
  { key: 'considerations',  label: 'Considerations' },
]

const ALIASES = {
  unit_name:        ['unit', 'name', 'unit name', 'unit_name', 'floor', 'department', 'room'],
  contact_person:   ['contact', 'person', 'contact person', 'nm', 'manager', 'charge', 'director'],
  total_slots:      ['slots', 'capacity', 'total', 'total slots', 'count', 'number', 'positions'],
  shift_preference: ['shift', 'preference', 'shift preference', 'schedule', 'shift pref'],
  preceptors:       ['preceptors', 'preceptor', 'nurses', 'staff', 'mentors', 'preceptor names'],
  considerations:   ['considerations', 'notes', 'comments', 'special', 'requirements', 'notes/comments'],
}

function guessField(header) {
  const h = header.toLowerCase().trim()
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.some(a => h === a || h.includes(a) || a.includes(h))) return field
  }
  return ''
}

export default function ImportUnitsCSV({ cohortId, onImported, onClose }) {
  const [step,      setStep]      = useState(1)
  const [csvData,   setCsvData]   = useState(null)   // { headers, rows }
  const [mapping,   setMapping]   = useState({})     // fieldKey -> csvHeader
  const [importing, setImporting] = useState(false)
  const [result,    setResult]    = useState(null)
  const [error,     setError]     = useState(null)
  const fileRef = useRef()

  const handleFile = e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { headers, rows } = parseCSV(ev.target.result)
      if (!headers.length) { setError('Could not read CSV headers.'); return }
      const autoMap = {}
      EXPECTED_FIELDS.forEach(f => {
        const guessed = headers.find(h => guessField(h) === f.key) || ''
        autoMap[f.key] = guessed
      })
      setCsvData({ headers, rows })
      setMapping(autoMap)
      setError(null)
      setStep(2)
    }
    reader.readAsText(file)
  }

  const previewRows = csvData?.rows.slice(0, 5) || []

  const getMapped = row => ({
    unit_name:        mapping.unit_name        ? row[mapping.unit_name]        : '',
    contact_person:   mapping.contact_person   ? row[mapping.contact_person]   : '',
    total_slots:      mapping.total_slots      ? parseInt(row[mapping.total_slots]) || 1 : 1,
    shift_preference: mapping.shift_preference ? row[mapping.shift_preference] : 'Either',
    preceptors:       mapping.preceptors       ? row[mapping.preceptors]       : '',
    considerations:   mapping.considerations   ? row[mapping.considerations]   : '',
  })

  const handleImport = async () => {
    if (!cohortId) { setError('No active cohort.'); return }
    setImporting(true)
    const records = csvData.rows
      .map(getMapped)
      .filter(r => r.unit_name.trim() !== '')
      .map(r => ({
        ...r,
        slots_remaining: r.total_slots,
        is_participating: true,
        cohort_id: cohortId,
      }))

    const { error: err } = await supabase.from('units').insert(records)
    if (err) { setError(err.message); setImporting(false); return }
    setResult(records.length)
    setStep(4)
    await onImported()
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal modal-lg" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Import Units from CSV</h2>
            <div className="import-steps">
              {['Upload', 'Map Columns', 'Preview', 'Done'].map((s, i) => (
                <span key={s} className={`import-step${step === i + 1 ? ' active' : ''}${step > i + 1 ? ' done' : ''}`}>
                  {i + 1}. {s}
                </span>
              ))}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}

          {/* Step 1: Upload */}
          {step === 1 && (
            <div className="import-upload-zone">
              <p className="import-hint">Upload a CSV file with unit data. The column mapper in the next step handles any column names.</p>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
              <button className="btn btn-primary" onClick={() => fileRef.current.click()}>
                Choose CSV File
              </button>
            </div>
          )}

          {/* Step 2: Column mapper */}
          {step === 2 && csvData && (
            <div>
              <p className="import-hint">Match your CSV columns to the expected fields. Required: Unit Name.</p>
              <div className="col-mapper">
                {EXPECTED_FIELDS.map(f => (
                  <div key={f.key} className="col-mapper-row">
                    <span className="col-mapper-field">
                      {f.label}{f.required && <span className="req-star"> *</span>}
                    </span>
                    <select
                      className="col-mapper-select"
                      value={mapping[f.key] || ''}
                      onChange={e => setMapping(prev => ({ ...prev, [f.key]: e.target.value }))}
                    >
                      <option value="">(skip)</option>
                      {csvData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 3 && csvData && (
            <div>
              <p className="import-hint">
                Preview of first {previewRows.length} of {csvData.rows.length} row(s).
                All rows with a unit name will be imported.
              </p>
              <div className="preview-table-wrap">
                <table className="preview-table">
                  <thead>
                    <tr>
                      {EXPECTED_FIELDS.map(f => mapping[f.key] && <th key={f.key}>{f.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => {
                      const m = getMapped(row)
                      return (
                        <tr key={i} className={!m.unit_name ? 'row-warn' : ''}>
                          {EXPECTED_FIELDS.map(f => mapping[f.key] && <td key={f.key}>{m[f.key]}</td>)}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div className="import-done">
              <div className="import-done-icon">✓</div>
              <p>{result} unit{result !== 1 ? 's' : ''} imported successfully.</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 1 && <button className="btn btn-outline-modal" onClick={onClose}>Cancel</button>}
          {step === 2 && (
            <>
              <button className="btn btn-outline-modal" onClick={() => setStep(1)}>Back</button>
              <button
                className="btn btn-primary"
                onClick={() => { if (!mapping.unit_name) { setError('Map the Unit Name column first.'); return } setError(null); setStep(3) }}
              >
                Preview
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button className="btn btn-outline-modal" onClick={() => setStep(2)}>Back</button>
              <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
                {importing ? 'Importing…' : `Import ${csvData?.rows.length} Row${csvData?.rows.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
          {step === 4 && <button className="btn btn-primary" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  )
}
