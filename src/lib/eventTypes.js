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
