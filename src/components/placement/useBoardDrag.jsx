// INTERVIEW-BOARD-1: the drag behaviour every matching board shares.
//
// There are two matching boards in this app - Rotation > Placement Board (students
// to units) and Residency > Interview Board (interviewees to hiring units) - and the
// Owner's rule is that they are the same board wearing different nouns. Dragging is
// the part most likely to drift if each of them keeps its own copy, so it lives here
// once and both call it.
//
// WHAT IT OWNS, and why each piece is the way it is:
//   - The browser's own drag image is SUPPRESSED with a 1x1 transparent GIF. It is a
//     translucent copy of the note, and it covered the badge under the cursor.
//   - Because it is suppressed, the board must draw its own ghost, or nothing appears
//     to move. The ghost carries the person's name, plus a green (+) that shows ONLY
//     over a board that has room.
//   - The ghost follows `drag` (fires on the source everywhere) AND `dragover` (drop
//     targets swallow `drag`), moved imperatively so a 60Hz drag never re-renders.
//   - The badge is decided by a DOCUMENT-level dragover, which runs last in the bubble
//     path: a board asks for the badge during its own dragover, and the document hides
//     it when nobody asked. A board's `dragleave` arrives AFTER the next board's
//     `dragover`, so leave events must never decide it.
//
// The caller supplies what the board means: whether a target has room, and what a drop
// does. This module never touches data.

import { useRef, useState } from 'react'

export function useBoardDrag({ hasRoom, onDropOnTarget, onDropOnList } = {}) {
  const dragRef = useRef(null)          // { kind: 'list' | 'target', id, targetId, name }
  const ghostRef = useRef(null)
  const ghostNameRef = useRef(null)
  const badgeRef = useRef(null)
  const badgeWanted = useRef(false)
  const [dragKind, setDragKind] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [dropTargetId, setDropTargetId] = useState(null)
  const [listDropActive, setListDropActive] = useState(false)

  const [dragImage] = useState(() => {
    if (typeof Image === 'undefined') return null
    const img = new Image()
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    return img
  })

  const moveGhost = (e) => {
    const ghost = ghostRef.current
    if (!ghost || (!e.clientX && !e.clientY)) return   // the last drag event reports 0,0
    ghost.style.transform = `translate3d(${e.clientX + 14}px, ${e.clientY + 14}px, 0)`
    ghost.style.opacity = '1'
  }
  const showBadgeAt = (e) => {
    badgeWanted.current = true
    moveGhost(e)
    if (badgeRef.current) badgeRef.current.style.opacity = '1'
  }
  const hideBadge = () => {
    if (badgeRef.current) badgeRef.current.style.opacity = '0'
  }
  const hideGhost = () => {
    if (ghostRef.current) {
      ghostRef.current.style.opacity = '0'
      ghostRef.current.style.transform = 'translate3d(-9999px, -9999px, 0)'
    }
    hideBadge()
  }

  const onDocumentDragOver = (e) => {
    moveGhost(e)
    if (!badgeWanted.current) hideBadge()
    badgeWanted.current = false
  }
  const onDocumentDrag = (e) => moveGhost(e)

  const startDrag = (e, payload) => {
    if (ghostNameRef.current) ghostNameRef.current.textContent = payload.name
    document.addEventListener('dragover', onDocumentDragOver)
    document.addEventListener('drag', onDocumentDrag)
    dragRef.current = payload
    setDragKind(payload.kind)
    setDraggingId(payload.id)
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', payload.name)
      if (dragImage) e.dataTransfer.setDragImage(dragImage, 0, 0)
    } catch { /* some browsers restrict dataTransfer; the ref carries the payload */ }
  }

  const endDrag = () => {
    setDraggingId(null)
    document.removeEventListener('dragover', onDocumentDragOver)
    document.removeEventListener('drag', onDocumentDrag)
    badgeWanted.current = false
    hideGhost()
    dragRef.current = null
    setDragKind(null)
    setDropTargetId(null)
    setListDropActive(false)
  }

  /** A note in the list (students, interviewees) being dragged onto a board. */
  const startListDrag = (e, { id, name }) => startDrag(e, { kind: 'list', id, name })

  /** A note already on a board being dragged back to the list. */
  const startTargetDrag = (e, { id, targetId, name }) => {
    e.stopPropagation()
    startDrag(e, { kind: 'target', id, targetId, name })
  }

  /** Spread onto a board: {...targetHandlers(targetId)}. */
  const targetHandlers = (targetId) => ({
    onDragOver: (e) => {
      if (dragRef.current?.kind !== 'list') return
      e.preventDefault()
      const room = hasRoom ? !!hasRoom(targetId) : true
      e.dataTransfer.dropEffect = room ? 'move' : 'none'
      // The badge says "this slot will take them", so it appears only where that is
      // true. Over a full board there is no badge, and the drop is refused the same
      // way the click path refuses it.
      if (room) showBadgeAt(e); else hideBadge()
      setDropTargetId(targetId)
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return
      setDropTargetId(prev => (prev === targetId ? null : prev))
    },
    onDrop: (e) => {
      const drag = dragRef.current
      if (drag?.kind !== 'list') return
      e.preventDefault()
      endDrag()
      onDropOnTarget?.(drag.id, targetId)
    },
  })

  /** Spread onto the list column: {...listHandlers}. */
  const listHandlers = {
    onDragOver: (e) => {
      if (dragRef.current?.kind !== 'target') return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setListDropActive(true)
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return
      setListDropActive(false)
    },
    onDrop: (e) => {
      const drag = dragRef.current
      if (drag?.kind !== 'target') return
      e.preventDefault()
      endDrag()
      onDropOnList?.(drag.id, drag.targetId)
    },
  }

  // Render once, anywhere in the board: it is position: fixed and pointer-events: none.
  const dragLayer = (
    <div ref={ghostRef} className="pb-drag-ghost" aria-hidden="true">
      <span ref={ghostNameRef} className="pb-drag-ghost-name" />
      <span ref={badgeRef} className="pb-drag-badge material-pin material-rank-first">+</span>
    </div>
  )

  return {
    dragLayer, dragKind, draggingId, dropTargetId, listDropActive,
    startListDrag, startTargetDrag, endDrag, targetHandlers, listHandlers,
  }
}
