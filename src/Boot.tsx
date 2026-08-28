import { Component, type ReactNode } from 'react'

/**
 * The last thing between a mistake and a white rectangle.
 *
 * The portal throws on purpose when its Supabase settings are missing —
 * better than pretending to work — but an uncaught throw during render
 * leaves an empty page with the reason only in the console, which is the
 * one place nobody looks. This puts the reason on the screen.
 */
export class Boot extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error) { console.error('portal failed to start', error) }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="boot-fail">
        <div>
          <p className="wordmark small">CYRIX<span>&reg;</span></p>
          <h1>Cyrix cannot start.</h1>
          <p>{this.state.error.message}</p>
          <button className="primary" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    )
  }
}
