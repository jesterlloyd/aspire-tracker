// src/components/connect/blocks/useCatalogForms.js
//
// OUTREACH-FORM-BUTTON-1, moved here by STUDIO-1 so Outreach's Button dialog and Studio's Catalog
// form block read the same list.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// The Catalog's forms (kind 'form'; the form id is in storage_path 'form:<id>'), read once.
export function useCatalogForms(active) {
  const [forms, setForms] = useState(null)
  useEffect(() => {
    if (!active || forms) return
    supabase.from('catalog_resources').select('title, storage_path, is_active').eq('kind', 'form').order('title')
      .then(({ data, error }) => setForms(error ? [] : (data || []).filter(r => r.is_active !== false && /^form:/.test(r.storage_path || ''))
        .map(r => ({ id: r.storage_path.slice(5), title: r.title }))))
      .catch(() => setForms([]))
  }, [active, forms])
  return forms
}
