import { useMemo } from 'react'
import { Fingerprint, UsersRound } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, Legend, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { ChartFrame, DataTable, Filter, Metric, Panel, Section } from './dashboard-ui'
import { categoryAxis, chartAxis, chartGrid, chartTooltip, dateAxis, palette, valueAxis } from './dashboard-charts'
import {
  concentration, data, group, inRange, matches, number, percent,
  ratio, segmentMatches, shortDate, shortUsd, usd, type DateRange, type Segment,
} from '@/data/dashboard'

const options = (index: number) => [...new Set(data.guestSegments.map(row => row[index]))].sort()
  .map(value => ({ value, label: value }))
const tierOptions = options(0), ageOptions = options(1), regionOptions = options(2)
const guestTotal = () => ({ coin: 0, payout: 0, win: 0, theo: 0, segments: 0 })
function addGuest(sum: ReturnType<typeof guestTotal>, row: (typeof data.guests)[number]) {
  sum.coin += row.coin
  sum.payout += row.payout
  sum.win += row.win
  sum.theo += row.theo
  sum.segments += row.segments
}
const compTotal = () => ({ cost: 0, theo: 0, coin: 0, earned: 0, spent: 0, redemptions: 0 })
function addComp(sum: ReturnType<typeof compTotal>, row: (typeof data.comps)[number]) {
  sum.cost += row.comp_cost_usd
  sum.theo += row.carded_theo_usd
  sum.coin += row.carded_coin_in_usd
  sum.earned += row.points_earned
  sum.spent += row.points_redeemed
  sum.redemptions += row.redemptions
}
const tierColors = [palette.slate, palette.gold, palette.sage]
const tierHistory = new Map(data.compTiers.map(row => [row.gaming_date + row.tier, row]))
const policyDate = '2025-05-01'
const percentAxis = (value: number) => percent(value, 0)

export function GuestView({ range, segment, setSegment }: {
  range: DateRange; segment: Segment; setSegment: (segment: Segment) => void
}) {
  const dates = data.dates.filter(day => inRange(day, range))
  const rows = data.guests.filter(row => inRange(row.gaming_date, range) &&
    segmentMatches(row.tier, row.age_band, row.home_region, segment))
  const { start, end } = range
  const { tier, age, region } = segment
  const cohort = useMemo(() => concentration({ start, end }, { tier, age, region }), [start, end, tier, age, region])
  const total = guestTotal()
  rows.forEach(row => addGuest(total, row))
  const daily = group(rows, row => row.gaming_date, guestTotal, addGuest)
  const dailyChart = dates.map(date => ({ date, ...daily.get(date) }))
  const carded = guestTotal(), uncarded = guestTotal()
  for (const row of data.carded.filter(row => inRange(row.gaming_date, range))) {
    for (const field of ['coin', 'payout', 'win', 'theo'] as const) {
      carded[field] += row[field]
      uncarded[field] += row[`all_${field}`] - row[field]
    }
  }
  const comps = data.comps.filter(row => inRange(row.gaming_date, range))
  const comp = compTotal()
  comps.forEach(row => addComp(comp, row))
  const monthly = [...group(comps, row => row.gaming_date.slice(0, 7), compTotal, addComp)]
    .map(([name, row]) => ({ name, ...row, reinvestment: ratio(row.cost, row.theo) }))
  const tiers = tierOptions.filter(tier => matches(tier.value, segment.tier))
  const pricing = dates.map(date => ({
    date,
    ...Object.fromEntries(tiers.map(({ value }) => {
      const row = tierHistory.get(date + value)
      return [value, row ? ratio(row.points_spent, row.face_usd) : null]
    })),
  }))
  return <>
    <Section index="02 / Guest economics" title="Guest economics & comps"
      description="Measure tracked wagering concentration and the cost of loyalty, down to the selected segment."
      extra={<Badge className="badge-neutral"><UsersRound size={14} /> Q4–Q5</Badge>} />
    <div className="filters standalone-filters">
      <Filter label="Opening tier" value={segment.tier} change={tier => setSegment({ ...segment, tier })}
        options={tierOptions} allLabel="All tiers" />
      <Filter label="Age bracket" value={segment.age} change={age => setSegment({ ...segment, age })}
        options={ageOptions} allLabel="All ages" />
      <Filter label="Home region" value={segment.region} change={region => setSegment({ ...segment, region })}
        options={regionOptions} allLabel="All regions" />
    </div>
    <div className="metrics metrics-four">
      <Metric label="Carded wagers" value={shortUsd(total.coin)} detail={usd(total.coin) + ' wagered'} tone="gold" />
      <Metric label="Payouts" value={shortUsd(total.payout)} detail={usd(total.payout) + ' paid out'} />
      <Metric label="Net house win" value={shortUsd(total.win)} detail={usd(total.win) + ' net guest loss'} />
      <Metric label="Wager Gini" value={cohort.wagerGini?.toFixed(3) ?? '—'} detail={number(cohort.count) + ' wagering cardholders'} tone="gold" />
    </div>
    <div className="dashboard-grid wide-left">
      <Panel title="Lorenz curve" description="Selected segment and dates. House win curve uses positive net guest losses.">
        <ChartFrame label="Wager and positive house-win concentration">
          <AreaChart data={cohort.curve}>
            {chartGrid}
            <XAxis dataKey="population" type="number" domain={[0, 1]} tickFormatter={percentAxis} axisLine={false} tickLine={false} tick={chartAxis} />
            <YAxis domain={[0, 1]} tickFormatter={percentAxis} width={48} axisLine={false} tickLine={false} tick={chartAxis} />
            {chartTooltip(percentAxis)}<Legend />
            <Area name="Equality" dataKey="equality" stroke={palette.slate} strokeDasharray="2 5" fill="none" isAnimationActive={false} />
            <Area name="Positive house win" dataKey="losses" stroke={palette.sage} strokeWidth={2} fill={palette.sage} fillOpacity={0.14} isAnimationActive={false} />
            <Area name="Carded wagers" dataKey="wagers" stroke={palette.gold} strokeWidth={2} fill={palette.gold} fillOpacity={0.12} isAnimationActive={false} />
          </AreaChart>
        </ChartFrame>
      </Panel>
      <Panel title="Who drives the totals?" description="Cohorts rank separately by wagers and signed net house win.">
        <DataTable label="Top carded guest shares" headings={['Top', 'Guests', 'Wagers', 'Net house win']}
          rows={cohort.shares.map(row => [percent(row.cutoff, 0), number(row.players), percent(row.wagers), percent(row.win)])} numeric={1} />
        <div className="insight"><Fingerprint size={17} /><span>Positive-loss Gini <strong>{cohort.lossGini?.toFixed(3) ?? '—'}</strong>. Signed win includes guest winners in the denominator.</span></div>
      </Panel>
    </div>
    <div className="dashboard-grid">
      <Panel title="Carded wager and payout trend" description="Selected guest segment by gaming date.">
        <ChartFrame label="Daily guest wagers and payouts" height={232}>
          <LineChart data={dailyChart}>{chartGrid}{dateAxis(shortDate)}{valueAxis(shortUsd)}{chartTooltip(usd)}<Legend />
            <Line name="Wagers" dataKey="coin" stroke={palette.gold} dot={dailyChart.length === 1} isAnimationActive={false} />
            <Line name="Payouts" dataKey="payout" stroke={palette.sage} dot={dailyChart.length === 1} isAnimationActive={false} />
          </LineChart>
        </ChartFrame>
      </Panel>
      <Panel title="Carded versus uncarded" description="Property-wide machine meters for the selected dates. Demographics apply to carded guests.">
        <DataTable label="Carded and uncarded totals" headings={['Play', 'Coin-in', 'Payouts', 'House win', 'Share']}
          rows={([['Carded', carded], ['Uncarded', uncarded]] as const).map(([label, row]) =>
            [label, usd(row.coin), usd(row.payout), usd(row.win), percent(ratio(row.coin, carded.coin + uncarded.coin))])} numeric={1} />
      </Panel>
    </div>
    <div className="dashboard-grid">
      <Panel title="Comp reinvestment" description="Comp cost divided by carded theo, using property totals. POS cost of goods already includes comp cost.">
        <div className="metrics metrics-two">
          <Metric label="Economic comp cost" value={shortUsd(comp.cost)} detail={usd(comp.cost)} />
          <Metric label="Share of carded theo" value={percent(ratio(comp.cost, comp.theo), 3)}
            detail={percent(ratio(comp.cost, comp.coin), 3) + ' of carded wagers'} tone="sage" />
        </div>
        <ChartFrame label="Comp reinvestment by month" height={207}>
          <BarChart data={monthly}>{chartGrid}{categoryAxis()}{valueAxis(value => percent(value, 1), 54)}{chartTooltip(value => percent(value, 3))}
            <Bar name="Comp cost / carded theo" dataKey="reinvestment" fill={palette.sage} radius={[5, 5, 0, 0]} maxBarSize={46} isAnimationActive={false} />
          </BarChart>
        </ChartFrame>
        <DataTable label="Monthly comp costs and points" headings={['Month', 'Comp cost', 'Redemptions', 'Points earned', 'Points spent']}
          rows={monthly.map(row => [row.name, usd(row.cost), number(row.redemptions), number(row.earned), number(row.spent)])} numeric={1} />
      </Panel>
      <Panel title="Redemption price changed May 1"
        description="Points spent per dollar of menu value. Tier is recorded at redemption. Age and region filters apply to guest play."
        action={<Badge className="badge-gold">May 1 policy break</Badge>}>
        <ChartFrame label="Points per menu dollar by tier and gaming date" height={246}>
          <LineChart data={pricing}>{chartGrid}{dateAxis(shortDate)}{valueAxis(number, 43)}{chartTooltip(number)}<Legend />
            {inRange(policyDate, range) && <ReferenceLine x={policyDate} stroke={palette.gold} strokeDasharray="5 5" label={{ value: 'May 1', fill: palette.gold, position: 'insideTopRight' }} />}
            {tiers.map(({ value }) => <Line key={value} name={value} dataKey={value} stroke={tierColors[tierOptions.findIndex(tier => tier.value === value)]}
              strokeWidth={2} dot={pricing.length === 1} isAnimationActive={false} />)}
          </LineChart>
        </ChartFrame>
        <DataTable label="Redemption pricing before and after May 1" headings={['Tier at redemption', 'Jan–Apr points/$', 'May–Jun points/$']}
          rows={tiers.map(({ value }) => [value, ...data.q5_evidence.pricing.filter(row => row.tier === value)
            .map(row => number(row.points_per_face_dollar))])} numeric={1} />
      </Panel>
    </div>
  </>
}
