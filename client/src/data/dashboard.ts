import { unzlibSync } from 'fflate'
import { format, parseISO } from 'date-fns'
import snapshot from './dashboardData.json'

export const data = snapshot
export type FloorRow = [
  day: number, machine: number, zone: number, bank: number,
  coinCents: number, winCents: number, theoTenThousandths: number,
  availableSeconds: number, scheduledSeconds: number, payoutVariance: number,
]
export const floor = snapshot.floor as FloorRow[]
export type DateRange = { start: string; end: string }
export type FloorScope = { zone: string; bank: string; machine: string }
export type Segment = { tier: string; age: string; region: string }
export const all = 'all'
export const fullRange: DateRange = { start: data.dates[0], end: data.dates[data.dates.length - 1] }
export const closureRange: DateRange = { start: '2025-03-03', end: '2025-04-06' }
export const fullScope: FloorScope = { zone: all, bank: all, machine: all }
export const fullSegment: Segment = { tier: all, age: all, region: all }
export const inRange = (date: string, range: DateRange) => date >= range.start && date <= range.end
export const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null
export const matches = (value: string | number, selected: string) => selected === all || String(value) === selected

const exact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 })
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
export const usd = (value: number | null) => value === null ? '—' : exact.format(value)
export const shortUsd = (value: number | null) => value === null ? '—' : compact.format(value)
export const number = (value: number | null) => value === null ? '—' : decimal.format(value)
export const percent = (value: number | null, digits = 2) => value === null ? '—' : (value * 100).toFixed(digits) + '%'
export const shortDate = (day: string) => format(parseISO(day), 'MMM d')

export function group<T, K, V>(rows: readonly T[], key: (row: T) => K, create: () => V, add: (sum: V, row: T) => void) {
  const groups = new Map<K, V>()
  for (const row of rows) {
    const id = key(row)
    if (!groups.has(id)) groups.set(id, create())
    add(groups.get(id)!, row)
  }
  return groups
}

export const floorTotal = () => ({ coin: 0, win: 0, theo: 0, available: 0, scheduled: 0, variance: 0, days: 0 })
export type FloorTotal = ReturnType<typeof floorTotal>
export function addFloor(total: FloorTotal, row: FloorRow) {
  total.coin += row[4]
  total.win += row[5]
  total.theo += row[6]
  total.available += row[7]
  total.scheduled += row[8]
  total.variance += row[9]
  total.days += 1
}
export function sumFloor(rows: readonly FloorRow[]) {
  const total = floorTotal()
  rows.forEach(row => addFloor(total, row))
  return total
}
export const coin = (total: FloorTotal) => total.coin / 100
export const houseWin = (total: FloorTotal) => total.win / 100
export const theo = (total: FloorTotal) => total.theo / 10000
export const hold = (total: FloorTotal) => ratio(total.win, total.coin)
export const availability = (total: FloorTotal) => ratio(total.available, total.scheduled)
export const hourly = (total: FloorTotal) => ratio(coin(total), total.available / 3600)
export const payoutZ = (total: FloorTotal) => ratio(houseWin(total) - theo(total), Math.sqrt(total.variance))

export function floorMatches(row: FloorRow, scope: FloorScope) {
  return matches(row[2], scope.zone) && matches(row[3], scope.bank) && matches(row[1], scope.machine)
}

export function segmentMatches(tier: string, age: string, region: string, segment: Segment) {
  return matches(tier, segment.tier) && matches(age, segment.age) && matches(region, segment.region)
}

type Concentration = {
  count: number
  wagerGini: number | null
  lossGini: number | null
  shares: { cutoff: number; players: number; wagers: number | null; win: number | null }[]
  curve: { population: number; equality: number; wagers: number | null; losses: number | null }[]
}

let guestBalances: DataView | undefined
const baseline = data.q4_evidence

export function concentration(range: DateRange, segment: Segment): Concentration {
  if (range.start === fullRange.start && range.end === fullRange.end &&
      segment.tier === all && segment.age === all && segment.region === all) {
    return {
      count: baseline.tracked.wagering_guests, wagerGini: baseline.gini.wager_gini,
      lossGini: baseline.gini.positive_loss_gini,
      shares: baseline.shares.map(row => ({ cutoff: row.cutoff, players: row.top_players,
        wagers: row.wager_share, win: row.net_house_win_share })),
      curve: [{ population: 0, equality: 0, wagers: 0, losses: 0 }, ...baseline.lorenz.map(row => ({
        population: row.guest_share, equality: row.guest_share,
        wagers: row.wager_share, losses: row.positive_loss_share,
      }))],
    }
  }

  if (!guestBalances) {
    const decoded = unzlibSync(Uint8Array.from(atob(data.guestDays), char => char.charCodeAt(0)))
    guestBalances = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength)
  }
  const start = data.dates.indexOf(range.start)
  const end = data.dates.indexOf(range.end)
  const included = data.guestSegments.map(([tier, age, region]) => segmentMatches(tier, age, region, segment))
  const balances = new Map<number, { coin: number; win: number }>()
  // The export packs date, segment, anonymous guest, wager cents and signed win cents.
  for (let offset = 0; offset < guestBalances.byteLength; offset += 14) {
    const day = guestBalances.getUint8(offset)
    if (day > end) break
    if (day < start || !included[guestBalances.getUint8(offset + 1)]) continue
    const guest = guestBalances.getUint32(offset + 2, true)
    const balance = balances.get(guest) ?? { coin: 0, win: 0 }
    balance.coin += guestBalances.getInt32(offset + 6, true)
    balance.win += guestBalances.getInt32(offset + 10, true)
    balances.set(guest, balance)
  }

  const count = balances.size
  const wager = [...balances.values()].map(row => row.coin).sort((a, b) => a - b)
  const win = [...balances.values()].map(row => row.win).sort((a, b) => a - b)
  const loss = win.map(value => Math.max(0, value))
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
  const wagerSum = sum(wager), winSum = sum(win), lossSum = sum(loss)
  const gini = (values: number[], total: number) =>
    ratio(values.reduce((acc, value, i) => acc + (2 * i + 1 - count) * value, 0), count * total)
  const curve: Concentration['curve'] = [{ population: 0, equality: 0, wagers: 0, losses: 0 }]
  let accumulatedWager = 0, accumulatedLoss = 0
  for (let i = 0; i < count; i++) {
    accumulatedWager += wager[i]
    accumulatedLoss += loss[i]
    if (Math.floor(i * 100 / count) < Math.floor((i + 1) * 100 / count)) {
      const population = (i + 1) / count
      curve.push({ population, equality: population, wagers: ratio(accumulatedWager, wagerSum), losses: ratio(accumulatedLoss, lossSum) })
    }
  }
  return {
    count, curve, wagerGini: gini(wager, wagerSum), lossGini: gini(loss, lossSum),
    shares: count === 0 ? [] : [1, 5, 10, 20].map(cutoff => {
      const players = Math.ceil(count * cutoff / 100)
      return { cutoff: cutoff / 100, players,
        wagers: ratio(sum(wager.slice(-players)), wagerSum), win: ratio(sum(win.slice(-players)), winSum) }
    }),
  }
}
