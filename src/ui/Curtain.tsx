import { Component, type ReactNode } from 'react'

export function Curtain({ leaving = false }: { leaving?: boolean }) {
  return (
    <div className={`curtain${leaving ? ' leaving' : ''}`} aria-hidden={leaving}>
      <p>Cargando relieve…</p>
    </div>
  )
}

export class TerrainErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="curtain" role="alert">
        <p>No se ha podido cargar el relieve.</p>
        <button onClick={() => this.setState({ failed: false })}>Reintentar</button>
      </div>
    )
  }
}
