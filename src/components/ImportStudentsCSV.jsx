import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { parseCSV, downloadCSV } from '../lib/utils'
import { SCHOOLS, INTERVIEW_OUTCOMES } from '../lib/constants'

const TEMPLATE_HEADERS = [
  'name', 'school_email', 'personal_email', 'phone', 'school',
  'aspire_cohort', 'term_dates', 'hours_required', 'coordinators',
  'interview_outcome', 'shift_availability',
  'unit_preference_1', 'unit_preference_2', 'unit_preference_3', 'notes',
]

function validateRow(row, idx) {
  const warnings = []
  if (!row.name?.trim()) warnings.push(`Row ${idx + 2}: Missing name — will be skipped`)
  if (row.school && !SCHOOLS.includes(row.school))
    warnings.push(`Row ${idx + 2}: Unrecognized school "${row.school}"`)
  if (row.interview_outcome && !INTERVIEW_OUTCOMES.includes(row.interview_outcome))
    warnings.push(`Row ${idx + 2}: Unrecognized interview outcome "${row.interview_outcome}"`)
  return warnings
}

export default function ImportStudentsCSV({ cohortId, onImported, onClose }) {
  const [step,      setStep]      = useState(1)
  const [rows,      setRows]      = useState([])
  const [warnings,  setWarnings]  = useState([])
  const [importing, setImporting] = useState(false)
  const [result,    setResult]    = useState(null)
  const [error,     setError]     = useState(null)
  const fileRef = useRef()

  const handleDownloadTemplate = () => {
    downloadCSV(TEMPLATE_HEADERS.join(',') + '\n', 'aspire_student_template.csv')
  }

  const handleFile = e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { rows: parsed } = parseCSV(ev.target.result)
      if (!parsed.length) { setError('CSV appears to be empty or could not be parsed.'); return }
      const allWarnings = parsed.flatMap((row, i) => validateRow(row, i))
      setRows(parsed)
      setWarnings(allWarnings)
      setError(null)
      setStep(2)
    }
    reader.readAsText(file)
  }

  const validRows = rows.filter(r => r.name?.trim())

  const handleImport = async () => {
    if (!cohortId) { setError('No active cohort selected.'); return }
    setImporting(true)
    const records = validRows.map(r => ({
      name:              r.name?.trim() || '',
      school_email:      r.school_email || '',
      personal_email:    r.personal_email || '',
      phone:             r.phone || '',
      school:            r.school || '',
      aspire_cohort:     r.aspire_cohort || '',
      term_dates:        r.term_dates || '',
      hours_required:    parseInt(r.hours_required) || 0,
      hours_completed:   0,
      coordinators:      r.coordinators || '',
      interview_outcome: INTERVIEW_OUTCOMES.includes(r.interview_outcome) ? r.interview_outcome : 'Pending Interview',
      shift_availability: r.shift_availability || '',
      unit_preference_1:  r.unit_preference_1 || '',
      unit_preference_2:  r.unit_preference_2 || '',
      unit_preference_3:  r.unit_preference_3 || '',
      notes:             r.notes || '',
      status:            'Form Sent',
      ngrp_outcome:      'Pending',
      gpa_verified:      false,
      bls_current:       false,
      health_cleared:    false,
      background_check:  false,
      cohort_id:         cohortId,
    }))

    const { error: err } = await supabase.from('students').insert(records)
    if (err) { setError(err.message); setImporting(false); return }
    setResult({ imported: records.length, skipped: rows.length - records.length })
    setStep(3)
    await onImported()
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal modal-lg" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Import Students from CSV</h2>
            <div className="import-steps">
              {['Upload', 'Preview', 'Done'].map((s, i) => (
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
              <p className="import-hint">
                Upload a CSV using the template format. The first row must be column headers.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-outline-modal" onClick={handleDownloadTemplate}>
                  ↓ Download Template
                </button>
                <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
                <button className="btn btn-primary" onClick={() => fileRef.current.click()}>
                  Choose CSV File
                </button>
              </div>
              <p className="import-hint" style={{ marginTop: 12, fontSize: 12 }}>
                Template columns: {TEMPLATE_HEADERS.join(', ')}
              </p>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 2 && (
            <div>
              <div className="import-summary-row">
                <span className="import-count">{rows.length} rows found</span>
                <span className="import-valid">{validRows.length} valid</span>
                {rows.length - validRows.length > 0 && (
                  <span className="import-skip">{rows.length - validRows.length} will be skipped</span>
                )}
              </div>
              {warnings.length > 0 && (
                <div className="import-warnings">
                  {warnings.map((w, i) => <div key={i} className="import-warning-item">⚠ {w}</div>)}
                </div>
              )}
              <div className="preview-table-wrap">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>School</th>
                      <th>School Email</th>
                      <th>Interview Outcome</th>
                      <th>Shift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={!row.name?.trim() ? 'row-warn' : ''}>
                        <td>{i + 1}</td>
                        <td>{row.name || <em style={{ color: '#dc2626' }}>missing</em>}</td>
                        <td>{row.school}</td>
                        <td>{row.school_email}</td>
                        <td>{row.interview_outcome}</td>
                        <td>{row.shift_availability}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && result && (
            <div className="import-done">
              <div className="import-done-icon">✓</div>
              <p>{result.imported} student{result.imported !== 1 ? 's' : ''} imported.</p>
              {result.skipped > 0 && <p className="import-skip">{result.skipped} row{result.skipped !== 1 ? 's' : ''} skipped (missing name).</p>}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 1 && <button className="btn btn-outline-modal" onClick={onClose}>Cancel</button>}
          {step === 2 && (
            <>
              <button className="btn btn-outline-modal" onClick={() => setStep(1)}>Back</button>
              <button className="btn btn-primary" onClick={handleImport} disabled={importing || !validRows.length}>
                {importing ? 'Importing…' : `Import ${validRows.length} Student${validRows.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
          {step === 3 && <button className="btn btn-primary" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  )
}
