import { Line, LineChart } from 'recharts'
import { Crosshair, MapPinned, Wrench } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ChartFrame, DataTable } from './dashboard-ui'
import { chartGrid, chartTooltip, dateAxis, palette, valueAxis } from './dashboard-charts'
import {
  addFloor, availability, coin, data, floor, floorTotal, group, hold, houseWin,
  number, payoutZ, percent, ratio, shortDate, sumFloor, theo, usd, type FloorTotal,
} from '@/data/dashboard'
import consoleData from '@/data/consoleData.json'

type Machine = (typeof data.machine)[number]

function recommendation(machine: Machine) {
  if (machine.payout_inspection) return 'Physical inspection ticket · Verify paytable and payout'
  if (machine.high_downtime) return 'Review recurring faults with Slot Operations'
  if (machine.weak_location) return 'Review relocation potential with a matched comparison'
  if (machine.low_local_demand || machine.short_exposure) return 'Retain on floor · Monitor exposure-adjusted demand'
  return 'Retain on floor · Monitor against theo'
}

export function MachineDossier({ index, selected, open, onClose, returnFocus }: {
  index: number; selected: FloorTotal; open: boolean; onClose: () => void; returnFocus: () => void
}) {
  const machine = data.machine[index]
  const history = data.placement.filter(row => row.machine_id === machine.machine_id)
  const zonePeers = consoleData.placementPeers.filter(row => row.machine_id === machine.machine_id)
  const faultTickets = consoleData.faults.filter(row => row.machine_id === machine.machine_id)
  const allRows = floor.filter(row => row[1] === index)
  const full = sumFloor(allRows)
  const down = data.downtime.filter(row => row.machine_id === machine.machine_id)
  const lostHandle = down.reduce((sum, row) => sum + row.coin, 0)
  const lostTheo = down.reduce((sum, row) => sum + row.theo, 0)
  const weeks = group(allRows, row => Math.floor(row[0] / 7), floorTotal, addFloor)
  const curve = data.dates.filter((_, index) => index % 7 === 0).map((date, week) => {
    const bin = weeks.get(week)
    return { date, actual: bin ? hold(bin) : null, expected: bin ? ratio(theo(bin), coin(bin)) : null }
  })
  const residual = houseWin(full) - theo(full)
  const standardDeviation = Math.sqrt(full.variance)

  return <Dialog open={open} onOpenChange={visible => { if (!visible) onClose() }}>
    <DialogContent placement="right" className="asset-dossier" onCloseAutoFocus={event => { event.preventDefault(); returnFocus() }}>
      <header className="dossier-header">
        <div className="eyebrow">Slot operations / Asset inspection dossier</div>
        <DialogTitle className="dossier-title"><span className="font-mono">{machine.machine_id}</span><span>{machine.theme}</span></DialogTitle>
        <DialogDescription>{machine.manufacturer} · Six-month asset record · {number(full.days)} active gaming days</DialogDescription>
      </header>
      <div className="dossier-body">
        <div className={machine.payout_inspection ? 'dossier-recommendation is-alert' : 'dossier-recommendation'}>
          <Crosshair size={17} /><div><span className="micro-label">Recommended action</span><strong>{recommendation(machine)}</strong></div>
        </div>
        <div className="dossier-snapshot" aria-label="Selected period snapshot">
          <div><span className="micro-label">Selected hold</span><strong>{percent(hold(selected))}</strong>
            <small>{percent(ratio(theo(selected), coin(selected)))} theoretical</small></div>
          <div><span className="micro-label">Selected payout residual</span><strong>{usd(houseWin(selected) - theo(selected))}</strong>
            <small>z = {number(payoutZ(selected))}</small></div>
          <div><span className="micro-label">Selected availability</span><strong>{percent(availability(selected))}</strong>
            <small>{number((selected.scheduled - selected.available) / 3600)} hours down</small></div>
        </div>
        <section className="dossier-section">
          <div className="dossier-section-head"><h3>Observed vs. expected hold</h3>
            <span className="micro-label font-mono">JAN–JUN 2025</span></div>
          <div className="dossier-chart-key"><span><i /> Observed</span><span><i /> Expected</span></div>
          <ChartFrame label="Six-month observed versus theoretical hold, aggregated weekly" height={188}>
            <LineChart data={curve}>{chartGrid}{dateAxis(shortDate)}{valueAxis(percent, 55)}{chartTooltip(percent)}
              <Line name="Observed hold" dataKey="actual" stroke={palette.sage} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line name="Expected hold" dataKey="expected" stroke={palette.slate} strokeWidth={1.5} strokeDasharray="2 5" dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartFrame>
          <p className="muted text-xs">Each seven-day block divides summed win or theo by summed coin-in. Gaps show time off floor.</p>
        </section>
        <section className="dossier-section">
          <div className="dossier-section-head"><h3>Diagnostic breakdown</h3><span className="micro-label">Full study</span></div>
          <dl className="dossier-breakdown">
            <div><dt><Crosshair size={15} /> Is it luck?</dt><dd><strong>{usd(residual)} ÷ {usd(standardDeviation)} = z {number(payoutZ(full))}</strong>
              <span>Actual win minus theo, divided by the payout standard deviation implied by recorded bets and game math.</span></dd></div>
            <div><dt><MapPinned size={15} /> Is it location?</dt><dd><strong>{percent(machine.zone_same_config_theo_index)} of same-game zone peers</strong>
              <span>Compare the placement-specific indices below. A dash means the placement had no matched peer benchmark.</span></dd></div>
            <div><dt><Wrench size={15} /> Is it availability?</dt><dd><strong>{usd(lostHandle)} estimated lost handle</strong>
              <span>{percent(availability(full))} available · {number((full.scheduled - full.available) / 3600)} hours down · {usd(lostTheo)} estimated lost theo.</span></dd></div>
          </dl>
        </section>
        <section className="dossier-section">
          <div className="dossier-section-head"><h3>Placement & move history</h3><span className="micro-label">{history.length} {history.length === 1 ? 'placement' : 'placements'}</span></div>
          <DataTable label="Placement history" headings={['Observed dates', 'Zone / bank', 'Slot', 'Zone peer index', 'Theo/hr']}
            rows={history.map(row => {
              const peer = zonePeers.find(peer => peer.location_id === row.location_id && peer.first_gaming_date === row.first_gaming_date)
              return [<span key="dates" className="font-mono">{row.first_gaming_date} – {row.last_gaming_date}</span>,
                <span key="bank">{row.zone_name} <span className="font-mono">{row.bank_id}</span></span>,
                <span key="slot" className="font-mono">{row.location_id}</span>, percent(peer?.zone_peer_index ?? null), usd(row.theo_per_available_hour)]
            })} numeric={3} />
        </section>
        <section className="dossier-section">
          <div className="dossier-section-head"><h3>Fault history</h3><span className="micro-label">{faultTickets.length} {faultTickets.length === 1 ? 'ticket' : 'tickets'}</span></div>
          {faultTickets.length ? <DataTable label="Fault repair tickets" headings={['Opened (Las Vegas)', 'Slot', 'Ticket', 'Elapsed hours']}
            rows={faultTickets.map(row => [<span key="date" className="font-mono">{row.opened_local}</span>,
              <span key="slot" className="font-mono">{row.location_id}</span>, <span key="ticket" className="font-mono">{row.operation_id}</span>,
              number(row.seconds === null ? null : row.seconds / 3600)])} numeric={3} /> :
            <p className="muted text-xs">No fault-repair tickets were recorded for this asset in the study.</p>}
          <p className="muted mt-2 text-xs">Ticket elapsed time runs from opening to availability. Measured downtime and estimated lost play use the meter-based outage analysis.</p>
        </section>
      </div>
    </DialogContent>
  </Dialog>
}
