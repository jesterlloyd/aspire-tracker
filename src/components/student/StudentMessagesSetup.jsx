import { useState } from 'react'
import { createPortal } from 'react-dom'
import useModalFocus from '../catalog/useModalFocus'
import { copyVisibleStudentContacts, visibleStudentContacts } from '../../lib/connect/copyStudentContacts'

export default function StudentMessagesSetup({ students, toast, onClose }) {
  const ref = useModalFocus(onClose)
  const [copied, setCopied] = useState(null)
  const [copying, setCopying] = useState(false)
  const numbers = visibleStudentContacts(students, 'phone').values
  const signature = numbers.join(',')
  const ready = numbers.length > 0 && copied === signature && !copying
  async function copy() {
    setCopied(null)
    setCopying(true)
    const result = await copyVisibleStudentContacts(students, 'phone', toast)
    if (result.copied) setCopied(result.values.join(','))
    setCopying(false)
  }
  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div ref={ref} className="modal student-messages-setup" role="dialog" aria-modal="true" aria-labelledby="student-messages-title" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="student-messages-title">Send Message to All</h2>
          <button type="button" className="modal-close" aria-label="Close group message" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p>Message students matching your current filters. Use the ASPIRE Group Message shortcut to open a draft with separate recipients.</p>
          <h3>Set up once on your iPhone</h3>
          <p>Open Shortcuts, tap +, and name the shortcut <strong>ASPIRE Group Message</strong>. Add these actions in order:</p>
          <ol>
            <li><strong>Get Clipboard</strong>.</li>
            <li><strong>Split Text</strong>: use Clipboard as the input. Change the separator to Custom and enter a comma: <code>,</code>.</li>
            <li><strong>Get Phone Numbers from Input</strong>: use the Split Text result.</li>
            <li><strong>Nothing</strong>: keeps the phone list out of the message body.</li>
            <li><strong>Send Message</strong>: leave Message blank. Press and hold Recipients, choose Select Variable, and select <strong>Phone Numbers</strong> from step 3. Expand the action and keep <strong>Show When Run</strong> on.</li>
          </ol>
          <h3>Use it with your filtered students</h3>
          <p>Copy the numbers below, then open the shortcut on your iPhone. If you copied on a computer, make sure that phone list is on your iPhone clipboard before running it.</p>
          <p>Check that the draft contains all <strong>{numbers.length}</strong> recipients, write your message, and tap Send yourself. This is a group conversation: recipients can see one another’s numbers and replies.</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary-outline" disabled={!numbers.length || copying} onClick={copy}>
            {copying ? 'Copying…' : `Copy ${numbers.length} phone numbers`}
          </button>
          {ready ? <a className="btn btn-primary" href="shortcuts://run-shortcut?name=ASPIRE%20Group%20Message">Open Shortcut on iPhone</a>
            : <button type="button" className="btn btn-primary" disabled>Copy numbers first</button>}
        </div>
      </div>
    </div>, document.body)
}
