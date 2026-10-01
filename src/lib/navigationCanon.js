import {
  CalendarDays,
  CalendarRange,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  ContactRound,
  HandCoins,
  Handshake,
  Home,
  Hospital,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react'

// One vocabulary for top-level destinations across the staff app and portals.
// A shared concept keeps the same label and icon even when its route differs.
export const NAV_LABELS = Object.freeze({
  atAGlance: 'At a Glance',
  studentProfiles: 'Student Profiles',
  students: 'Students',
  interviews: 'Interviews',
  rotation: 'Rotation',
  evaluation: 'Evaluation',
  support: 'Support',
  profilesInterest: 'Profiles & Interest',
  residency: 'Residency',
  home: 'Home',
  myPlacement: 'My Placement',
  messages: 'Messages',
  shiftLog: 'Shift Log',
  preceptors: 'Preceptors',
  placementRequests: 'Placement Requests',
  capacity: 'Capacity',
  communityBenefit: 'Community Benefit',
  contacts: 'Contacts',
  programBudgets: 'Budget Tracker',   // singular (Owner, 2026-09-27): one budget today, ASPIRE's
})

export const NAV_ICONS = Object.freeze({
  atAGlance: LayoutDashboard,
  studentProfiles: Users,
  students: Users,
  interviews: CalendarDays,
  rotation: Hospital,
  evaluation: ChartColumn,
  support: Handshake,
  profilesInterest: Users,
  residency: Hospital,
  home: Home,
  myPlacement: MapPin,
  messages: MessageSquare,
  shiftLog: ClipboardCheck,
  preceptors: UserCheck,
  placementRequests: ClipboardList,
  capacity: CalendarRange,
  communityBenefit: HandCoins,
  contacts: ContactRound,
  programBudgets: Wallet,
})

// NA-NAV-ALPHA-1 (Owner, 2026-09-30): a section row in alphabetical order of the label the reader
// sees. Pure and non-mutating. A host puts its landing section first and hands the rest here, so
// the order never depends on which optional tabs a given account has switched on.
export function alphabetizeNav(sections) {
  return [...(sections || [])].sort((a, b) => String(a.label).localeCompare(String(b.label), 'en', { sensitivity: 'base' }))
}
