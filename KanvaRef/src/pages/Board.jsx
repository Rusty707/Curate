import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Canvas } from '../components/Canvas'

const SHARE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function Board() {
  const { id } = useParams()
  const [canvasVersion, setCanvasVersion] = useState(0)

  useEffect(() => {
    if (!id) return
    if (!SHARE_ID_REGEX.test(id)) return
    let isCancelled = false

    async function hydrateBoardFromCloud() {
      try {
        const response = await fetch(`/api/board/${encodeURIComponent(id)}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) return
        const payload = await response.json()
        if (!payload?.board || typeof payload.board !== 'object') return
        localStorage.setItem(`curate-board-${id}`, JSON.stringify(payload.board))
        if (!isCancelled) {
          setCanvasVersion((prev) => prev + 1)
        }
      } catch {
        // Keep local-first behavior when cloud fetch fails.
      }
    }

    hydrateBoardFromCloud()
    return () => {
      isCancelled = true
    }
  }, [id])

  return (
    <main>
      <h1>Board {id}</h1>
      <Canvas key={`${id}-${canvasVersion}`} />
    </main>
  )
}
