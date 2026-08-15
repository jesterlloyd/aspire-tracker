// api/lib/coordinatorDigestTransitions.js
//
// One classification contract for both coordinator-digest send paths.
// Current terminal student status always overrides historical progress events:
// a student who is Not Proceeding (or legacy Declined) appears exactly once in
// the privacy-safe "Not Proceeding" section and never under interview,
// placement, or rotation activity. Internal disposition reasons are not read or
// rendered for the external academic-partner audience.

export const COORDINATOR_DIGEST_TEMPLATE_VERSION = 2;

export const COORDINATOR_DIGEST_EVENT_TYPES = Object.freeze([
  'form_received',
  'interview_booked',
  'interview',
  'placement',
  'rotation_start',
  'status_change_active_rotation',
  // A terminal disposition may be the student's only activity in the window.
  // Current students.status decides whether it renders as Not Proceeding.
  'disposition_not_selected',
  'disposition_student_declined_offer',
  'disposition_application_withdrawn',
  'disposition_ineligible',
  'disposition_placement_cancelled',
  'disposition_student_withdrew_after_placement',
  'disposition_rotation_discontinued',
  'disposition_removed_from_program',
]);

const TERMINAL_STATUSES = new Set(['Not Proceeding', 'Declined']);

export function createCoordinatorDigestTransitions() {
  return {
    form_received:    [],
    interview_booked: [],
    interview:        [],
    placement:        [],
    rotation:         [],
    not_proceeding:   [],
  };
}

export function addCoordinatorDigestEvent(bucket, event) {
  const student = event?.students;
  if (!student?.id) return null;

  const studentName = `${student.first_name || ''} ${student.last_name || ''}`.trim();
  if (!studentName) return null;

  // Terminal status is authoritative over every historical milestone. Each
  // student is shown once even when the window contains several prior events.
  if (TERMINAL_STATUSES.has(String(student.status || ''))) {
    if (!bucket.not_proceeding.some(row => row.studentId === student.id)) {
      bucket.not_proceeding.push({ line: studentName, studentId: student.id });
    }
    return 'not_proceeding';
  }

  switch (event.event_type) {
    case 'form_received':
      bucket.form_received.push({ line: studentName });
      return 'form_received';

    case 'interview_booked': {
      const timeMatch = event.notes?.match(/for (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}) with (.+?)(?:\s*\(\d+)/);
      const datePart = timeMatch?.[1] || event.event_date;
      const timePart = timeMatch?.[2];
      const intName  = timeMatch?.[3]?.trim();
      const when = [datePart && formatShortDate(datePart), timePart && formatTime(timePart)]
        .filter(Boolean)
        .join(' at ');
      const withInterviewer = intName ? ` with ${intName}` : '';
      bucket.interview_booked.push({ line: `${studentName}${when ? ', ' + when : ''}${withInterviewer}` });
      return 'interview_booked';
    }

    case 'interview': {
      const scoreMatch = event.notes?.match(/Score:\s*([\d.]+)\/15/);
      const score = scoreMatch?.[1];
      bucket.interview.push({ line: `${studentName}${score ? ` (${score}/15)` : ''}` });
      return 'interview';
    }

    case 'placement': {
      const unitMatch = event.notes?.match(/Placed in (.+)$/);
      const unit = unitMatch?.[1]?.trim();
      bucket.placement.push({ line: `${studentName}${unit ? `, ${unit}` : ''}` });
      return 'placement';
    }

    case 'rotation_start':
    case 'status_change_active_rotation':
      if (!bucket.rotation.some(row => row.studentId === student.id)) {
        bucket.rotation.push({ line: studentName, studentId: student.id });
      }
      return 'rotation';

    default:
      // Disposition events for a student whose current status is no longer
      // terminal are intentionally silent (for example, a cleared disposition).
      return null;
  }
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
  });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
