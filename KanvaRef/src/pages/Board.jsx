import { useParams } from 'react-router-dom'
import { Canvas } from '../components/Canvas'

export function Board() {
  const { id } = useParams()

  return (
    <main>
      <h1>Board {id}</h1>
      <Canvas />
    </main>
  )
}
