// The cohort-password access card, shared by the public /school-form gate (SchoolFormPage) and the
// authenticated Academic Partner Placement Requests gate (PlacementRequestsView). Extracting this ONE
// presentation converges the card, spacing, and access interaction across both surfaces so they cannot
// drift, while each caller keeps its own centering context:
//   - public: rendered inside the full-screen .uf-page shell, with the Cedars-Sinai logo passed in
//   - portal: rendered inside a centered .ptl-plr-gate-center wrapper, with NO logo/full-screen shell
//
// Presentation only. Password state, the verify RPC, and the transient-password / final-POST
// re-verification all stay with the caller, so behavior is unchanged. The card never stores or exposes
// the password.

export default function CohortAccessCard({
  logo = null,
  title = 'School Coordinator Access',
  intro,
  value,
  onChange,
  onSubmit,
  error = null,
  busy = false,
  submitLabel = 'Access Form',
  busyLabel = 'Verifying…',
  inputPlaceholder = 'Enter cohort password',
}) {
  return (
    <div className="cohort-access-card">
      {logo}
      <h2 className="cohort-access-title">{title}</h2>
      <p className="cohort-access-intro">{intro}</p>
      <form className="cohort-access-form" onSubmit={onSubmit}>
        <input
          type="password"
          className={`cohort-access-input${error ? ' is-error' : ''}`}
          value={value}
          onChange={onChange}
          placeholder={inputPlaceholder}
          autoFocus
        />
        {error && <p className="cohort-access-error" role="alert">{error}</p>}
        <button type="submit" className="cohort-access-submit" disabled={busy || !String(value || '').trim()}>
          {busy ? busyLabel : submitLabel}
        </button>
      </form>
    </div>
  )
}
