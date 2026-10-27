import { type PointerEvent, useRef } from 'react'
import { useStore } from '../store'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Where a month (0–12) sits down the line, as a CSS length: each label marks its month's first day. */
const at = (month: number) => `calc(var(--top) + ${month / 12} * (100% - var(--top) - var(--bottom)))`

/** The year down the left edge: drag along the line, or click a month to jump to its first day. */
export function Timeline() {
  const month = useStore((s) => s.month)
  const set = useStore((s) => s.set)
  const track = useRef<HTMLDivElement>(null)

  const seek = (e: PointerEvent) => {
    const el = track.current
    if (!el) return
    const { top, height } = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const start = parseFloat(style.getPropertyValue('--top'))
    const end = parseFloat(style.getPropertyValue('--bottom'))
    const t = (e.clientY - top - start) / (height - start - end)
    set({ month: Math.min(Math.max(t, 0), 0.9999) * 12 })
  }

  return (
    <nav className="timeline" aria-label="Year">
      <ol>
        {MONTHS.map((m, i) => (
          <li key={m} style={{ top: at(i) }}>
            <button onClick={() => set({ month: i })}>{m}</button>
          </li>
        ))}
      </ol>
      <div
        ref={track}
        className="track"
        role="slider"
        aria-label="Month"
        aria-valuemin={0}
        aria-valuemax={12}
        aria-valuenow={Math.round(month * 100) / 100}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          seek(e)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(e)
        }}
      >
        <i className="progress" style={{ height: at(month) }} />
        <i className="playhead" style={{ top: at(month) }} />
      </div>
    </nav>
  )
}
