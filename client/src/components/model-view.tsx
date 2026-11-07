import { useState } from 'react'
import { Activity, CalendarClock, CheckCircle2 } from 'lucide-react'
import { Bar, BarChart, Line, LineChart, ReferenceArea, ReferenceLine } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChartFrame, DataTable, Metric, Panel, Section } from './dashboard-ui'
import { categoryAxis, chartGrid, chartTooltip, dateAxis, palette, valueAxis } from './dashboard-charts'
import { data, inRange, number, percent, shortDate, shortUsd, usd, type DateRange } from '@/data/dashboard'

const metrics = data.model_evidence.metrics
const july = data.model_evidence.july_weekdays
const splitDate = '2025-05-01'
const lines = [
  { key: 'actual_usd', name: 'Actual coin-in', color: palette.gold, dash: undefined },
  { key: 'forecast_usd', name: 'Calendar ridge', color: palette.sage, dash: undefined },
  { key: 'weekday_baseline_usd', name: 'Day-of-week mean', color: palette.slate, dash: '6 4' },
  { key: 'constant_baseline_usd', name: 'Daily mean', color: palette.slate, dash: '2 5' },
]

export function ModelView({ range }: { range: DateRange }) {
  const [muted, setMuted] = useState<string[]>([])
  const history = data.forecast.filter(row => inRange(row.gaming_date, range)).map(row => ({ date: row.gaming_date, ...row }))
  const holdout = history.filter(row => row.date >= splitDate)
  const improvement = 1 - metrics.model.mae_usd / metrics.weekday_baseline.mae_usd
  return <>
    <Section index="03 / Forecast validation" title="Anticipate peak demand"
      description="A frozen calendar model for daily coin-in, evaluated against two baselines on unseen gaming dates."
      extra={<Badge className="badge-sage"><Activity size={14} /> 61 holdout days</Badge>} />
    <div className="metrics metrics-three">
      <Metric label="Calendar ridge MAE" value={usd(metrics.model.mae_usd)} detail={percent(improvement) + ' lower than weekday baseline'} tone="sage" />
      <Metric label="Day-of-week mean MAE" value={usd(metrics.weekday_baseline.mae_usd)} detail="Jan–Apr weekday means" />
      <Metric label="Daily mean MAE" value={usd(metrics.constant_baseline.mae_usd)} detail="Jan–Apr constant mean" />
    </div>
    <Panel title="Actuals versus forecasts" description="Jan 1–Apr 30 training fit. The shaded May 1–Jun 30 holdout was frozen before scoring."
      action={<Badge className="badge-gold">May 1 split</Badge>}>
      <div className="series-controls" aria-label="Forecast series">
        {lines.map(line => <Button key={line.key} type="button" size="sm" variant="ghost"
          aria-pressed={!muted.includes(line.key)} onClick={() =>
            setMuted(keys => keys.includes(line.key) ? keys.filter(key => key !== line.key) : [...keys, line.key])}>
          <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true">
            <path d="M0 4h18" stroke={line.color} strokeWidth={2} strokeDasharray={line.dash} />
          </svg>{line.name}
        </Button>)}
      </div>
      <ChartFrame label="Training and holdout coin-in forecasts" height={330}>
        <LineChart data={history}>{chartGrid}{dateAxis(shortDate)}{valueAxis(shortUsd)}{chartTooltip(usd)}
          {holdout.length > 0 && <ReferenceArea x1={holdout[0].date} x2={holdout[holdout.length - 1].date} fill={palette.sage} fillOpacity={0.14} />}
          {inRange(splitDate, range) && <ReferenceLine x={splitDate} stroke={palette.gold} strokeWidth={2} strokeDasharray="5 4" />}
          {lines.map(line => <Line key={line.key} name={line.name} dataKey={line.key} stroke={line.color} strokeDasharray={line.dash}
            hide={muted.includes(line.key)} strokeWidth={line.dash ? 1.5 : 2} dot={history.length === 1} isAnimationActive={false} />)}
        </LineChart>
      </ChartFrame>
      <DataTable label="May and June holdout errors" headings={['Frozen holdout', 'MAE', 'RMSE']}
        rows={[
          ['Calendar ridge', usd(metrics.model.mae_usd), usd(metrics.model.rmse_usd)],
          ['Day-of-week mean', usd(metrics.weekday_baseline.mae_usd), usd(metrics.weekday_baseline.rmse_usd)],
          ['Daily mean', usd(metrics.constant_baseline.mae_usd), usd(metrics.constant_baseline.rmse_usd)],
        ]} numeric={1} />
    </Panel>
    <div className="dashboard-grid">
      <Panel title="Operational takeaway" description="July 1–30 · Existing technician roster"
        action={<CalendarClock className="text-sage" size={20} />}>
        <p className="action-lead">Pre-stage technicians and equipment for Friday–Sunday peaks.</p>
        <p className="muted mt-2 text-sm">Projected Saturday wagers average <strong>{usd(july[0].forecast_usd_per_day)}</strong> versus
          <strong> {usd(july[july.length - 1].forecast_usd_per_day)}</strong> on Tuesdays. Use quieter weekdays for planned work when practical.</p>
        <ChartFrame label="July forecast by weekday" height={215}>
          <BarChart data={july.map(row => ({ name: row.weekday.slice(0, 3), wagers: row.forecast_usd_per_day }))}>
            {chartGrid}{categoryAxis()}{valueAxis(shortUsd)}{chartTooltip(usd)}
            <Bar name="Forecast coin-in" dataKey="wagers" fill={palette.gold} radius={[4, 4, 0, 0]} maxBarSize={46} isAnimationActive={false} />
          </BarChart>
        </ChartFrame>
      </Panel>
      <Panel title="What the model knew" description="Feature availability at forecast time.">
        <ul className="check-list">
          <li><CheckCircle2 size={17} /><span>Weekday and scheduled gaming-day duration.</span></li>
          <li><CheckCircle2 size={17} /><span>Events announced before the forecast origin and prediction date.</span></li>
          <li><CheckCircle2 size={17} /><span>Ridge penalty selected on forward folds ending April 30.</span></li>
          <li><CheckCircle2 size={17} /><span>{number(data.model_evidence.training_days)} training days and {number(data.model_evidence.holdout_days)} holdout days. The May 26 Locals Appreciation Week announcement was excluded from the frozen forecast.</span></li>
        </ul>
        <div className="insight">The date control changes the timeline. Scorecards use the full May–June holdout.</div>
      </Panel>
    </div>
  </>
}
