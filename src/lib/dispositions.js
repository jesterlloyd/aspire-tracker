// src/lib/dispositions.js
// Disposition workflow constants. Created Phase 2B.1 (May 26, 2026).
// UI integration happens in Phase 2B.2.
// DB schema: migrations/migration_disposition_foundation.sql

export const DISPOSITION_TYPES = {
  not_selected:                     'Not Selected',
  student_declined_offer:           'Student Declined Offer',
  application_withdrawn:            'Application Withdrawn',
  ineligible:                       'Ineligible',
  placement_cancelled:              'Placement Cancelled',
  student_withdrew_after_placement: 'Student Withdrew After Placement',
  rotation_discontinued:            'Rotation Discontinued',
  removed_from_program:             'Removed from Program',
};

export const DISPOSITION_STAGES = {
  pre_interview:   'Pre-Interview',
  post_interview:  'Post-Interview',
  pre_placement:   'Pre-Placement',
  post_placement:  'Post-Placement',
  active_rotation: 'Active Rotation',
};

export const DECISION_ORIGINS = {
  interview_review:    'Interview Review',
  student_profile:     'Student Profile',
  rotation_management: 'Rotation Management',
  auto_rubric:         'Auto Rubric',
  legacy_migration:    'Legacy Migration',
  system_correction:   'System Correction',
};

export const FOLLOWUP_TYPES = {
  notify_student:            'Notify Student',
  notify_school_coordinator: 'Notify School Coordinator',
  notify_unit_leader:        'Notify Unit Leader',
  reopen_placement_slot:     'Reopen Placement Slot',
  leadership_review:         'Leadership Review',
  documentation_review:      'Documentation Review',
};

export const FOLLOWUP_STATUSES = {
  pending:        'Pending',
  completed:      'Completed',
  waived:         'Waived',
  not_applicable: 'Not Applicable',
  cancelled:      'Cancelled',
};

export const REASON_CATEGORIES_BY_TYPE = {
  not_selected: {
    program_pathway_alignment:                    'Program Pathway Alignment',
    interview_review_decision:                    'Interview Review Decision',
    placement_capacity_limitation:                'Placement Capacity Limitation',
    eligibility_requirement_not_met:              'Eligibility Requirement Not Met',
    unable_to_accommodate_requested_placement:    'Unable to Accommodate Requested Placement',
    other:                                        'Other',
  },
  student_declined_offer: {
    accepted_other_offer:       'Accepted Other Offer',
    personal_circumstances:     'Personal Circumstances',
    declined_specific_placement:'Declined Specific Placement',
    no_reason_provided:         'No Reason Provided',
    other:                      'Other',
  },
  application_withdrawn: {
    student_initiated_withdrawal: 'Student Initiated Withdrawal',
    non_responsive:               'Non-Responsive',
    documentation_incomplete:     'Documentation Incomplete',
    other:                        'Other',
  },
  ineligible: {
    gpa_below_threshold:           'GPA Below Threshold',
    documentation_not_met:         'Documentation Not Met',
    school_affiliation_issue:      'School Affiliation Issue',
    timing_or_scheduling_conflict: 'Timing or Scheduling Conflict',
    other:                         'Other',
  },
  placement_cancelled: {
    unit_capacity_change:    'Unit Capacity Change',
    unit_operational_issue:  'Unit Operational Issue',
    preceptor_unavailable:   'Preceptor Unavailable',
    administrative_decision: 'Administrative Decision',
    other:                   'Other',
  },
  student_withdrew_after_placement: {
    personal_circumstances: 'Personal Circumstances',
    placement_concerns:     'Placement Concerns',
    health_or_family:       'Health or Family',
    other:                  'Other',
  },
  rotation_discontinued: {
    performance_concerns: 'Performance Concerns',
    student_initiated:    'Student Initiated',
    unit_initiated:       'Unit Initiated',
    health_or_family:     'Health or Family',
    other:                'Other',
  },
  removed_from_program: {
    safety_concern:               'Safety Concern',
    professional_conduct:         'Professional Conduct',
    documentation_or_compliance:  'Documentation or Compliance',
    leadership_decision:          'Leadership Decision',
    other:                        'Other',
  },
};

// Pre-placement disposition types - used by DispositionModal in Phase 2B.2a
export const PRE_PLACEMENT_DISPOSITION_TYPES = [
  'not_selected',
  'student_declined_offer',
  'application_withdrawn',
  'ineligible',
];

// Post-placement disposition types - used in Phase 4
export const POST_PLACEMENT_DISPOSITION_TYPES = [
  'placement_cancelled',
  'student_withdrew_after_placement',
  'rotation_discontinued',
  'removed_from_program',
];

// Default follow-ups pre-checked by DispositionModal per disposition type
export const DEFAULT_FOLLOWUPS_BY_TYPE = {
  not_selected:           ['notify_student'],
  student_declined_offer: ['notify_student'],
  application_withdrawn:  ['notify_student'],
  ineligible:             ['notify_student'],
};

// All available follow-up options per disposition type
export const AVAILABLE_FOLLOWUPS_BY_TYPE = {
  not_selected:           ['notify_student', 'notify_school_coordinator', 'leadership_review'],
  student_declined_offer: ['notify_student', 'notify_school_coordinator'],
  application_withdrawn:  ['notify_student', 'notify_school_coordinator'],
  ineligible:             ['notify_student', 'notify_school_coordinator', 'leadership_review'],
};

// Color treatment for disposition pills. Applied in Phase 2B.2.
export const DISPOSITION_PILL_COLORS = {
  not_selected:                     { bg: '#fdf2f8', text: '#9d174d', border: '#fbcfe8' }, // soft rose
  student_declined_offer:           { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' }, // soft slate
  application_withdrawn:            { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' }, // soft slate
  ineligible:                       { bg: '#fef3c7', text: '#92400e', border: '#fde68a' }, // muted amber
  placement_cancelled:              { bg: '#fef3c7', text: '#92400e', border: '#fde68a' }, // muted amber
  student_withdrew_after_placement: { bg: '#fef3c7', text: '#92400e', border: '#fde68a' }, // muted amber
  rotation_discontinued:            { bg: '#fdf2f8', text: '#9d174d', border: '#fbcfe8' }, // soft rose
  removed_from_program:             { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' }, // restricted caution
};
