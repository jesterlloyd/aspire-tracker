// CONTACTS-BOOK-1 (2026-09-20): the Contacts data, lifted out of ContactsView so the
// Classic screen and the Address book read ONE copy of it. The queries, the selection
// restore order (URL ?contactId, then this browser's last contact, then the first
// contact) and the filter are the ones ContactsView always had, moved here unchanged.
//
// Both layouts are rendered by ContactsView from this one hook call, so switching
// layouts keeps the selected contact, the category and the search text: the state
// never unmounts, only the drawing of it does.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  PRECEPTOR_ROLES, getContactCategories, CONTACT_CATEGORY_ORDER,
} from '../../lib/contactCategories'

export const LAST_CONTACT_KEY = 'aspire.connect.contacts.lastContactId'

// CONTACTS-CANON-1: the chip row derives from the shared canonical order.
export const CATEGORY_ORDER = ['All', ...CONTACT_CATEGORY_ORDER]

const CONTACTS_SELECT = () => supabase
  .from('contacts')
  .select('*')
  .order('organization')
  .order('full_name')

export function useContactsDirectory({ refreshKey = 0 } = {}) {
  const navigate    = useNavigate()
  const location    = useLocation()
  const restoredRef = useRef(false)   // tracks whether initial selection restore has run

  const [contacts,        setContacts]        = useState([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)
  const [search,          setSearch]          = useState('')
  const [categoryFilter,  setCategoryFilter]  = useState('All')
  const [selectedId,      setSelectedId]      = useState(null)
  const [showInactive,    setShowInactive]    = useState(false)
  const [commHistory,     setCommHistory]     = useState([])
  const [loadingComm,     setLoadingComm]     = useState(false)
  const [linkedStudents,  setLinkedStudents]  = useState([])
  const [linkedStudentsTotal, setLinkedStudentsTotal] = useState(0)
  const [loadingStudents, setLoadingStudents] = useState(false)

  // ── Fetch all contacts ──────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    CONTACTS_SELECT()
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setContacts(data || [])
        setLoading(false)
      })
  }, [refreshKey]) // refreshKey triggers re-fetch when Connect refresh button is clicked

  // ── Fetch communication history on contact select ──────────────────────────
  // A response is dropped once the reader has moved to another contact, so a slow
  // answer for the previous contact can never land on this one's record.
  useEffect(() => {
    if (!selectedId) { setCommHistory([]); setLoadingComm(false); return }
    let current = true
    setLoadingComm(true)
    supabase
      .from('notification_log')
      .select('id, notification_type, subject, status, sent_at, delivered_at, opened_at')
      .eq('contact_id', selectedId)
      .order('sent_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (!current) return
        setCommHistory(data || [])
        setLoadingComm(false)
      })
    return () => { current = false }
  }, [selectedId])

  // ── Fetch linked students ─────────────────────────────────────────────────
  // Academic Partners: students from the same school.
  // Preceptors: students currently assigned to this preceptor via preceptor_email.
  // `count: 'exact'` rides on the same request, so the Address book can say how many
  // there are when the list is capped, without a second query.
  useEffect(() => {
    const contact = contacts.find(c => c.id === selectedId)
    if (!contact) { setLinkedStudents([]); setLinkedStudentsTotal(0); setLoadingStudents(false); return }

    const isPreceptor = PRECEPTOR_ROLES.has(contact.role)
    let current = true

    if (isPreceptor && contact.email) {
      // Match students whose preceptor_email matches this contact's email
      setLoadingStudents(true)
      supabase
        .from('students')
        .select('id, first_name, preferred_first_name, last_name, status, matched_unit_id', { count: 'exact' })
        .ilike('preceptor_email', contact.email)
        .not('status', 'in', '(Not Proceeding,Declined)')
        .order('last_name')
        .order('first_name')
        .limit(15)
        .then(({ data, count }) => {
          if (!current) return
          setLinkedStudents(data || [])
          setLinkedStudentsTotal(count ?? (data || []).length)
          setLoadingStudents(false)
        })
      return () => { current = false }
    }

    if (contact.school_name) {
      setLoadingStudents(true)
      supabase
        .from('students')
        .select('id, first_name, preferred_first_name, last_name, status', { count: 'exact' })
        .eq('school', contact.school_name)
        .order('last_name')
        .order('first_name')
        .limit(12)
        .then(({ data, count }) => {
          if (!current) return
          setLinkedStudents(data || [])
          setLinkedStudentsTotal(count ?? (data || []).length)
          setLoadingStudents(false)
        })
      return () => { current = false }
    }

    setLinkedStudents([])
    setLinkedStudentsTotal(0)
    setLoadingStudents(false)
  }, [selectedId, contacts])

  // ── Restore selected contact on initial load ───────────────────────────────
  // Priority: URL ?contactId → localStorage → first contact in list.
  // Runs once after the contacts fetch completes; never re-runs on filter changes.
  useEffect(() => {
    if (loading || contacts.length === 0 || restoredRef.current) return
    restoredRef.current = true

    // 1. URL search param
    const urlId = new URLSearchParams(location.search).get('contactId')
    if (urlId && contacts.find(c => c.id === urlId)) {
      setSelectedId(urlId)
      return
    }

    // 2. localStorage
    const savedId = localStorage.getItem(LAST_CONTACT_KEY)
    if (savedId && contacts.find(c => c.id === savedId)) {
      setSelectedId(savedId)
      // Only update the URL when the Contacts tab is actually active.
      // If the user navigated directly to Outreach or another tab, do NOT
      // replace their URL with a contact URL - that would stomp the explicit route.
      if (location.pathname.startsWith('/connect/contacts')) {
        navigate(`/connect/contacts?contactId=${savedId}`, { replace: true })
      }
      return
    }

    // 3. First contact as default
    setSelectedId(contacts[0].id)
    if (location.pathname.startsWith('/connect/contacts')) {
      navigate(`/connect/contacts?contactId=${contacts[0].id}`, { replace: true })
    }
  }, [loading, contacts]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── React to ?contactId changes after initial mount ────────────────────────
  // Universal Search (and other deep links) can change the URL contactId while
  // ContactsView is already mounted. The restore effect above runs only once, so
  // without this the selection would not follow the new URL. Acts only on an
  // explicit, valid, changed id; absence of contactId is intentionally left to
  // the restore effect / existing state (direct nav to /connect/contacts keeps
  // the current selection). A non-existent/deleted id silently no-ops.
  useEffect(() => {
    const urlId = new URLSearchParams(location.search).get('contactId')
    if (urlId && urlId !== selectedId && contacts.some(c => c.id === urlId)) {
      setSelectedId(urlId)
    }
  }, [location.search, contacts]) // eslint-disable-line react-hooks/exhaustive-deps

  // Picking a contact from either layout's list: remember it in this browser and put it
  // in the URL, exactly as the Classic row always did.
  const selectContact = useCallback((id) => {
    setSelectedId(id)
    localStorage.setItem(LAST_CONTACT_KEY, id)
    navigate(`/connect/contacts?contactId=${id}`, { replace: true })
  }, [navigate])

  // ── Derived values ──────────────────────────────────────────────────────────
  const selected = contacts.find(c => c.id === selectedId) || null

  // Category counts - respect the showInactive toggle so pills count only visible contacts
  const categoryCounts = {}
  contacts
    .filter(c => showInactive || c.is_active !== false)
    .forEach(c => {
      getContactCategories(c).forEach(cat => {
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1
      })
    })
  const inactiveCount   = contacts.filter(c => c.is_active === false).length
  const activeCount     = contacts.length - inactiveCount

  const activeCategories = CATEGORY_ORDER.filter(cat =>
    cat === 'All' || (categoryCounts[cat] || 0) > 0
  )

  const filtered = contacts.filter(c => {
    // Hide inactive contacts when toggle is OFF
    if (!showInactive && c.is_active === false) return false
    const q = search.trim().toLowerCase()
    if (q) {
      const relatedStr = Array.isArray(c.related_units) ? c.related_units.join(' ') : ''
      const searchText = [
        c.full_name, c.preferred_name, c.email, c.organization,
        c.role, c.unit_name, relatedStr, c.school_name, c.notes,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!searchText.includes(q)) return false
    }
    if (categoryFilter !== 'All' && !getContactCategories(c).includes(categoryFilter)) return false
    return true
  })

  return {
    contacts, setContacts, loading, error,
    search, setSearch, categoryFilter, setCategoryFilter,
    selectedId, setSelectedId, selectContact, selected,
    showInactive, setShowInactive,
    commHistory, loadingComm,
    linkedStudents, linkedStudentsTotal, loadingStudents,
    categoryCounts, inactiveCount, activeCount, activeCategories, filtered,
  }
}
