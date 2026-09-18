// STUDENT-CHART-1: the seven sheets, and the order a reader meets them in.
//
// THE ORDER IS THE DECISION (Owner, 2026-09-18). The mockup drew five sheets; the panel
// has fifteen sections, and dropping ten of them was never on the table, so they group
// into seven. The order is the student's own story rather than the order the sections
// happened to be written in: who they are, where they come from, where they are going,
// what they have done, what is on file, how they were assessed, and what we have said
// about them.
//
// `label` is what the index tab reads. `eyebrow` is the small caps line at the top of the
// sheet, and it names the record, not the tab, which is why "Profile" is introduced by
// "Student record" and not by "Profile".
//
// Plain data, no React, so both the chart and its tests read the same list.

export const CHART_SHEETS = [
  { id: 'profile',     label: 'Profile',     eyebrow: 'Student record',        title: 'Profile' },
  { id: 'background',  label: 'Background',  eyebrow: 'Experience and intent', title: 'Background' },
  { id: 'placement',   label: 'Placement',   eyebrow: 'Rotation placement',    title: 'Placement' },
  { id: 'hours',       label: 'Hours',       eyebrow: 'Clinical hours',        title: 'Hours' },
  { id: 'documents',   label: 'Documents',   eyebrow: 'Documents and access',  title: 'Documents' },
  { id: 'evaluations', label: 'Evaluations', eyebrow: 'Rubrics and reviews',   title: 'Evaluations' },
  { id: 'notes',       label: 'Notes',       eyebrow: 'Record of contact',     title: 'Notes' },
]

export const FIRST_SHEET = CHART_SHEETS[0].id

/** The DOM id a sheet and its tab agree on. One definition, so a click cannot miss. */
export const sheetDomId = (id) => `sc-sheet-${id}`
