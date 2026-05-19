// Greeting name resolution for ASPIRE notification templates.
// Returns preferred_name if set, otherwise the first word of full_name.
// Used in email salutations only; formal full_name remains in records and signature blocks.

export function getGreetingName(person) {
  if (person && person.preferred_name && person.preferred_name.trim()) {
    return person.preferred_name.trim();
  }
  if (person && person.full_name) {
    return person.full_name.split(' ')[0];
  }
  return 'there';
}
