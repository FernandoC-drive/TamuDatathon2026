import { addFloor, availability, coin, data, floorTotal, group, hold, houseWin, number, payoutZ, percent, ratio, shortUsd, theo, usd,
  type FloorRow, type FloorTotal } from '@/data/dashboard'

function Sparkline({ values }: { values: (number | null)[] }) {
  const valid = values.filter((value): value is number => value !== null)
  if (!valid.length) return <svg className="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="M2 22H98" className="spark-baseline" /></svg>
  const low = Math.min(...valid), high = Math.max(...valid)
  const x = (i: number) => values.length === 1 ? 50 : 2 + i / (values.length - 1) * 96
  const y = (value: number) => high === low ? 12 : 21 - (value - low) / (high - low) * 17
  const path = values.map((value, i) => {
    const command = i > 0 && values[i - 1] !== null ? 'L' : 'M'
    return value === null ? '' : command + x(i).toFixed(2) + ' ' + y(value).toFixed(2)
  }).join(' ')
  const end = values.findLastIndex(value => value !== null)
  return <svg className="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
    <path d="M2 22H98" className="spark-baseline" />
    <path d={path} className="spark-trend" />
    <circle cx={x(end)} cy={y(values[end]!)} r="1.8" />
  </svg>
}

export function FloorTicker({ total, rows, dates }: { total: FloorTotal; rows: FloorRow[]; dates: string[] }) {
  const bins = group(rows, row => Math.floor(row[0] / 7), floorTotal, addFloor)
  const weeks = [...new Set(dates.map(date => Math.floor(data.dates.indexOf(date) / 7)))].map(week => bins.get(week))
  const variance = ratio(houseWin(total) - theo(total), theo(total))
  const z = payoutZ(total)
  const delta = variance === null ? '—' : (variance > 0 ? '+' : '') + percent(variance)
  const neutral = z !== null && Math.abs(z) < 1.96
  const values = [
    { label: 'Total coin-in', value: shortUsd(coin(total)), detail: usd(coin(total)) + ' wagered', read: coin, tone: 'gold', featured: true },
    { label: 'House win', value: shortUsd(houseWin(total)), detail: delta + ' vs theo' + (neutral ? ' · Luck neutral' : ''), read: houseWin, tone: 'gold', featured: true },
    { label: 'Theoretical win', value: shortUsd(theo(total)), detail: usd(theo(total)) + ' expected', read: theo, tone: 'gold' },
    { label: 'Observed hold', value: percent(hold(total)), detail: percent(ratio(theo(total), coin(total))) + ' theo hold', read: hold, tone: 'sage' },
    { label: 'Availability', value: percent(availability(total)),
      detail: number(total.available / 3600) + ' / ' + number(total.scheduled / 3600) + ' h', read: availability, tone: 'sage' },
  ]
  return <section className="floor-ticker" aria-label="Floor status ticker. Sparklines show seven-day blocks.">
    {values.map(metric => <div className={'ticker-cell ticker-' + metric.tone + (metric.featured ? ' is-featured' : '')} key={metric.label}>
      <div className="ticker-label">{metric.label}</div>
      <div className="ticker-value">{metric.value}</div>
      <div className="ticker-detail" title={metric.label === 'House win' ? 'Luck neutral uses an absolute aggregate z below 1.96.' : undefined}>{metric.detail}</div>
      <Sparkline values={weeks.map(week => week ? metric.read(week) : null)} />
    </div>)}
  </section>
}
