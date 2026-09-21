// CONTACTS-BOOK-1: the small link beside Refresh on ASPIRE Connect > Contacts. It flips
// the same appearance.contactsLayout preference that Settings > Appearance sets, through
// the same store, so the two can never disagree.
import { useUserPreference } from '../../hooks/useUserPreference'
import { CONTACTS_LAYOUT } from '../../lib/userPreferences'

export default function ContactsLayoutLink() {
  const [layout, setLayout] = useUserPreference(CONTACTS_LAYOUT)
  const isBook = layout === 'book'
  return (
    <button
      type="button"
      className="contacts-layout-link"
      onClick={() => { setLayout(isBook ? 'classic' : 'book') }}
    >
      {isBook ? 'Switch to classic' : 'Try the address book'}
    </button>
  )
}
