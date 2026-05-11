export function calculateProfileCompletion(student) {
  const checks = [
    {
      key: 'photo',
      label: 'Photo',
      complete: !!student?.headshot_url,
    },
    {
      key: 'gpa',
      label: 'GPA',
      complete: !!student?.cumulative_gpa && student.cumulative_gpa > 0,
    },
    {
      key: 'personal_email',
      label: 'Personal email',
      complete: !!student?.personal_email,
    },
    {
      key: 'phone',
      label: 'Phone',
      complete: !!student?.phone,
    },
    {
      key: 'program',
      label: 'Program type',
      complete: !!student?.program_type,
    },
    {
      key: 'shift_preference',
      label: 'Shift preference',
      complete: !!student?.shift_availability,
    },
    {
      key: 'unit_preferences',
      label: 'Unit preferences',
      complete: !!student?.unit_preference_1,
    },
    {
      key: 'interest_statement',
      label: 'Interest statement',
      complete: !!student?.interest_statement && student.interest_statement.trim().length > 10,
    },
    {
      key: 'resume',
      label: 'Resume',
      complete: !!student?.resume_url,
    },
    {
      key: 'interview',
      label: 'Interview',
      complete: ['Interviewed', 'Placed', 'Active Rotation', 'Completed'].includes(student?.status),
    },
    {
      key: 'placement',
      label: 'Placement',
      complete: !!student?.matched_unit_id,
    },
    {
      key: 'cs_link',
      label: 'CS-Link access',
      complete: !!student?.cs_link_complete,
    },
  ];

  const completed = checks.filter(c => c.complete).length;
  const total = checks.length;
  const percentage = Math.round((completed / total) * 100);
  const missing = checks.filter(c => !c.complete).map(c => c.label);

  let status = 'complete';
  if (percentage < 50) status = 'low';
  else if (percentage < 80) status = 'medium';
  else if (percentage < 100) status = 'high';

  return { percentage, completed, total, missing, status };
}

export function getCompletionColor(status) {
  return {
    low:      { bg: '#fee2e2', text: '#991b1b', bar: '#dc2626' },
    medium:   { bg: '#fef3c7', text: '#92400e', bar: '#f59e0b' },
    high:     { bg: '#dcfce7', text: '#166534', bar: '#16a34a' },
    complete: { bg: '#d1fae5', text: '#065f46', bar: '#059669' },
  }[status];
}
