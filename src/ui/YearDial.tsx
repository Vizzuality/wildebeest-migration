import { useRef } from 'react'
import { MONTHS_SHORT, RAIN_NORTH, RAIN_SOUTH } from '../geo'
import { useStore } from '../store'

const SIZE = 236
const C = SIZE / 2
const MAX_RAIN = 200

function polar(r: number, month: number) {
  const a = (month / 12) * Math.PI * 2 - Math.PI / 2
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const
}

function arc(r0: number, r1: number, m0: number, m1: number) {
  const [x0, y0] = polar(r0, m0)
  const [x1, y1] = polar(r1, m0)
  const [x2, y2] = polar(r1, m1)
  const [x3, y3] = polar(r0, m1)
  return `M${x0},${y0} L${x1},${y1} A${r1},${r1} 0 0 1 ${x2},${y2} L${x3},${y3} A${r0},${r0} 0 0 0 ${x0},${y0}Z`
}

function RainRing({ data, r0, depth, label }: { data: number[]; r0: number; depth: number; label: string }) {
  return (
    <g aria-label={label}>
      {data.map((mm, i) => (
        <g key={i}>
          <path d={arc(r0, r0 + depth, i + 0.08, i + 0.92)} className="ring-track" />
          <path d={arc(r0, r0 + (depth * mm) / MAX_RAIN, i + 0.08, i + 0.92)} className="ring-bar">
            <title>{`${label}: ~${mm} mm`}</title>
          </path>
        </g>
      ))}
    </g>
  )
}

export function YearDial() {
  const month = useStore((s) => s.month)
  const playing = useStore((s) => s.playing)
  const set = useStore((s) => s.set)
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  const scrub = (e: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect()
    const x = e.clientX - rect.left - rect.width / 2
    const y = e.clientY - rect.top - rect.height / 2
    let a = Math.atan2(y, x) + Math.PI / 2
    if (a < 0) a += Math.PI * 2
    set({ month: (a / (Math.PI * 2)) * 12 })
  }

  const [hx, hy] = polar(104, month)
  const [nx0, ny0] = polar(46, month)

  return (
    <div className="dial">
      <svg
        ref={svg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('.dial-center')) return
          dragging.current = true
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          scrub(e)
        }}
        onPointerMove={(e) => dragging.current && scrub(e)}
        onPointerUp={() => (dragging.current = false)}
        role="slider"
        aria-label="Mes del año"
        aria-valuemin={0}
        aria-valuemax={12}
        aria-valuenow={Math.round(month * 10) / 10}
      >
        <RainRing data={RAIN_SOUTH} r0={50} depth={24} label="Lluvia en el sur (Ndutu)" />
        <RainRing data={RAIN_NORTH} r0={78} depth={24} label="Lluvia en el norte (Mara)" />
        {MONTHS_SHORT.map((m, i) => {
          const [x, y] = polar(112, i + 0.5)
          const active = Math.floor(month) === i
          return (
            <text key={m} x={x} y={y} className={`dial-month${active ? ' active' : ''}`} textAnchor="middle" dominantBaseline="central">
              {m[0]}
            </text>
          )
        })}
        <line x1={nx0} y1={ny0} x2={hx} y2={hy} className="dial-hand" />
        <circle cx={hx} cy={hy} r={5.5} className="dial-knob" />
        <g className="dial-center" onClick={() => set({ playing: !playing })} role="button" aria-label={playing ? 'Pausar' : 'Reproducir'}>
          <circle cx={C} cy={C} r={40} />
          {playing ? (
            <g transform={`translate(${C - 7} ${C - 9})`}>
              <rect width="5" height="18" rx="1.5" />
              <rect x="9" width="5" height="18" rx="1.5" />
            </g>
          ) : (
            <path d={`M${C - 5},${C - 10} L${C + 10},${C} L${C - 5},${C + 10}Z`} />
          )}
        </g>
      </svg>
      <div className="dial-legend">
        <span><b className="sw" /> Lluvia mensual aprox. · anillo interior: sur · exterior: norte</span>
      </div>
    </div>
  )
}
