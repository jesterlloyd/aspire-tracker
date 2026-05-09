export async function downloadFile(url, filename) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}

export function buildStudentFilename(student, type) {
  const last   = student.last_name?.replace(/\s+/g, '_')                    || 'Unknown'
  const first  = student.first_name?.replace(/\s+/g, '_')                   || 'Unknown'
  const school = student.school?.replace(/\s+/g, '_').slice(0, 10)          || ''
  if (type === 'headshot') return `${last}_${first}_headshot`
  if (type === 'resume')   return `${last}_${first}_${school}_resume`
  return `${last}_${first}_file`
}
