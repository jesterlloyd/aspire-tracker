export function generateStudentSummary(student, unitName, cohortName) {
  if (!student) return '';

  const name = `${student.first_name} ${student.last_name}`;
  const school = student.school || 'Unknown school';
  const program = student.program_type || 'Unknown program';
  const cohort = cohortName || 'current cohort';
  const status = student.status || 'Pending Outreach';
  const gpa = student.cumulative_gpa ? `GPA: ${student.cumulative_gpa}` : 'GPA not on file';
  const shiftPref = student.shift_availability || 'No preference stated';

  let placementLine = '';
  if (student.matched_unit_id && unitName) {
    placementLine = `Placed in ${unitName}.`;
  } else if (status === 'Interviewed') {
    placementLine = 'Interview completed. Awaiting unit placement.';
  } else if (status === 'Interview Scheduled') {
    placementLine = 'Interview scheduled. Awaiting completion.';
  } else if (status === 'Form Received') {
    placementLine = 'Profile submitted. Awaiting interview scheduling.';
  } else if (status === 'Form Sent') {
    placementLine = 'Student form sent. Awaiting profile submission.';
  } else if (status === 'Pending Outreach') {
    placementLine = 'Outreach not yet started.';
  } else if (status === 'Active Rotation') {
    const hours = student.approved_hours || 0;
    const required = student.hours_required || 90;
    placementLine = unitName
      ? `Currently rotating at ${unitName}. Hours: ${hours}/${required}.`
      : `Currently in active rotation. Hours: ${hours}/${required}.`;
  } else if (status === 'Completed') {
    placementLine = `Rotation completed${unitName ? ` at ${unitName}` : ''}.`;
  } else if (status === 'Declined') {
    const reason = student.decline_reason ? ` Reason: ${student.decline_reason}.` : '';
    placementLine = `Student declined.${reason}`;
  }

  const scoreLine = student.avg_composite_score
    ? `Interview score: ${student.avg_composite_score}/15.`
    : '';

  const csLinkLine = student.cs_link_complete
    ? 'CS-Link access: complete.'
    : student.cs_stage1_submitted
    ? 'CS-Link access: Stage 1 submitted, Stage 2 pending.'
    : 'CS-Link access: not started.';

  const badgeLine = student.badge_created
    ? 'Badge: issued.'
    : status === 'Placed' || status === 'Active Rotation'
    ? 'Badge: not yet issued.'
    : '';

  const preceptorLine = student.matched_preceptor
    ? `Preceptor: ${student.matched_preceptor}.`
    : '';

  const lines = [
    `${name} | ${school} | ${program} | ${cohort}`,
    `Status: ${status}. ${gpa}. Shift preference: ${shiftPref}.`,
    placementLine,
    scoreLine,
    csLinkLine,
    badgeLine,
    preceptorLine,
  ].filter(Boolean);

  return lines.join(' ');
}
