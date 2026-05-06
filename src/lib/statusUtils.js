import { supabase } from './supabase'

export async function setAspireStatus(studentId, newStatus) {
  const { error } = await supabase
    .from('students')
    .update({ status: newStatus })
    .eq('id', studentId)
  if (error) console.error('Status update failed:', error)
  return !error
}
