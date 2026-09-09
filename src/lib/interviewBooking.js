// RUBRIC-SCHEDULE-1: the client side of moving an interview appointment.
//
// The appointment lives in interview_slots (the calendar, which Interviews Today
// reads) with a denormalized copy on students.interview_scheduled_* (which the
// Interview Recommendations table reads). Those two are the appointment. The rubric
// does not keep a third copy: its Section 1 date and time edit the booking through
// this call, so every surface agrees.
//
// The move is server-side because it claims and releases real slots and must not
// race. The endpoint refuses rather than inventing a slot, so a failure here is a
// sentence worth showing the user verbatim.

import { supabase } from './supabase'

export async function moveInterviewBooking(studentId, { date, time }) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/availability', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      action: 'move_booking',
      student_id: studentId,
      new_date: date,
      new_time: time,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // The endpoint's conflict messages name the actual obstacle (no open slot at
    // that time with that interviewer), so they are shown as-is.
    throw new Error(data.message || 'Could not move the interview.')
  }
  return data
}
