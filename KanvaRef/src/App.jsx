import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Grid2x2, Link, Lock, Magnet, MessageSquare, Moon, Pencil, Plus, RotateCcw, Sun, Trash2, Unlock } from 'lucide-react'
import { Board } from './pages/Board'
import { getImage } from './storage/imageDB'
import { generateBoardId } from './utils/id'
import './App.css'

const NAV_ICON_SIZE = 20
const ICON_STROKE_WIDTH = 2.3
const RECENT_BOARDS_KEY = 'curate-recent-boards'
const MAX_RECENT_BOARDS = 12
const LOCAL_IMAGE_PREFIXES = ['data:image/', 'blob:', 'idb://']
const STORAGE_KEY = 'canvas-board-v1'

function normalizeRecentBoards(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => ({
      id: typeof item?.id === 'string' ? item.id : '',
      lastOpenedAt: typeof item?.lastOpenedAt === 'number' ? item.lastOpenedAt : 0,
      name: typeof item?.name === 'string' ? item.name.trim().slice(0, 80) : '',
    }))
    .filter((item) => item.id)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, MAX_RECENT_BOARDS)
}

function getBoardIdFromPath(pathname) {
  if (!pathname.startsWith('/board/')) return null
  const id = pathname.slice('/board/'.length).split('/')[0]
  return id || null
}

function formatBoardName(id) {
  return `Board ${id.slice(0, 8).toUpperCase()}`
}

function getBoardDisplayName(board) {
  return board.name || formatBoardName(board.id)
}

function isLocalImageSource(src) {
  return typeof src === 'string' && LOCAL_IMAGE_PREFIXES.some((prefix) => src.startsWith(prefix))
}

function isIdbImageSource(src) {
  return typeof src === 'string' && src.startsWith('idb://')
}

function getIdbImageId(src) {
  if (!isIdbImageSource(src)) return null
  return src.slice('idb://'.length) || null
}

async function getImageBlobBySrc(src) {
  const id = getIdbImageId(src)
  if (!id) return null
  return getImage(id)
}

async function uploadImageSourceForShare(src) {
  let blob = null
  if (isIdbImageSource(src)) {
    blob = await getImageBlobBySrc(src)
    if (!blob) throw new Error('Failed to read local image from IndexedDB')
  } else {
    const response = await fetch(src)
    if (!response.ok) throw new Error('Failed to read local image')
    blob = await response.blob()
  }
  if (!blob.type.startsWith('image/')) throw new Error('Invalid image type')
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
  const file = new File([blob], `share-${crypto.randomUUID()}.${extension}`, { type: blob.type || 'image/png' })

  const formData = new FormData()
  formData.append('file', file)
  const uploadResponse = await fetch('/api/upload-image', {
    method: 'POST',
    body: formData,
  })
  if (!uploadResponse.ok) throw new Error('Image upload failed')
  const payload = await uploadResponse.json()
  if (!payload?.url || typeof payload.url !== 'string') throw new Error('Invalid upload response')
  return payload.url
}

async function convertBoardImagesForShare(board) {
  const boardCopy = JSON.parse(JSON.stringify(board || {}))
  const srcMap = new Map()

  async function resolveSource(src) {
    if (!isLocalImageSource(src)) return src
    if (srcMap.has(src)) return srcMap.get(src)
    const uploadedUrl = await uploadImageSourceForShare(src)
    srcMap.set(src, uploadedUrl)
    return uploadedUrl
  }

  if (Array.isArray(boardCopy.images)) {
    for (const image of boardCopy.images) {
      if (!image || typeof image !== 'object') continue
      if (typeof image.src === 'string') {
        image.src = await resolveSource(image.src)
      }
      if (typeof image.originalSrc === 'string') {
        image.originalSrc = await resolveSource(image.originalSrc)
      }
    }
  }

  if (Array.isArray(boardCopy.objects)) {
    for (const object of boardCopy.objects) {
      if (!object || object.type !== 'image' || !object.data || typeof object.data !== 'object') continue
      if (typeof object.data.src === 'string') {
        object.data.src = await resolveSource(object.data.src)
      }
      if (typeof object.data.originalSrc === 'string') {
        object.data.originalSrc = await resolveSource(object.data.originalSrc)
      }
    }
  }

  return boardCopy
}

function LogoIcon() {
  return (
    <span className="top-nav__logo" aria-label="Curate">
      <span className="top-nav__logo-mark" aria-hidden="true">
        <Grid2x2 size={15} strokeWidth={2.1} />
      </span>
      <span className="top-nav__logo-wordmark">Curate</span>
    </span>
  )
}

function RedirectToNewBoard() {
  // Create a new board id when landing on root.
  const boardId = generateBoardId()

  return <Navigate to={`/board/${boardId}`} replace />
}

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [copied, setCopied] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('curate-theme') || 'dark')
  const [isBoardsOpen, setIsBoardsOpen] = useState(false)
  const [canvasToolbarState, setCanvasToolbarState] = useState({ isCommentMode: false, isCanvasLocked: false, isMagneticSnapEnabled: false })
  const [editingBoardId, setEditingBoardId] = useState(null)
  const [editingBoardName, setEditingBoardName] = useState('')
  const [recentBoards, setRecentBoards] = useState(() => {
    try {
      return normalizeRecentBoards(JSON.parse(localStorage.getItem(RECENT_BOARDS_KEY) || '[]'))
    } catch {
      return []
    }
  })
  const boardsPanelRef = useRef(null)

  const currentBoardId = getBoardIdFromPath(location.pathname)
  const isBoardRoute = Boolean(currentBoardId)

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = window.setTimeout(() => {
      setCopied(false)
    }, 1500)

    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    document.body.classList.toggle('theme-light', theme === 'light')
    document.body.classList.toggle('theme-dark', theme !== 'light')
    localStorage.setItem('curate-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!currentBoardId) return
    const now = Date.now()
    setRecentBoards((prev) => {
      const existing = prev.find((entry) => entry.id === currentBoardId)
      return normalizeRecentBoards([
        { id: currentBoardId, lastOpenedAt: now, name: existing?.name || '' },
        ...prev.filter((entry) => entry.id !== currentBoardId),
      ])
    })
  }, [currentBoardId])

  useEffect(() => {
    localStorage.setItem(RECENT_BOARDS_KEY, JSON.stringify(recentBoards))
  }, [recentBoards])

  useEffect(() => {
    if (!isBoardsOpen) return
    function handleOutsideClick(event) {
      if (boardsPanelRef.current?.contains(event.target)) return
      if (editingBoardId) {
        const trimmedName = editingBoardName.trim()
        if (trimmedName) {
          setRecentBoards((prev) =>
            normalizeRecentBoards(prev.map((entry) => (entry.id === editingBoardId ? { ...entry, name: trimmedName } : entry))),
          )
        }
        setEditingBoardId(null)
        setEditingBoardName('')
      }
      setIsBoardsOpen(false)
    }
    function handleEscape(event) {
      if (event.key !== 'Escape') return
      if (editingBoardId) {
        setEditingBoardId(null)
        setEditingBoardName('')
        return
      }
      setIsBoardsOpen(false)
    }
    window.addEventListener('mousedown', handleOutsideClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [editingBoardId, editingBoardName, isBoardsOpen])

  useEffect(() => {
    function handleCanvasToolbarState(event) {
      const detail = event.detail && typeof event.detail === 'object' ? event.detail : {}
      setCanvasToolbarState({
        isCommentMode: Boolean(detail.isCommentMode),
        isCanvasLocked: Boolean(detail.isCanvasLocked),
        isMagneticSnapEnabled: Boolean(detail.isMagneticSnapEnabled),
      })
    }
    window.addEventListener('curate:toolbar-state', handleCanvasToolbarState)
    return () => window.removeEventListener('curate:toolbar-state', handleCanvasToolbarState)
  }, [])

  async function handleShare() {
    if (!isBoardRoute) {
      return
    }

    try {
      const storageKey = `curate-board-${currentBoardId}`
      const rawBoard = localStorage.getItem(storageKey) || localStorage.getItem(STORAGE_KEY)
      let parsedBoard = {
        objects: [],
        images: [],
        comments: [],
      }
      if (rawBoard) {
        try {
          const candidate = JSON.parse(rawBoard)
          if (candidate && typeof candidate === 'object') {
            parsedBoard = candidate
          }
        } catch {
          parsedBoard = {
            objects: [],
            images: [],
            comments: [],
          }
        }
      }

      const boardForShare = await convertBoardImagesForShare(parsedBoard)
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ board: boardForShare }),
      })
      if (!response.ok) {
        setCopied(false)
        return
      }
      const data = await response.json()
      if (!data?.id || typeof data.id !== 'string') {
        setCopied(false)
        return
      }
      await navigator.clipboard.writeText(`${window.location.origin}/board/${data.id}`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function handleNewBoard() {
    const nextBoardUrl = `/board/${generateBoardId()}`
    window.open(nextBoardUrl, '_blank', 'noopener,noreferrer')
  }

  function handleOpenBoard(boardId) {
    navigate(`/board/${boardId}`)
    setIsBoardsOpen(false)
  }

  function handleDeleteBoardFromRecents(event, boardId) {
    event.preventDefault()
    event.stopPropagation()
    const confirmed = window.confirm('Remove this board from your recent list and local data?')
    if (!confirmed) return
    localStorage.removeItem(`curate-board-${boardId}`)
    localStorage.removeItem(`curate-board-snap-${boardId}`)
    localStorage.removeItem(`curate-board-snap-images-${boardId}`)
    setRecentBoards((prev) => prev.filter((entry) => entry.id !== boardId))
    if (editingBoardId === boardId) {
      setEditingBoardId(null)
      setEditingBoardName('')
    }
    if (boardId === currentBoardId) {
      const nextBoardId = generateBoardId()
      navigate(`/board/${nextBoardId}`, { replace: true })
    }
  }

  function handleStartRename(event, board) {
    event.preventDefault()
    event.stopPropagation()
    setEditingBoardId(board.id)
    setEditingBoardName(getBoardDisplayName(board))
  }

  function handleCancelRename() {
    setEditingBoardId(null)
    setEditingBoardName('')
  }

  function handleCommitRename(boardId, rawValue) {
    const trimmedName = rawValue.trim()
    if (!trimmedName) {
      handleCancelRename()
      return
    }
    setRecentBoards((prev) =>
      normalizeRecentBoards(prev.map((entry) => (entry.id === boardId ? { ...entry, name: trimmedName } : entry))),
    )
    setEditingBoardId(null)
    setEditingBoardName('')
  }

  function handleToggleTheme() {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }

  function dispatchCanvasToolbarAction(action) {
    window.dispatchEvent(new CustomEvent('curate:toolbar-action', { detail: { action } }))
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="top-nav__left">
          <LogoIcon />
        </div>
        <div className="top-nav__right">
          <button type="button" className="btn btn-icon top-nav__icon-button" onClick={handleToggleTheme}>
            {theme === 'light' ? <Sun size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /> : <Moon size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />}
          </button>
          <button
            type="button"
            className="btn btn-icon top-nav__button"
            onClick={handleShare}
            aria-label="Share board"
            title="Share board"
          >
            <span className="btn__icon" aria-hidden="true"><Link size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></span>
            <span className="visually-hidden">Share</span>
          </button>
        </div>
      </header>

      <div className="left-toolbar" ref={boardsPanelRef}>
        <button
          type="button"
          className="left-toolbar__button"
          onClick={handleNewBoard}
          aria-label="New board"
          data-tooltip="New Board"
        >
          <span className="btn__icon" aria-hidden="true"><Plus size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></span>
        </button>
        <div className="left-toolbar__boards">
          <button
            type="button"
            className="left-toolbar__button"
            onClick={() => setIsBoardsOpen((prev) => !prev)}
            aria-label="Boards"
            aria-expanded={isBoardsOpen}
            data-tooltip="Boards"
          >
            <span className="btn__icon" aria-hidden="true"><Grid2x2 size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></span>
          </button>

          {isBoardsOpen ? (
            <div className="top-nav__boards-panel left-toolbar__boards-panel">
              <div className="top-nav__boards-title">Your Boards</div>
              {recentBoards.length > 0 ? (
                <div className="top-nav__boards-list">
                  {recentBoards.map((board) => (
                    <div key={board.id} className="top-nav__boards-row">
                      {editingBoardId === board.id ? (
                        <div className="top-nav__boards-item top-nav__boards-item--editing">
                          <input
                            className="top-nav__boards-name-input"
                            value={editingBoardName}
                            onChange={(event) => setEditingBoardName(event.target.value)}
                            onBlur={() => handleCommitRename(board.id, editingBoardName)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                handleCommitRename(board.id, editingBoardName)
                              } else if (event.key === 'Escape') {
                                event.preventDefault()
                                handleCancelRename()
                              }
                            }}
                            maxLength={80}
                            autoFocus
                          />
                          <span className="top-nav__boards-item-meta">{new Date(board.lastOpenedAt).toLocaleString()}</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="top-nav__boards-item"
                          onClick={() => handleOpenBoard(board.id)}
                        >
                          <span className="top-nav__boards-item-name">{getBoardDisplayName(board)}</span>
                          <span className="top-nav__boards-item-meta">{new Date(board.lastOpenedAt).toLocaleString()}</span>
                        </button>
                      )}
                      <div className="top-nav__boards-actions">
                        <button
                          type="button"
                          className="top-nav__boards-edit"
                          onClick={(event) => handleStartRename(event, board)}
                          aria-label="Rename board"
                          title="Rename board"
                        >
                          <Pencil size={13} strokeWidth={ICON_STROKE_WIDTH} />
                        </button>
                        <button
                          type="button"
                          className="top-nav__boards-delete"
                          onClick={(event) => handleDeleteBoardFromRecents(event, board.id)}
                          aria-label="Delete board"
                          title="Delete board"
                        >
                          <Trash2 size={14} strokeWidth={ICON_STROKE_WIDTH} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="top-nav__boards-empty">No boards yet</div>
              )}
            </div>
          ) : null}
        </div>
        <div className="left-toolbar__divider" />
        <div className="left-toolbar__mode-indicator">
          <button
            type="button"
            className={`left-toolbar__button left-toolbar__button--comment ${canvasToolbarState.isCommentMode ? 'is-comment-active' : ''}`.trim()}
            onClick={() => dispatchCanvasToolbarAction('toggle-comment')}
            aria-label={canvasToolbarState.isCommentMode ? 'Comment mode active' : 'Enable comment mode'}
            data-tooltip={canvasToolbarState.isCommentMode ? 'Comment Mode Active' : 'Enable Comment Mode'}
          >
            <span className="btn__icon" aria-hidden="true"><MessageSquare size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></span>
          </button>
          {canvasToolbarState.isCommentMode ? (
            <div className="left-toolbar__mode-badge" role="status" aria-live="polite">COMMENT MODE</div>
          ) : null}
        </div>
        <button
          type="button"
          className={`left-toolbar__button left-toolbar__button--lock ${canvasToolbarState.isCanvasLocked ? 'is-locked-active' : ''}`.trim()}
          onClick={() => dispatchCanvasToolbarAction('toggle-lock')}
          aria-label={canvasToolbarState.isCanvasLocked ? 'Unlock canvas' : 'Lock canvas'}
          data-tooltip={canvasToolbarState.isCanvasLocked ? 'Canvas Locked' : 'Lock Canvas'}
        >
          <span className="btn__icon" aria-hidden="true">
            {canvasToolbarState.isCanvasLocked
              ? <Lock size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
              : <Unlock size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />}
          </span>
        </button>
        <div className="left-toolbar__mode-indicator">
          <button
            type="button"
            className={`left-toolbar__button left-toolbar__button--magnetic-snap ${canvasToolbarState.isMagneticSnapEnabled ? 'is-magnetic-snap-active' : ''}`.trim()}
            onClick={() => dispatchCanvasToolbarAction('toggle-magnetic-snap')}
            aria-label={canvasToolbarState.isMagneticSnapEnabled ? 'Disable magnetic snap' : 'Enable magnetic snap'}
            data-tooltip={canvasToolbarState.isMagneticSnapEnabled ? 'Magnetic Snap On' : 'Magnetic Snap Off'}
          >
            <span className="btn__icon" aria-hidden="true"><Magnet size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></span>
          </button>
          {canvasToolbarState.isMagneticSnapEnabled ? (
            <div className="left-toolbar__mode-badge left-toolbar__mode-badge--magnetic-snap" role="status" aria-live="polite">MAGNETIC SNAP</div>
          ) : null}
        </div>
        <button
          type="button"
          className="left-toolbar__button"
          onClick={() => dispatchCanvasToolbarAction('reset-view')}
          aria-label="Reset view"
          data-tooltip="Reset View"
        >
          <span className="btn__icon" aria-hidden="true"><RotateCcw size={NAV_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></span>
        </button>
      </div>

      {copied ? <div className="top-nav__toast">Link copied</div> : null}

      <Routes>
        <Route path="/" element={<RedirectToNewBoard />} />
        <Route path="/board/:id" element={<Board />} />
      </Routes>
    </div>
  )
}

export default App



