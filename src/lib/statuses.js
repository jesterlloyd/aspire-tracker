export const ASPIRE_STATUSES = [
  { value: 'Pending Outreach',    label: 'Pending Outreach',    color: '#6b7280', bg: '#f3f4f6', order: 1 },
  { value: 'Form Sent',           label: 'Form Sent',           color: '#1d4ed8', bg: '#eff6ff', order: 2 },
  { value: 'Form Received',       label: 'Form Received',       color: '#0e7490', bg: '#dceff8', order: 3 },
  { value: 'Interview Scheduled', label: 'Interview Scheduled', color: '#5b21b6', bg: '#ede9fe', order: 4 },
  { value: 'Interviewed',         label: 'Interviewed',         color: '#92400e', bg: '#fef3c7', order: 5 },
  { value: 'Placed',              label: 'Placed',              color: '#166534', bg: '#dcfce7', order: 6 },
  { value: 'Active Rotation',     label: 'Active Rotation',     color: '#065f46', bg: '#d1fae5', order: 7 },
  { value: 'Completed',           label: 'Completed',           color: '#1d2567', bg: '#e0e7ff', order: 8 },
  { value: 'Declined',            label: 'Declined',            color: '#991b1b', bg: '#fee2e2', order: 9  },
  { value: 'Not Proceeding',      label: 'Not Proceeding',      color: '#9d174d', bg: '#fdf2f8', order: 10 },
];

export const DECLINE_REASONS = [
  'GPA below threshold',
  'Student withdrew',
  'No-show to interview',
  'Did not pass interview',
  'School eligibility issue',
  'No available unit match',
  'Personal reasons',
  'Other',
];

export const STATUS_VALUES = ASPIRE_STATUSES.map(s => s.value);

export function getStatusStyle(status) {
  const found = ASPIRE_STATUSES.find(s => s.value === status);
  return found || ASPIRE_STATUSES[0];
}

export function isForwardProgression(currentStatus, newStatus) {
  const currentOrder = ASPIRE_STATUSES.find(s => s.value === currentStatus)?.order || 0;
  const newOrder     = ASPIRE_STATUSES.find(s => s.value === newStatus)?.order || 0;
  return newOrder > currentOrder;
}
