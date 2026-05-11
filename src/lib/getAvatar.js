/**
 * Returns a profile picture URL for a user.
 * Uses custom avatar_url if set, otherwise generates one from DiceBear.
 */
export function getAvatarUrl(userProfile) {
  if (!userProfile) return null;
  if (userProfile.avatar_url) return userProfile.avatar_url;

  const seed = encodeURIComponent(userProfile.full_name || userProfile.email || 'User');
  const bg = getRoleColor(userProfile.role, userProfile.is_owner);
  return `https://api.dicebear.com/7.x/initials/svg?seed=${seed}&backgroundColor=${bg}&textColor=ffffff&fontSize=38&fontWeight=700`;
}

function getRoleColor(role, isOwner) {
  if (isOwner) return '1c2452';
  if (role === 'admin') return '065f46';
  if (role === 'interviewer') return '92400e';
  return '6b7280';
}
