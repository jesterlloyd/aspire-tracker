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
