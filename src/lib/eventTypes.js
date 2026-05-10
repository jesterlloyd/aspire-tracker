export const EVENT_TYPES = [
  { value: 'orientation',    label: 'Orientation',    color: '#5b21b6' },
  { value: 'rotation_start', label: 'Rotation Start', color: '#065f46' },
  { value: 'rotation_end',   label: 'Rotation End',   color: '#1d2567' },
  { value: 'interview',      label: 'Interview',      color: '#92400e' },
  { value: 'placement',      label: 'Placement',      color: '#166534' },
  { value: 'form_received',  label: 'Form Received',  color: '#0e7490' },
  { value: 'form_sent',      label: 'Form Sent',      color: '#1d4ed8' },
  { value: 'completion',     label: 'Completion',     color: '#1d2567' },
  { value: 'status_change',  label: 'Status Change',  color: '#6b7280' },
  { value: 'note',           label: 'Note',           color: '#6b7280' },
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
