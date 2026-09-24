// src/components/forms/FormsScreen.jsx
//
// FORMS-PHASE3: the Catalog's form screens, one lazy chunk: /catalog/forms/:id/edit (the
// builder) and /catalog/forms/:id/responses (the tracker). CatalogPage mounts it for any
// /catalog/forms/ path and hands it the Catalog's own toast.
import FormBuilder from './FormBuilder'
import FormResponses from './FormResponses'
import './forms.css'

export default function FormsScreen({ formId, view, notify, navigate }) {
  const back = () => navigate('/catalog')
  if (!/^[0-9a-f-]{36}$/i.test(formId || '')) return <div className="fm"><p className="fm-err" role="alert">That form link is not complete.</p></div>
  return view === 'responses'
    ? <FormResponses formId={formId} notify={notify} onBack={back} onEdit={() => navigate(`/catalog/forms/${formId}/edit`)} />
    : <FormBuilder formId={formId} notify={notify} onBack={back} onResponses={() => navigate(`/catalog/forms/${formId}/responses`)} />
}
