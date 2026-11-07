import type { CSSProperties } from 'react'
import { MapPin, TriangleAlert } from 'lucide-react'
import { all, data, shortDate, usd, type DateRange } from '@/data/dashboard'
import consoleData from '@/data/consoleData.json'
import { palette } from './dashboard-charts'

const width = 700
const height = 410
const heat = [palette.alert, palette.green, palette.gold]
const anchors = new Map(consoleData.zones.map(zone => [
  zone.zone_id, { x: 30 + zone.x_m * 4.85, y: 33 + zone.y_m * 3.25 },
]))
const layout = data.zones.map((zone, index) => ({
  ...zone, index: String(index), ...anchors.get(zone.zone_id)!,
}))

export function FloorBlueprint({ rates, selected, range, select }: {
  rates: Map<string, number | null>; selected: string; range: DateRange; select: (zone: string) => void
}) {
  const values = [...rates.values()].filter((value): value is number => value !== null)
  const min = values.length ? Math.min(...values) : null
  const max = values.length ? Math.max(...values) : null
  const closure = consoleData.walkways.find(path => path.closure_start && path.closure_end)
  const start = closure?.closure_start
  const end = closure?.closure_end
  const overlaps = !!start && !!end && range.start <= end && range.end >= start
  const fullyClosed = overlaps && range.start >= start! && range.end <= end!
  const closureLabel = fullyClosed ? 'Closed in selection' : overlaps ? 'Closure overlaps selection' : 'Historical closure'

  return <div className="blueprint">
    <div className="map-board">
      <svg viewBox="0 0 700 410" preserveAspectRatio="none" className="map-plan" aria-hidden="true">
        <path className="map-perimeter" d="M22 158H224V24H422V61H642V240H689V402H17V288H22Z" />
        {consoleData.walkways.map(path => {
          const a = anchors.get(path.zone_a)!
          const b = anchors.get(path.zone_b)!
          const barrier = path.walkway_id === closure?.walkway_id
          const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2
          const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
          return <g key={path.walkway_id}>
            <line className="map-corridor" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <line className={barrier ? 'map-path closure-path' : 'map-path'} data-active={barrier && overlaps}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            {barrier && <g transform={`translate(${x},${y}) rotate(${angle})`} className="map-barrier" data-active={overlaps}>
              <path d="M-5 -14V14M5 -14V14M-5 -10L5 -2M-5 0L5 8" />
            </g>}
          </g>
        })}
      </svg>
      <span className="map-drawing-id" aria-hidden="true">FP–01 <span>·</span> SCHEMATIC</span>
      {layout.map(room => {
        const value = rates.get(room.index) ?? null
        const step = value === null || min === null || max === null || max === min ? 1 :
          Math.round((value - min) / (max - min) * (heat.length - 1))
        const style = {
          left: room.x / width * 100 + '%', top: room.y / height * 100 + '%',
          '--zone-heat': value === null ? palette.slate : heat[step],
        } as CSSProperties
        return <button type="button" key={room.zone_id} style={style} className="map-room"
          aria-label={room.zone_name + ', ' + usd(value) + ' coin-in per available hour'}
          aria-pressed={room.index === selected} onClick={() => select(selected === room.index ? all : room.index)}>
          <span className="map-room-name">{room.zone_name}</span>
          <span className="map-room-value">{usd(value)}</span>
        </button>
      })}
    </div>
    <div className="map-legend">
      <span className="map-scale" aria-label="Heatmap range">
        <span>{usd(min)}</span><span className="map-swatches" aria-hidden="true">{heat.map(color =>
          <i key={color} style={{ backgroundColor: color }} />)}</span><span>{usd(max)}</span>
      </span>
      <span className={overlaps ? 'walkway-status is-active' : 'walkway-status'}>
        <TriangleAlert size={13} />
        <span>{closureLabel}{start && end && <span className="walkway-dates"> · {shortDate(start)}–{shortDate(end)}</span>}</span>
      </span>
    </div>
    {selected !== all && <div className="map-selection"><MapPin size={13} /><span>{data.zones[Number(selected)].zone_name}</span>
      <button type="button" onClick={() => select(all)}>Clear zone</button></div>}
  </div>
}
