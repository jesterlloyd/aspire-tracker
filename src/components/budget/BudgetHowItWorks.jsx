// src/components/budget/BudgetHowItWorks.jsx
//
// BUDGET-FIXES-1 item 2.1 (Owner, 2026-09-29): "How this works" is a link beside the Program Budget
// tabs that opens the five steps of the month. It used to be a card at the top of the Summary. It is
// folded unless the person opened it, and that choice follows the person (the preference registry,
// src/lib/userPreferences.js), not the browser. Only the owner's staff app renders it.
import { useId } from 'react'
import { useUserPreference } from '../../hooks/useUserPreference'
import { BUDGET_HOW_IT_WORKS } from '../../lib/userPreferences'

const STEPS = [
  ['Expect', 'Approved subscriptions create the month’s charges ahead of time.', 'The app'],
  ['Post', 'On its date, a charge counts as spent. It shows Missing until its receipt arrives.', 'The app'],
  ['Match or add', 'Keith reads each receipt. It attaches to a charge, or becomes a new one-time expense.', 'Keith proposes, you decide'],
  ['Submit', 'Personal purchases go to Concur. Mark them Submitted to Concur, then Reimbursed or Paid.', 'You'],
  ['Close the month', 'Every charge has a receipt, nothing is left to review, Concur is done. Months close oldest first.', 'You, reminded on the 5th'],
]

/** The tab row with the link beside it, and the steps below it when open. */
export default function BudgetHowItWorks({ children }) {
  const [value, setValue] = useUserPreference(BUDGET_HOW_IT_WORKS)
  const open = value === 'open'
  const id = useId()
  return (
    <>
      <div className="bud-tabrow">
        {children}
        <button type="button" className="bud-linkbtn bud-how-link" aria-expanded={open} aria-controls={id}
          onClick={() => { setValue(open ? 'closed' : 'open').catch(() => {}) }}>{open ? 'Hide how this works' : 'How this works'}</button>
      </div>
      {open && (
        <section id={id} className="bud-how" aria-label="How the budget works each month">
          <ol className="bud-cycle">
            {STEPS.map(([t, d, who], i) => <li key={t}><span className="no">Step {i + 1}</span><b>{t}</b><small>{d}</small><span className="who">{who}</span></li>)}
          </ol>
          <p className="bud-lane"><span>Each expense:</span> Expected → Posted → Receipt attached → Submitted to Concur → Reimbursed or Paid. <span className="bud-hint">One-time purchases start at Posted, the moment you add them.</span></p>
        </section>
      )}
    </>
  )
}
