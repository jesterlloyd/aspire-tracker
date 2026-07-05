export const EVENT_TYPES = [
  { value: 'orientation',          label: 'Orientation',          color: '#5b21b6', manual: true },
  { value: 'form_sent',            label: 'Form Sent',            color: '#1d4ed8', manual: true },
  { value: 'form_received',        label: 'Form Received',        color: '#0e7490', manual: true },
  { value: 'interview',            label: 'Interview',            color: '#92400e', manual: true },
  { value: 'placement',            label: 'Placement',            color: '#166534', manual: true },
  { value: 'rotation_start',       label: 'Rotation Start',       color: '#065f46', manual: true },
  { value: 'rotation_end',         label: 'Rotation End',         color: '#1d2567', manual: true },
  { value: 'completion',           label: 'Completion',           color: '#1d2567', manual: true },
  { value: 'manual_status_update', label: 'Manual Status Update', color: '#6b7280', manual: true },
  { value: 'note',                 label: 'Note',                 color: '#6b7280', manual: true },
  // Phase 2B.1 disposition events - logged via record_student_disposition() DB function, not entered manually
  { value: 'disposition_not_selected',                     label: 'Disposition: Not Selected',                     color: '#9d174d', manual: false },
  { value: 'disposition_student_declined_offer',           label: 'Disposition: Student Declined Offer',           color: '#475569', manual: false },
  { value: 'disposition_application_withdrawn',            label: 'Disposition: Application Withdrawn',            color: '#475569', manual: false },
  { value: 'disposition_ineligible',                       label: 'Disposition: Ineligible',                       color: '#92400e', manual: false },
  { value: 'disposition_placement_cancelled',              label: 'Disposition: Placement Cancelled',              color: '#92400e', manual: false },
  { value: 'disposition_student_withdrew_after_placement', label: 'Disposition: Student Withdrew After Placement', color: '#92400e', manual: false },
  { value: 'disposition_rotation_discontinued',            label: 'Disposition: Rotation Discontinued',            color: '#9d174d', manual: false },
  { value: 'disposition_removed_from_program',             label: 'Disposition: Removed from Program',             color: '#991b1b', manual: false },
  // STUDENT-PROFILE-CANON-1E - logged via clear_student_disposition() DB function, not entered manually
  { value: 'disposition_cleared',                          label: 'Disposition: Cleared',                          color: '#6b7280', manual: false },
];

export const EVENT_TYPE_LABELS = Object.fromEntries(
  EVENT_TYPES.map(e => [e.value, e.label])
);

export const EVENT_TYPE_COLORS = Object.fromEntries(
  EVENT_TYPES.map(e => [e.value, e.color])
);

export function getEventColor(eventType) {
  return EVENT_TYPE_COLORS[eventType] || '#6b7280';
}

export const GANTT_PHASES = [
  { key: 'form_to_interview',  label: 'Form → Interview',  color: '#eff6ff', border: '#1d4ed8' },
  { key: 'interview_to_place', label: 'Interview → Placed', color: '#fef3c7', border: '#92400e' },
  { key: 'rotation',           label: 'Rotation',           color: '#dcfce7', border: '#166534' },
];
