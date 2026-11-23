import { useId, useMemo, useState, type PointerEvent } from 'react'
import { ELO_START } from './elo.ts'
import { formatDelta } from './leaderboard.ts'

type Point = { rating: number; label: string; delta: number | null }

const WIDTH = 320
const HEIGHT = 120
const PAD = { top: 10, right: 8, bottom: 18, left: 36 }

/**
 * Courbe d'évolution de l'Elo (une série) : ligne fine, repère 1200 en pointillé,
 * survol / toucher → réticule et infobulle « Match n : Elo (écart) ».
 */
export function EloChart({ points, title }: { points: Point[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const titleId = useId()

  const geometry = useMemo(() => {
    const ratings = points.map((p) => p.rating)
    const min = Math.min(ELO_START, ...ratings)
    const max = Math.max(ELO_START, ...ratings)
    const span = Math.max(20, max - min)
    const low = min - span * 0.1
    const high = max + span * 0.1
    const innerW = WIDTH - PAD.left - PAD.right
    const innerH = HEIGHT - PAD.top - PAD.bottom
    const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
    const y = (r: number) => PAD.top + (1 - (r - low) / (high - low)) * innerH
    return { x, y, min, max, innerW }
  }, [points])

  if (points.length < 2) return null
  const { x, y, min, max, innerW } = geometry
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ')
  const active = hover === null ? null : points[hover]

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH
    const ratio = (px - PAD.left) / innerW
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))))
  }

  return (
    <figure className="relative space-y-1">
      <figcaption id={titleId} className="text-xs text-ink/60">
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-pan-y select-none"
        role="img"
        aria-labelledby={titleId}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* Axe : extrêmes et repère de départ */}
        {[max, min].map((v) => (
          <text key={v} x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="fill-ink/50 text-[9px] tabular-nums">
            {v}
          </text>
        ))}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(ELO_START)}
          y2={y(ELO_START)}
          className="stroke-ink/20"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
        {min !== ELO_START && max !== ELO_START && (
          <text x={PAD.left - 6} y={y(ELO_START) + 3} textAnchor="end" className="fill-ink/40 text-[9px] tabular-nums">
            {ELO_START}
          </text>
        )}
        <text x={PAD.left} y={HEIGHT - 4} className="fill-ink/40 text-[9px]">
          départ
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 4} textAnchor="end" className="fill-ink/40 text-[9px]">
          {points.length - 1} match{points.length > 2 ? 's' : ''}
        </text>

        <path d={path} fill="none" className="stroke-court" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* Dernier point mis en avant */}
        <circle
          cx={x(points.length - 1)}
          cy={y(points[points.length - 1].rating)}
          r={4}
          className="fill-court stroke-white"
          strokeWidth={2}
        />
        {active && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="stroke-ink/30" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(active.rating)} r={5} className="fill-court stroke-white" strokeWidth={2} />
          </>
        )}
      </svg>
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute top-5 rounded-lg bg-ink px-2 py-1 text-xs whitespace-nowrap text-white shadow"
          style={{
            left: `${(x(hover) / WIDTH) * 100}%`,
            transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})`,
          }}
        >
          <span className="font-semibold tabular-nums">{active.rating}</span>
          {active.delta !== null && <span className="tabular-nums"> ({formatDelta(active.delta)})</span>}
          <span className="block text-white/70">{active.label}</span>
        </div>
      )}
    </figure>
  )
}
