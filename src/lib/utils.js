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
