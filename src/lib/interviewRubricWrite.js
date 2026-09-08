// INTERVIEW-RUBRIC-WRITE-1: the one gate every interview_rubrics write passes through.
//
// Every rubric row the session holds comes from list_interview_rubrics_for_cohort
// (supabase/migrations/20260822010000_interview_rubric_authorization.sql). That RPC
// appends three computed booleans to each row: can_view_details, can_edit, is_own.
// They are not columns of interview_rubrics. RubricSession seeds its form from those
// rows (an existing in-progress rubric for the chosen interviewer, an interviewer's
// own rubric, or a browser draft saved from either), and two writes send the WHOLE
// form: the 30-second auto-save and Mark My Rubric Complete. PostgREST rejects a
// write that names an unknown column, so the entire update failed with
//   "Could not find the 'can_edit' column of 'interview_rubrics' in the schema cache"
// and the auto-save repeated the failure every 30 seconds.
//
// toInterviewRubricWrite keeps only real interview_rubrics columns, so whatever the
// RPC or a stored draft carries, only the table's own columns reach the table.
//
// Pure module: no I/O, no React. Importable from tests and from api/.

// Every column of interview_rubrics, as enumerated by the RPC's RETURNS TABLE minus
// its three computed booleans. test/interviewRubricWritePayload.test.mjs holds the
// two in sync.
export const INTERVIEW_RUBRIC_COLUMNS = Object.freeze([
  'id', 'student_id', 'cohort_id',
  'interviewer_profile_id', 'interviewer_name',
  'interview_date', 'interview_time',
  'unit_preferences_rationale',
  'cj_question_asked', 'cj_score', 'cj_notes',
  'pp_question_asked', 'pp_score', 'pp_notes',
  'ga_question_asked', 'ga_score', 'ga_notes',
  'student_questions',
  'individual_recommendation', 'suggested_unit', 'summary_comments',
  'composite_score', 'status',
  'created_at', 'updated_at',
])

// The keys the RPC appends to a row. Listed so a test can prove they are dropped;
// the allowlist above is what actually protects the write.
export const INTERVIEW_RUBRIC_COMPUTED_KEYS = Object.freeze(['can_view_details', 'can_edit', 'is_own'])

const COLUMNS = new Set(INTERVIEW_RUBRIC_COLUMNS)

// Returns a copy of `values` holding only interview_rubrics columns. Allowed keys keep
// their value as given, including null (interviewer_profile_id: null is a real write).
export function toInterviewRubricWrite(values) {
  const out = {}
  for (const [key, value] of Object.entries(values || {})) {
    if (COLUMNS.has(key)) out[key] = value
  }
  return out
}

// INTERVIEW-RUBRIC-WRITE-2: the create path never sends a row's identity.
//
// A browser draft is saved from the whole form, so a draft taken from an existing
// rubric carries that row's id and created_at. Restoring it set the form but not
// rubricId, so the next edit took the create path and inserted the same id again:
//   duplicate key value violates unique constraint "interview_rubrics_pkey"
// The fix has two halves: resolveDraftRubricId lets the session adopt the row the
// draft came from, and toInterviewRubricInsert guarantees an insert can never carry
// an id or created_at, so the database generates both.
export const INTERVIEW_RUBRIC_SERVER_KEYS = Object.freeze(['id', 'created_at'])

const SERVER_KEYS = new Set(INTERVIEW_RUBRIC_SERVER_KEYS)

// toInterviewRubricWrite, minus the keys only the database may set on a new row.
export function toInterviewRubricInsert(values) {
  const out = toInterviewRubricWrite(values)
  for (const key of SERVER_KEYS) delete out[key]
  return out
}

// The id of the rubric row a form (or a stored draft's formState) was taken from, when
// that row still exists in the session's rubric list; otherwise null. A stale id from a
// row that was deleted must not be adopted, and a form with no id is a new rubric.
export function resolveDraftRubricId(formState, rubrics) {
  const id = formState?.id
  if (!id || !Array.isArray(rubrics)) return null
  return rubrics.some(r => r?.id === id) ? id : null
}

// ── RUBRIC-RESUME-OWN-1: whose rubric is this? ──────────────────────────────
//
// An unfinished rubric used to reopen only for accounts whose role was
// interviewer and nothing more. An Owner, Admin or Co-lead who saved a draft
// came back to a blank form, and the existing-rubrics banner then counted the
// row they had just written and told them a rubric was in progress. These
// helpers decide, from the rows the session already holds, which rubric belongs
// to the signed-in person, so the same resume works at every privilege level.

const normName = (v) => String(v || '').trim().toLowerCase()

// True when `name` is the signed-in person's own name.
export function isSelfInterviewerName(name, fullName) {
  const me = normName(fullName)
  return !!me && normName(name) === me
}

// Is this row the signed-in person's own work?
//
// is_own is the server's verdict: list_interview_rubrics_for_cohort reports
// interviewer_profile_id = the caller's user_profiles.id. It is trusted first and
// alone whenever the row is claimed.
//
// The second clause recovers rows written before identity was stamped reliably. A
// privileged user picking a name from the dropdown got interviewer_profile_id NULL
// whenever that name reached the list from the `interviewers` catalog, which holds
// names and no ids. Such a row is owned by nobody, so no is_own match can ever
// reopen it. It is claimed here only by name, only when the server already says
// this actor may edit the row, and never when another profile owns it. This is the
// same rule handleInterviewerChange already uses when a name is picked by hand.
export function isOwnRubricRow(row, { fullName } = {}) {
  if (!row) return false
  if (row.is_own === true) return true
  if (row.interviewer_profile_id) return false
  if (row.can_edit !== true) return false
  return isSelfInterviewerName(row.interviewer_name, fullName)
}

const rubricRecency = (r) => {
  const t = Date.parse(r?.updated_at || r?.created_at || '')
  return Number.isNaN(t) ? 0 : t
}

// The rubric to reopen for this student, or null to start a new one. Unfinished
// work wins over a completed rubric, and the most recently updated row wins within
// each group: every reopen under the old role gate took the create path, so one
// author can hold several unfinished rows for the same student, and the newest is
// the one they last typed into.
export function selectResumableRubric(rubrics, { studentId, fullName } = {}) {
  const mine = (Array.isArray(rubrics) ? rubrics : [])
    .filter(r => r && r.student_id === studentId && isOwnRubricRow(r, { fullName }))
  if (!mine.length) return null
  const newestFirst = [...mine].sort((a, b) => rubricRecency(b) - rubricRecency(a))
  return newestFirst.find(r => r.status !== 'Completed') || newestFirst[0]
}
