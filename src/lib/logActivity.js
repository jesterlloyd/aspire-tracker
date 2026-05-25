import { supabase } from './supabase';
import { safeWrite } from './safeWrite';

/**
 * logActivity - writes a row to activity_logs
 * Call after every meaningful user action.
 */
export async function logActivity({
  userProfile,
  actionType,
  entityType = '',
  entityId = '',
  cohortId = null,
  description = '',
  metadata = {},
}) {
  if (!userProfile || !actionType) return;

  try {
    await safeWrite(
      () => supabase.from('activity_logs').insert({
        user_id:     userProfile.id,
        user_name:   userProfile.full_name,
        user_role:   userProfile.role,
        action_type: actionType,
        entity_type: entityType,
        entity_id:   String(entityId || ''),
        cohort_id:   cohortId || null,
        description,
        metadata:    metadata || {},
      }),
      { name: 'log activity' }
    );
  } catch (err) {
    console.warn('Activity log error:', err.message);
  }
}
