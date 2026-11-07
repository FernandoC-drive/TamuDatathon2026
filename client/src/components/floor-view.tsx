import { useMemo, useRef, useState } from 'react'
import { ArrowUpRight, CircleAlert } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, Cell, Legend, Line, LineChart } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { ChartFrame, DataTable, Filter, Help, Metric, Panel, Section } from './dashboard-ui'
import { categoryAxis, chartGrid, chartTooltip, dateAxis, palette, valueAxis } from './dashboard-charts'
import { FloorBlueprint } from './floor-blueprint'
import { FloorTicker } from './floor-ticker'
import { MachineDossier } from './machine-dossier'
import {
  addFloor, all, availability, coin, data, floor, floorMatches, floorTotal, group, hold, hourly,
  houseWin, inRange, matches, number, payoutZ, percent, ratio, shortDate, shortUsd, sumFloor, theo, usd,
  type DateRange, type FloorScope, type FloorTotal,
} from '@/data/dashboard'

const tags = [
  { value: 'gm', label: 'GM Bottom 10' }, { value: 'payout', label: 'Payout Outlier |z| ≥ 3.77' },
  { value: 'downtime', label: 'High Downtime' }, { value: 'exposure', label: 'Short Exposure' },
  { value: 'local', label: 'Low Local Demand' }, { value: 'location', label: 'Weak Location' },
]
const zones = data.zones.map((row, i) => ({ value: String(i), label: row.zone_name }))
const eventByDate = new Map(data.demand.map(row => [row.gaming_date, row.event_names]))
type Machine = (typeof data.machine)[number]
const demandMeasures = [
  { value: 'coin', label: 'Coin-in' }, { value: 'win', label: 'House win and theo' },
  { value: 'hold', label: 'Observed hold' }, { value: 'availability', label: 'Availability' },
]

function matchesTag(machine: Machine, tag: string) {
  switch (tag) {
    case 'gm': return machine.gm_rank <= 10
    case 'payout': return machine.payout_inspection
    case 'downtime': return machine.high_downtime
    case 'exposure': return machine.short_exposure
    case 'local': return machine.low_local_demand
    case 'location': return machine.weak_location
    default: return true
  }
}

function MachineStatus({ machine }: { machine: Machine }) {
  return <div className="flex items-center gap-2">
    {machine.gm_rank <= 10 && <span className="matrix-rank">GM {String(machine.gm_rank).padStart(2, '0')}</span>}
    <span className={machine.payout_inspection ? 'matrix-flag is-alert' : machine.low_local_demand ? 'matrix-flag is-watch' : 'matrix-flag'}>
      {machine.payout_inspection && <CircleAlert size={13} />}
      {machine.payout_inspection ? 'Verify payout' : machine.primary_diagnosis}
    </span>
    {machine.low_local_demand && machine.short_exposure && <span className="matrix-flag">Low local demand</span>}
  </div>
}

const closurePhases = [
  { name: 'Before', start: '2025-01-27', end: '2025-03-02' },
  { name: 'During', start: '2025-03-03', end: '2025-04-06' },
  { name: 'After', start: '2025-04-07', end: '2025-05-11' },
]
const backForty = data.zones.findIndex(zone => zone.zone_id === 'Z-B40')
const closure = closurePhases.map(phase => {
  const dated = floor.filter(row => inRange(data.dates[row[0]], phase))
  const back = sumFloor(dated.filter(row => row[2] === backForty))
  const rest = sumFloor(dated.filter(row => row[2] !== backForty))
  return { name: phase.name, backCoin: coin(back), otherCoin: coin(rest), backRate: hourly(back), otherRate: hourly(rest) }
})
const shifts = ['day', 'swing', 'grave']
const recordedMoves = data.placement.flatMap((placement, i) => {
  const before = data.placement[i - 1]
  if (before?.machine_id !== placement.machine_id || before.location_id === placement.location_id) return []
  return [{ before, after: placement }]
})
const downtimeFields = [
  { value: 'shift', label: 'Shift' }, { value: 'manufacturer', label: 'Manufacturer' },
  { value: 'local_weekday', label: 'Weekday' }, { value: 'event_type', label: 'Ticket category' },
  { value: 'techs', label: 'Technicians on duty' },
] as const
type DownGroup = (typeof downtimeFields)[number]['value']
const downTotal = () => ({ seconds: 0, coin: 0, theo: 0 })
function addDown(total: ReturnType<typeof downTotal>, row: (typeof data.downtime)[number]) {
  total.seconds += row.seconds
  total.coin += row.coin
  total.theo += row.theo
}

export function FloorView({ range, scope, setScope, tag, setTag }: {
  range: DateRange; scope: FloorScope; setScope: (scope: FloorScope) => void; tag: string; setTag: (tag: string) => void
}) {
  const [downGroup, setDownGroup] = useState<DownGroup>('shift')
  const [closureMeasure, setClosureMeasure] = useState('rate')
  const [demandMeasure, setDemandMeasure] = useState('coin')
  const [showTraffic, setShowTraffic] = useState(false)
  const [dossier, setDossier] = useState<{ index: number; total: FloorTotal; open: boolean } | null>(null)
  const dossierTrigger = useRef<HTMLButtonElement | null>(null)
  const dated = useMemo(() => floor.filter(row => inRange(data.dates[row[0]], range)), [range])
  const scoped = useMemo(() => dated.filter(row => floorMatches(row, scope)), [dated, scope])
  const total = useMemo(() => sumFloor(scoped), [scoped])
  const daily = useMemo(() => {
    const byDate = group(scoped, row => data.dates[row[0]], floorTotal, addFloor)
    return data.dates.filter(day => inRange(day, range)).map(date => {
      const sum = byDate.get(date)
      return {
        date, coin: sum ? coin(sum) : null, win: sum ? houseWin(sum) : null, theo: sum ? theo(sum) : null,
        hold: sum ? hold(sum) : null, availability: sum ? availability(sum) : null,
      }
    })
  }, [scoped, range])
  const zoneRates = useMemo(() => new Map([...group(dated, row => row[2], floorTotal, addFloor)]
    .map(([i, totals]) => [String(i), hourly(totals)])), [dated])
  const selectZone = (zone: string) => setScope({ zone, bank: all, machine: all })
  const zoneRows = dated.filter(row => matches(row[2], scope.zone))
  const bankIds = new Set(zoneRows.map(row => row[3]))
  const machineIds = new Set(zoneRows.filter(row => matches(row[3], scope.bank)).map(row => row[1]))
  const banks = data.banks.flatMap((label, i) => bankIds.has(i) || scope.bank === String(i) ? [{ value: String(i), label }] : [])
  const machines = data.machine.flatMap((row, i) => machineIds.has(i) || scope.machine === String(i) ?
    [{ value: String(i), label: row.machine_id }] : [])
  const ranking = [...group(scoped, row => row[1], floorTotal, addFloor)]
    .map(([id, total]) => ({ index: id, machine: data.machine[id], total }))
    .filter(row => matchesTag(row.machine, tag)).sort((a, b) => a.machine.gm_rank - b.machine.gm_rank)
  const zoneId = scope.zone === all ? all : data.zones[Number(scope.zone)].zone_id
  const bankId = scope.bank === all ? all : data.banks[Number(scope.bank)]
  const machineId = scope.machine === all ? all : data.machine[Number(scope.machine)].machine_id
  const scopeLabel = [
    zoneId === all ? '' : data.zones[Number(scope.zone)].zone_name,
    bankId === all ? '' : bankId,
    machineId === all ? '' : machineId,
  ].filter(Boolean).join(' / ') || 'Property-wide view'
  const down = data.downtime.filter(row => inRange(row.gaming_date, range) && matches(row.zone_id, zoneId) &&
    matches(row.bank_id, bankId) && matches(row.machine_id, machineId))
  const downSum = downTotal()
  down.forEach(row => addDown(downSum, row))
  const breakdown = [...group(down, row => String(row[downGroup] ?? 'Unknown'), downTotal, addDown)]
    .map(([name, values]) => ({ name: name.replaceAll('_', ' '), ...values }))
    .sort((a, b) => downGroup === 'shift' ? shifts.indexOf(a.name) - shifts.indexOf(b.name) : b.theo - a.theo)
  const traffic = data.zoneDaily.filter(row => inRange(row.gaming_date, range) && matches(row.zone_id, zoneId))
  const entries = traffic.reduce((sum, row) => sum + (row.observed_entries ?? 0), 0)
  const validHours = traffic.reduce((sum, row) => sum + row.valid_counter_hours, 0)
  const sensorHours = traffic.reduce((sum, row) => sum + row.reported_counter_slots, 0)
  const trafficChart = [...group(traffic, row => row.gaming_date, () => ({ entries: 0, hours: 0 }), (sum, row) => {
    sum.entries += row.observed_entries ?? 0
    sum.hours += row.valid_counter_hours
  })].map(([date, row]) => ({ date, rate: ratio(row.entries, row.hours) }))
  const events = data.q2_evidence.events.filter(row => row.start_date <= range.end && row.end_date >= range.start)
  const dayCounts = new Map<string, number>()
  data.dates.filter(day => inRange(day, range)).forEach(day => {
    const month = day.slice(0, 7)
    dayCounts.set(month, (dayCounts.get(month) ?? 0) + 1)
  })
  const monthly = group(scoped, row => data.dates[row[0]].slice(0, 7), floorTotal, addFloor)
  const demandName = demandMeasures.find(measure => measure.value === demandMeasure)?.label ?? 'Coin-in'
  const fractional = demandMeasure === 'hold' || demandMeasure === 'availability'
  const demandColor = fractional ? palette.sage : palette.gold

  return <>
    <Section index="01 / Floor operations" title="Floor & Operations"
      description={scopeLabel}
      extra={<span className="micro-label font-mono">{range.start} → {range.end}</span>} />
    <FloorTicker total={total} rows={scoped} dates={daily.map(row => row.date)} />
    <div className="dashboard-grid operations-grid">
      <Panel title="Floor blueprint" description="Coin-in per available hour · Select a room to scope floor operations." className="blueprint-panel">
        <FloorBlueprint rates={zoneRates} range={range} selected={scope.zone} select={selectZone} />
      </Panel>
      <Panel title="Daily floor performance" description="Selected dates and floor scope. Hover a gaming date for detail."
        action={<Filter label="Floor measure" value={demandMeasure} change={setDemandMeasure} options={demandMeasures} />}>
        <ChartFrame label="Daily floor metrics" height={302}>
          <AreaChart data={daily}>
            <defs><linearGradient id="floorFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={demandColor} stopOpacity={0.32} /><stop offset="100%" stopColor={demandColor} stopOpacity={0.05} /></linearGradient></defs>
            {chartGrid}{dateAxis(shortDate)}{valueAxis(fractional ? percent : shortUsd)}
            {chartTooltip(fractional ? percent : usd, date => eventByDate.get(date) ? shortDate(date) + ' · ' + eventByDate.get(date) : shortDate(date))}
            <Area name={demandMeasure === 'win' ? 'House win' : demandName} type="linear" dataKey={demandMeasure} stroke={demandColor}
              strokeWidth={2} fill="url(#floorFill)" dot={daily.length === 1} isAnimationActive={false} />
            {demandMeasure === 'win' && <>
              <Area name="Theo" type="linear" dataKey="theo" stroke={palette.sage} strokeWidth={2} fill="none"
                dot={daily.length === 1} isAnimationActive={false} /><Legend />
            </>}
          </AreaChart>
        </ChartFrame>
      </Panel>
    </div>
    <Panel id="inspection-evidence" title="Machine Diagnostic Matrix"
      description="Select a row to open its dossier. Rankings use the full study. Row metrics use the selected dates."
      action={<Help label="Machine diagnostic method">The two-sided payout screen uses recorded wager sizes and published game variance across 310 machines. A flag warrants physical verification. Availability below 98% is the high downtime screen.</Help>}>
      <div className="filters">
        <Filter label="Zone" value={scope.zone} change={selectZone} options={zones} allLabel="All zones" />
        <Filter label="Bank" value={scope.bank} change={bank => setScope({ ...scope, bank, machine: all })} options={banks} allLabel="All banks" />
        <Filter label="Machine" value={scope.machine} change={machine => setScope({ ...scope, machine })} options={machines} allLabel="All machines" />
        <Filter label="Diagnostic tag" value={tag} change={setTag} options={tags} allLabel="All diagnostics" />
      </div>
      <div className="matrix-alert"><CircleAlert size={15} /><span><strong className="font-mono">M-1158</strong> warrants payout verification. <strong className="font-mono">M-1120</strong> is the local demand lead and had short exposure.</span></div>
      <DataTable label="Machine rankings" headings={['Machine', 'Full-study screen', 'Days', 'Available', 'House win', 'Theo', 'Hold', 'Payout z']}
        rows={ranking.map(({ machine, total }) => [
          <button type="button" key="machine" className="matrix-machine" aria-haspopup="dialog">
            {machine.machine_id} <ArrowUpRight size={13} />
          </button>, <MachineStatus key="status" machine={machine} />,
          number(total.days), percent(availability(total)), usd(houseWin(total)), usd(theo(total)),
          percent(hold(total)), number(payoutZ(total)),
        ])} numeric={2} onInspect={(row, trigger) => {
          dossierTrigger.current = trigger
          setDossier({ index: ranking[row].index, total: ranking[row].total, open: true })
        }} />
      {dossier && <MachineDossier index={dossier.index} selected={dossier.total} open={dossier.open}
        onClose={() => setDossier(current => current && { ...current, open: false })}
        returnFocus={() => dossierTrigger.current?.focus({ preventScroll: true })} />}
      <details className="detail"><summary>Compare four recorded moves</summary>
        <DataTable label="Recorded machine moves" headings={['Machine', 'Date moved', 'Before', 'After', 'Theo/hr before', 'Theo/hr after']}
          rows={recordedMoves.map(({ before, after }) => [after.machine_id, after.first_gaming_date, before.zone_name + ' · ' + before.location_id,
            after.zone_name + ' · ' + after.location_id, usd(before.theo_per_available_hour), usd(after.theo_per_available_hour)])} numeric={4} />
      </details>
    </Panel>
    <div className="dashboard-grid">
      <Panel id="wayfinding-evidence" title="Back Forty walkway closure"
        description="Three matched 35-day windows. Closure ran March 3–April 6. The comparison uses fixed study windows."
        action={<Filter label="Closure metric" value={closureMeasure} change={setClosureMeasure}
          options={[{ value: 'rate', label: 'Coin-in / available hour' }, { value: 'coin', label: 'Total coin-in' }]} />}>
        <ChartFrame label="Back Forty before, during and after the closure" height={240}>
          <BarChart data={closure} barGap={5}>{chartGrid}{categoryAxis()}
            {valueAxis(closureMeasure === 'rate' ? usd : shortUsd)}{chartTooltip(usd)}<Legend />
            <Bar name="Back Forty" dataKey={closureMeasure === 'rate' ? 'backRate' : 'backCoin'} fill={palette.gold} radius={[4, 4, 0, 0]} maxBarSize={39} isAnimationActive={false}>
              {closure.map(phase => <Cell key={phase.name} fill={phase.name === 'During' ? palette.alert : palette.gold} />)}
            </Bar>
            <Bar name="Other zones" dataKey={closureMeasure === 'rate' ? 'otherRate' : 'otherCoin'} fill={palette.sage} radius={[4, 4, 0, 0]} maxBarSize={39} isAnimationActive={false} />
          </BarChart>
        </ChartFrame>
        <div className="insight insight-alert">Back Forty fell from <strong>$135.48</strong> to <strong>$96.25</strong> in wagers per available hour during the closure. Other zones rose.</div>
      </Panel>
      <Panel title="Demand context" description="Monthly wagers in the selected scope. Traffic uses valid sensors in the selected zones and dates.">
        <p className="muted mb-3 text-sm">{number(ratio(entries, validHours))} entries per valid sensor hour · {percent(ratio(validHours, sensorHours))} coverage.</p>
        <DataTable label="Monthly demand" headings={['Month', 'Coin-in', 'Coin-in/day', 'Coin-in/hour']}
          rows={[...dayCounts].map(([month, count]) => {
            const total = monthly.get(month) ?? floorTotal()
            return [month, usd(coin(total)), usd(ratio(coin(total), count)), usd(hourly(total))]
          })} numeric={1} />
        <p className="muted mt-3 text-xs">February led daily wagers. June was lowest. Sensor counts include repeat crossings.</p>
        <details className="detail" onToggle={event => setShowTraffic(event.currentTarget.open)}><summary>Traffic and scheduled events</summary>
          {showTraffic && <ChartFrame label="Entries per valid sensor hour" height={180}>
            <LineChart data={trafficChart}>{chartGrid}{dateAxis(shortDate)}{valueAxis(number, 50)}{chartTooltip(number)}
              <Line name="Entries / valid sensor hour" dataKey="rate" stroke={palette.sage} dot={trafficChart.length === 1} isAnimationActive={false} />
            </LineChart>
          </ChartFrame>}
          <DataTable label="Scheduled event comparisons" headings={['Event', 'Full-event lift vs matched days']}
            rows={events.map(row => [row.name, percent(row.difference)])} numeric={1} />
        </details>
      </Panel>
    </div>
    <Panel title="Downtime and forgone play"
      description="Measured outage hours and estimated lost wagers and theo from comparable healthy hours."
      action={<Filter label="Group downtime by" value={downGroup} change={value => setDownGroup(value as DownGroup)} options={downtimeFields} />}>
      <div className="metrics metrics-three">
        <Metric label="Measured downtime" value={number(downSum.seconds / 3600) + ' h'} detail="Reconciled to meter exposure" />
        <Metric label="Estimated lost coin-in" value={shortUsd(downSum.coin)} detail={usd(downSum.coin)} />
        <Metric label="Estimated lost theo" value={shortUsd(downSum.theo)} detail={usd(downSum.theo)} tone="alert" />
      </div>
      <DataTable label="Downtime breakdown" headings={['Group', 'Down hours', 'Estimated lost wagers', 'Estimated lost theo']}
        rows={breakdown.map(row => [row.name === 'swing' ? <Badge key="shift" className="badge-alert">Swing</Badge> : row.name,
          number(row.seconds / 3600), usd(row.coin), usd(row.theo)])} numeric={1} />
      <p className="muted mt-3 text-xs">Swing had the largest estimated theo loss in the full study. The estimate measures gross opportunity and can include play that shifted elsewhere.</p>
      <details className="detail"><summary>View staffing context for the full study</summary>
        <DataTable label="Staffing context" headings={['Shift', 'Technicians', 'Shifts', 'Down hours / shift', 'Estimated theo lost', 'Waiting-for-work theo']}
          rows={data.q3_evidence.staffing.map(row => [row.shift, row.techs, row.staffed_shifts, number(row.downtime_hours_per_shift),
            usd(row.lost_theo_usd), usd(row.queue_theo_usd)])} numeric={1} />
      </details>
    </Panel>
  </>
}
