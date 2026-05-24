import { useState, useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import PreceptorFormModal from './PreceptorFormModal'

export default function PreceptorAssignmentModal({ isOpen, onClose, student, onAssigned }) {
  const [query,       setQuery]       = useState('')
  const [results,     setResults]     = useState([])
  const [searching,   setSearching]   = useState(false)
  const [selected,    setSelected]    = useState(null)
  const [confirming,  setConfirming]  = useState(false)
  const [addOpen,     setAddOpen]     = useState(false)
  const [error,       setError]       = useState(null)
  const debounceRef   = useRef(null)
  const inputRef      = useRef(null)
  const queryClient   = useQueryClient()

  // Reset on open
  useEffect(() => {
    if (!isOpen) return
    setQuery(''); setResults([]); setSearching(false)
    setSelected(null); setConfirming(false); setError(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [isOpen])

  const runSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); setSearching(false); return }
    setSearching(true)
    const { data } = await supabase
      .from('preceptors')
      .select(`
        id, full_name, email, unit_name, shift_type, is_active,
        preceptor_cohort_participation ( cohort_id, status )
      `)
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .eq('is_active', true)
      .order('full_name')
      .limit(10)
    setResults(data || [])
    setSearching(false)
  }, [])

  const handleQueryChange = e => {
    const q = e.target.value
    setQuery(q)
    setSelected(null)
    setSearching(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(q), 250)
  }

  const handleSelect = preceptor => {
    setSelected(preceptor)
    setConfirming(true)
  }

  const handleConfirm = async () => {
    if (!selected || !student) return
    setError(null)

    const today = new Date().toISOString().split('T')[0]

    // Update student row: set preceptor_id + keep free-text in sync
    const { error: stuErr } = await supabase.from('students').update({
      preceptor_id:      selected.id,
      matched_preceptor: selected.full_name,
      preceptor_email:   selected.email,
    }).eq('id', student.id)

    if (stuErr) { setError(stuErr.message); return }

    // Update the active match row for this student
    const { data: matchRows } = await supabase
      .from('matches')
      .select('id')
      .eq('student_id', student.id)
      .limit(1)
    if (matchRows?.length) {
      await supabase.from('matches').update({ preceptor_id: selected.id })
        .eq('id', matchRows[0].id)
    }

    // Create cohort participation if it doesn't exist yet
    if (student.cohort_id) {
      await supabase.from('preceptor_cohort_participation').upsert({
        preceptor_id: selected.id,
        cohort_id:    student.cohort_id,
        status:       'active',
        started_at:   today,
      }, { onConflict: 'preceptor_id,cohort_id', ignoreDuplicates: true })
    }

    // Refresh students query so all components update
    queryClient.invalidateQueries({ queryKey: ['students', student.cohort_id] })
    queryClient.invalidateQueries({ queryKey: ['preceptors'] })

    onAssigned?.(selected)
    onClose()
  }

  const handleAddSaved = async (newPreceptor) => {
    setAddOpen(false)
    // Auto-assign the just-created preceptor
    await supabase.from('students').update({
      preceptor_id:      newPreceptor.id,
      matched_preceptor: newPreceptor.full_name,
      preceptor_email:   newPreceptor.email,
    }).eq('id', student.id)

    const { data: matchRows } = await supabase.from('matches').select('id').eq('student_id', student.id).limit(1)
    if (matchRows?.length) {
      await supabase.from('matches').update({ preceptor_id: newPreceptor.id }).eq('id', matchRows[0].id)
    }

    queryClient.invalidateQueries({ queryKey: ['students', student.cohort_id] })
    queryClient.invalidateQueries({ queryKey: ['preceptors'] })

    onAssigned?.(newPreceptor)
    onClose()
  }

  if (!isOpen) return null

  const showResults = query.trim().length > 0

  return (
    <>
      <div className="modal-overlay" onMouseDown={onClose}>
        <div className="modal" onMouseDown={e => e.stopPropagation()} style={{ maxWidth: 440, width: '90vw' }}>
          <div className="modal-header">
            <h2>Assign Preceptor</h2>
            <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>

          <div className="modal-body" style={{ paddingBottom: 4 }}>
            {student && (
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Assigning to{' '}
                <strong style={{ color: '#374151' }}>
                  {student.first_name} {student.last_name}
                </strong>
              </div>
            )}

            {error && <div className="error-msg">{error}</div>}

            {!confirming ? (
              <>
                <input
                  ref={inputRef}
                  className="form-input"
                  value={query}
                  onChange={handleQueryChange}
                  placeholder="Search by name or email…"
                  style={{ marginBottom: 8 }}
                />

                {/* Search results */}
                {showResults && (
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
                    {searching && (
                      <div style={{ padding: '10px 14px', fontSize: 13, color: '#9ca3af' }}>Searching…</div>
                    )}
                    {!searching && results.length === 0 && (
                      <div style={{ padding: '12px 14px' }}>
                        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
                          No matches found for "{query}"
                        </div>
                        <button
                          onClick={() => setAddOpen(true)}
                          className="btn btn-primary"
                          style={{ fontSize: 12, padding: '6px 14px' }}
                        >
                          + Add new preceptor
                        </button>
                      </div>
                    )}
                    {!searching && results.map(p => {
                      const activePcp = p.preceptor_cohort_participation?.find(x => x.status === 'active')
                      return (
                        <button
                          key={p.id}
                          onClick={() => handleSelect(p)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '10px 14px', background: 'none', border: 'none',
                            borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                            fontFamily: 'DM Sans, sans-serif',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{p.full_name}</div>
                              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>{p.email}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              {p.unit_name && (
                                <div style={{ fontSize: 11, color: '#6b7280' }}>{p.unit_name}</div>
                              )}
                              {p.shift_type && (
                                <div style={{ fontSize: 10, color: '#9ca3af' }}>{p.shift_type}</div>
                              )}
                              {activePcp && (
                                <div style={{ fontSize: 10, color: '#d97706', fontWeight: 600 }}>Active this cohort</div>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {!showResults && (
                  <div style={{ paddingTop: 4, textAlign: 'right' }}>
                    <button
                      onClick={() => setAddOpen(true)}
                      style={{ fontSize: 12, color: '#1D2567', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      + Add new preceptor instead
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* Confirmation step */
              <div>
                <div style={{ background: '#f0f3ff', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
                  <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>Confirm assignment:</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1D2567' }}>{selected?.full_name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{selected?.email}</div>
                  {selected?.unit_name && (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{selected.unit_name} · {selected.shift_type}</div>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#374151' }}>
                  Assign as preceptor for{' '}
                  <strong>{student?.first_name} {student?.last_name}</strong>?
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            {confirming ? (
              <>
                <button
                  className="btn btn-outline-modal"
                  onClick={() => { setConfirming(false); setSelected(null) }}
                >
                  Back
                </button>
                <button className="btn btn-primary" onClick={handleConfirm}>
                  Confirm Assignment
                </button>
              </>
            ) : (
              <button className="btn btn-outline-modal" onClick={onClose}>Cancel</button>
            )}
          </div>
        </div>
      </div>

      <PreceptorFormModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={handleAddSaved}
        cohortId={student?.cohort_id}
      />
    </>
  )
}
