// KLD-1: canonical cohort-status derivation. Extracted verbatim from the Student
// Profiles KPI strip (StudentProfilesTab `pipelineCounts`) so Keith and the UI share
// exactly ONE source of truth for status bucketing. Pure: no React, no fetch, no
// browser APIs — safe to import in the serverless Keith handler.
//
// Buckets are kept distinct on purpose. In particular, Placed and Active Rotation are
// SEPARATE: Placed means matched/assigned to a unit (not necessarily started), while
// Active Rotation means the student has begun shifts. Not Proceeding folds in Declined,
// matching the UI KPI card.

export function computeStatusCounts(students = []) {
  const list = Array.isArray(students) ? students : [];
  return {
    total:             list.length,
    needsOutreach:     list.filter(s => ['Pending Outreach', 'Form Sent'].includes(s.status)).length,
    awaitingInterview: list.filter(s => ['Form Received', 'Interview Scheduled'].includes(s.status)).length,
    interviewed:       list.filter(s => s.status === 'Interviewed').length,
    placed:            list.filter(s => s.status === 'Placed').length,
    activeRotation:    list.filter(s => s.status === 'Active Rotation').length,
    completed:         list.filter(s => s.status === 'Completed').length,
    notProceeding:     list.filter(s => s.status === 'Not Proceeding' || s.status === 'Declined').length,
  };
}

// One-line canonical definitions, handed to the model alongside the counts so it never
// conflates buckets (e.g., never describes Placed students as "rotating").
export const STATUS_DEFINITIONS = {
  Placed:            'matched/assigned to a unit, but not necessarily started',
  'Active Rotation': 'has begun shifts or is actively completing clinical rotation hours',
  Completed:         'finished the clinical rotation',
  'Not Proceeding':  'no longer proceeding (includes Declined)',
};
