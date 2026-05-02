export default function ConfirmDeleteModal({ title, warning, onConfirm, onClose }) {
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal confirm-delete-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="confirm-delete-warning">{warning}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-destructive-filled" onClick={onConfirm}>Yes, Delete</button>
        </div>
      </div>
    </div>
  )
}
