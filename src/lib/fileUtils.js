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

// RUBRIC-BOOK-1 (Owner, 2026-09-17): a resume button must say what it will actually do.
// A browser renders a PDF in the tab it is opened in; it has no renderer for a Word
// document, so .doc and .docx always land in the downloads folder however they are
// opened. The label follows the stored file rather than our intention for it.
export function resumeOpensInTab(resumeUrl) {
  const name = String(resumeUrl || '').split(/[?#]/)[0]
  return !/\.docx?$/i.test(name)
}
export function resumeActionLabel(resumeUrl) {
  return resumeOpensInTab(resumeUrl) ? 'View resume' : 'Download resume'
}
