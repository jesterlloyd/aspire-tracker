/**
 * Returns "Last, First" when both name parts exist, falls back to the name field.
 * Handles pre-migration records that only have the combined name column.
 */
export function displayName(student) {
  const f = student?.first_name?.trim()
  const l = student?.last_name?.trim()
  if (l && f) return `${l}, ${f}`
  if (l) return l
  if (f) return f
  return student?.name || ''
}

/**
 * Parses a CSV string into { headers, rows }.
 * Handles quoted fields containing commas and escaped quotes.
 */
export function parseCSV(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const lines = normalized.split('\n')
  if (lines.length < 1) return { headers: [], rows: [] }

  const parseLine = line => {
    const fields = []
    let field = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (c === ',' && !inQuotes) {
        fields.push(field.trim())
        field = ''
      } else {
        field += c
      }
    }
    fields.push(field.trim())
    return fields
  }

  const headers = parseLine(lines[0]).map(h => h.replace(/^"|"$/g, ''))
  const rows = lines.slice(1)
    .map(line => {
      const vals = parseLine(line)
      return headers.reduce((obj, h, i) => {
        obj[h] = (vals[i] ?? '').replace(/^"|"$/g, '')
        return obj
      }, {})
    })
    .filter(row => headers.some(h => row[h] !== ''))

  return { headers, rows }
}

/** Trigger a CSV file download from string content. */
export function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Computes the overall CS-Link workflow status from a student record. */
export function getCsLinkStatus(student) {
  if (!student.cs_cedars_status) return 'not_started'
  if (student.cs_link_complete)  return 'complete'
  if (student.cs_link_requested) return 'cslink_pending'
  if (student.cs_cedars_status === 'employee') return 'account_active'
  if (student.cs_stage1_complete) return 'account_active'
  if (student.cs_stage1_submitted) return 'stage1_pending'
  return 'not_started'
}

export const CS_LINK_STATUS_CONFIG = {
  not_started:    { label: 'Not Started',      bg: '#f3f4f6', text: '#6b7280' },
  stage1_pending: { label: 'Pending Account',  bg: '#fef3c7', text: '#92400e' },
  account_active: { label: 'Account Active',   bg: '#eff6ff', text: '#1d4ed8' },
  cslink_pending: { label: 'CS-Link Pending',  bg: '#ede9fe', text: '#5b21b6' },
  complete:       { label: '✓ CS-Link Active', bg: '#dcfce7', text: '#166534' },
}
