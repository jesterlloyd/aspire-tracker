import { supabase } from './supabase'

// Load before the user clicks Copy so Safari's clipboard gesture stays intact.
// Never guess school/personal if the residency read fails.
export async function withStudentEmailContext(students) {
  if (!students.length) return students
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in again to load student email routing.')
  const context = new Map()
  for (let i = 0; i < students.length; i += 200) {
    const response = await fetch('/api/student-email-context', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_ids: students.slice(i, i + 200).map(s => s.id) }),
    })
    if (!response.ok) throw new Error('Student email routing could not be loaded. Refresh and try again.')
    const result = await response.json()
    for (const row of result.students || []) context.set(row.id, row.residency_outcomes)
  }
  if (students.some(student => !context.has(student.id))) throw new Error('Some student email routing could not be loaded. Refresh and try again.')
  return students.map(student => ({ ...student,
    residency_outcomes: context.get(student.id) || [],
    email_context_loaded: context.has(student.id),
  }))
}
