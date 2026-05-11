export function calculatePriorities(students, units) {
  if (!students || students.length === 0) return [];

  const priorities = [];

  // Interviews pending (Form Received with no scheduled interview)
  const interviewsPending = students.filter(s =>
    s.status === 'Form Received' && !s.interview_scheduled_date
  ).length;
  if (interviewsPending > 0) {
    priorities.push({
      count: interviewsPending,
      label: interviewsPending === 1 ? 'interview pending' : 'interviews pending',
      color: '#5b21b6', bg: '#ede9fe', urgency: 2,
    });
  }

  // CS-Link not started
  const csLinkPending = students.filter(s =>
    ['Form Received', 'Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation'].includes(s.status)
    && !s.cs_stage1_submitted
  ).length;
  if (csLinkPending > 0) {
    priorities.push({
      count: csLinkPending,
      label: csLinkPending === 1 ? 'CS-Link item' : 'CS-Link items',
      color: '#92400e', bg: '#fef3c7', urgency: 3,
    });
  }

  // Badges needed
  const badgesNeeded = students.filter(s =>
    s.status === 'Placed' && !s.badge_created
  ).length;
  if (badgesNeeded > 0) {
    priorities.push({
      count: badgesNeeded,
      label: badgesNeeded === 1 ? 'badge needed' : 'badges needed',
      color: '#0e7490', bg: '#dceff8', urgency: 2,
    });
  }

  // Placement gap
  const totalSlots = (units || []).reduce((sum, u) => sum + (u.total_slots || 0), 0);
  const totalStudents = students.filter(s => s.status !== 'Declined').length;
  const gap = totalStudents - totalSlots;
  if (gap > 0) {
    priorities.push({
      count: gap,
      label: gap === 1 ? 'placement gap' : 'placement gaps',
      color: '#dc1e34', bg: '#fff1f2', urgency: 4,
    });
  }

  // Shift logs pending review
  const shiftsNeedingReview = students.filter(s =>
    s.status === 'Active Rotation' && (s.pending_hours || 0) > 0
  ).length;
  if (shiftsNeedingReview > 0) {
    priorities.push({
      count: shiftsNeedingReview,
      label: shiftsNeedingReview === 1 ? 'shift log to review' : 'shift logs to review',
      color: '#166534', bg: '#dcfce7', urgency: 1,
    });
  }

  // Students nearing completion
  const nearingCompletion = students.filter(s =>
    s.status === 'Active Rotation' &&
    s.hours_required &&
    s.approved_hours >= s.hours_required * 0.85 &&
    s.approved_hours < s.hours_required
  ).length;
  if (nearingCompletion > 0) {
    priorities.push({
      count: nearingCompletion,
      label: nearingCompletion === 1 ? 'student nearing completion' : 'students nearing completion',
      color: '#065f46', bg: '#d1fae5', urgency: 1,
    });
  }

  // Sort by urgency descending
  return priorities.sort((a, b) => b.urgency - a.urgency);
}
