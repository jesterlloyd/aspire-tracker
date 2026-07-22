// api/portal/unit-preceptors.js
//
// Unit Leader Preceptors workspace read model. The service-role client is used only
// after the caller's active Unit Leader grant and unit scopes have been resolved.
// Browser RLS is never treated as authority, and assignment details are intersected
// with the server-authorized student set before they are returned.

import {
  verifyPortalUnitLeaderCaller,
  resolveUnitScopedStudents,
} from '../lib/unitLeaderScope.js'

const ROLE_LABEL = {
  primary: 'Primary',
  secondary: 'Secondary',
  coverage: 'Coverage',
}

async function loadPreceptors(db) {
  const { data, error } = await db
    .from('preceptors')
    .select('id, full_name, email, phone, unit_id, unit_name, shift_type, is_active')
    .order('full_name')
  if (error) throw new Error('preceptor_lookup_failed')
  return data || []
}

async function loadAssignments(db, studentIds) {
  if (studentIds.length === 0) return []
  const { data, error } = await db
    .from('student_preceptor_assignments')
    .select('id, student_id, preceptor_id, role, start_date, end_date, status')
    .in('student_id', studentIds)
    .eq('status', 'active')
  if (error) throw new Error('assignment_lookup_failed')
  return data || []
}

const displayName = (student) => {
  const first = student?.preferred_first_name || student?.first_name || ''
  return `${first} ${student?.last_name || ''}`.trim() || 'Student'
}

export function buildUnitPreceptorCollections({ preceptors, assignments, students, unitKeys }) {
  const studentById = new Map((students || []).map(student => [student.id, student]))
  const scopedUnitKeys = new Set(unitKeys || [])
  const assignmentsByPreceptor = new Map()

  for (const assignment of assignments || []) {
    const student = studentById.get(assignment.student_id)
    const role = ROLE_LABEL[assignment.role]
    if (!student || !role || assignment.status !== 'active') continue
    const shaped = {
      id: assignment.id,
      student_id: student.id,
      student_name: displayName(student),
      student_unit: student.unit_key,
      role,
      start_date: assignment.start_date || null,
      end_date: assignment.end_date || null,
      status: assignment.status,
    }
    const list = assignmentsByPreceptor.get(assignment.preceptor_id) || []
    list.push(shaped)
    assignmentsByPreceptor.set(assignment.preceptor_id, list)
  }

  const sortedPreceptors = [...(preceptors || [])]
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))

  const roster = []
  const candidates = []
  for (const preceptor of sortedPreceptors) {
    const activeAssignments = assignmentsByPreceptor.get(preceptor.id) || []
    const associated = scopedUnitKeys.has(preceptor.unit_name) || activeAssignments.length > 0
    const homeUnit = { id: preceptor.unit_id || null, name: preceptor.unit_name || null }

    if (associated) {
      roster.push({
        id: preceptor.id,
        full_name: preceptor.full_name || '',
        email: preceptor.email || null,
        phone: preceptor.phone || null,
        home_unit: homeUnit,
        shift: preceptor.shift_type || null,
        is_active: preceptor.is_active !== false,
        active_assignment_count: activeAssignments.length,
        cross_unit_association: activeAssignments.some(a => a.student_unit !== preceptor.unit_name),
        assignments: activeAssignments,
      })
    }

    if (preceptor.is_active !== false) {
      candidates.push({
        id: preceptor.id,
        full_name: preceptor.full_name || '',
        home_unit: homeUnit,
        shift: preceptor.shift_type || null,
      })
    }
  }

  return { roster, candidates }
}

export function createUnitPreceptorsHandler({
  verifyCaller = verifyPortalUnitLeaderCaller,
  resolveStudents = resolveUnitScopedStudents,
  fetchPreceptors = loadPreceptors,
  fetchAssignments = loadAssignments,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
    const { db, scopes, unitKeys } = auth
    if (scopes.length === 0) return res.status(200).json({ roster: [], candidates: [] })

    try {
      const { students } = await resolveStudents(db, scopes)
      const studentIds = students.map(student => student.id)
      const [preceptors, assignments] = await Promise.all([
        fetchPreceptors(db),
        fetchAssignments(db, studentIds),
      ])
      return res.status(200).json(buildUnitPreceptorCollections({
        preceptors,
        assignments,
        students,
        unitKeys,
      }))
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createUnitPreceptorsHandler()
