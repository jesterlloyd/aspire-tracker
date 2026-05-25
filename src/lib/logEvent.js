import { safeWrite } from './safeWrite'

/**
 * logEvent - writes a row to program_events table
 * Auto-tagged events include auto: true in notes prefix
 */
export async function logEvent(supabase, {
  studentId, cohortId, eventType,
  eventDate, eventTime, notes = '', auto = false,
}) {
  if (!studentId || !cohortId || !eventType) return;

  const today = new Date();
  const dateStr = eventDate || `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const finalNotes = auto ? `[Auto-logged] ${notes}`.trim() : notes;

  const { error } = await safeWrite(
    () => supabase.from('program_events').insert({
      student_id:  studentId,
      cohort_id:   cohortId,
      event_type:  eventType,
      event_date:  dateStr,
      event_time:  eventTime || null,
      notes:       finalNotes,
      created_by:  auto ? 'system' : 'coordinator',
    }),
    { name: 'log event' }
  );

  if (error) console.error('logEvent error:', error.message);
}

/**
 * Check if an event of this type already exists for this student.
 * Prevents duplicate auto-logged events.
 */
export async function eventExists(supabase, studentId, eventType) {
  const { data } = await supabase
    .from('program_events')
    .select('id')
    .eq('student_id', studentId)
    .eq('event_type', eventType)
    .limit(1);
  return data && data.length > 0;
}
