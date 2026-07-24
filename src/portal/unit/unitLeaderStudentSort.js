const NAME_COLLATOR = new Intl.Collator('en-US', {
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: false,
})

export function unitLeaderStudentSortName(student = {}) {
  const fullName = String(student.full_name || student.name || '').trim()
  if (fullName) return fullName
  const first = String(student.preferred_name || student.first_name || '').trim()
  const last = String(student.last_name || '').trim()
  const joined = [first, last].filter(Boolean).join(' ').trim()
  return joined || String(student.email || student.school_email || student.id || '').trim()
}

export function sortUnitLeaderStudentsByName(students = [], direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1
  return [...students]
    .map((student, index) => ({ student, index }))
    .sort((a, b) => {
      const byName = NAME_COLLATOR.compare(unitLeaderStudentSortName(a.student), unitLeaderStudentSortName(b.student))
      if (byName !== 0) return byName * dir
      const byId = NAME_COLLATOR.compare(String(a.student.id || ''), String(b.student.id || ''))
      if (byId !== 0) return byId * dir
      return a.index - b.index
    })
    .map(({ student }) => student)
}
