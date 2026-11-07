import { ArrowUpRight, CircleDollarSign, MapPinned, ScanSearch, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, Metric, Panel, Section } from './dashboard-ui'
import { data, number, percent, ratio, shortDate, usd } from '@/data/dashboard'

export type Evidence = 'inspection' | 'wayfinding'
const plan = data.q6_budget_plan
const scenarios = ['low', 'base', 'high'] as const
type Action = (typeof plan.actions)[number]

function Checklist({ title, items }: { title: string; items: [string, string][] }) {
  return <div className="action-checklist">
    <h3 className="micro-label">{title}</h3>
    <ul className="space-y-1.5 border-l-2 border-[#215848] py-0.5 pl-3">
      {items.map(([label, value]) => <li key={label}><strong>{label}</strong> {value}</li>)}
    </ul>
  </div>
}

function ActionBrief({ action, inspection }: { action: Action; inspection: boolean }) {
  const lead = action.lead_days + (action.lead_days === 1 ? ' lead day' : ' lead days')
  return <div className="action-brief">
    <dl className="action-pills">
      <div>
        <dt>Target</dt>
        <dd>{inspection ? 'M-1158 (Desert Gold) · Bank B-31' : 'Main Entrance approach → Back Forty corridor'}</dd>
      </div>
      <div className={inspection ? 'action-pill-alert' : 'action-pill-benchmark'}>
        <dt>{inspection ? 'Anomaly' : 'Wager-rate drop'}</dt>
        <dd>{inspection ? 'z = -4.570 · $3,047.70 June win gap' : '$135.48/hr pre-closure → $120.17/hr in June'}</dd>
      </div>
    </dl>
    <Checklist title="Rationale & terms" items={inspection ? [
      ['Cost & downtime', usd(action.cost_usd) + ' flat · ' + lead + ' · ' + number(action.downtime_minutes / 60) + ' hours of expected downtime.'],
      ['Assumptions', '0% / 50% / 80% chance of restoring the June win deficit in the low, base, and high scenarios. Deduct two hours of theo for inspection.'],
    ] : [
      ['Cost & terms', usd(action.cost_usd) + ' one-time · ' + lead + ' · ' + action.active_days + ' operating days in July.'],
      ['Assumptions', 'Recover 10% / 40% / 65% of the $15.31/hr gap. Retain 50% / 65% / 80% after displacement, then deduct the 20% share on revenue-share leases.'],
    ]} />
    <Checklist title="Measurement & verification" items={inspection ? [
      ['Protocol', 'Bench-test the configured paytable and denomination settings. Reconcile meter logs before making changes.'],
      ['30-day validation', 'Track daily hold minus configured hold and bet-weighted payout z against G-STD90 peers over ' + action.active_days + ' operating days.'],
    ] : [
      ['Protocol', 'Install signage at the Main Entrance junction to redirect foot traffic to Back Forty.'],
      ['30-day validation', 'Compare matching pre/post weekdays on entries per valid sensor hour and Back Forty wagers per available machine-hour.'],
    ]} />
    <details className="detail action-details">
      <summary>Full scenario notes</summary>
      <dl>
        <div><dt>Assumptions</dt><dd>{action.assumptions}</dd></div>
        <div><dt>Measurement</dt><dd>{action.measurement}</dd></div>
      </dl>
    </details>
  </div>
}

export function BudgetView({ openEvidence }: { openEvidence: (target: Evidence) => void }) {
  const spent = ratio(plan.spent_usd, plan.budget_usd) ?? 0
  return <>
    <Section index="04 / Capital allocation" title="July action plan"
      description="Two targeted catalog actions for July 1–30, 2025. Keep the remaining budget available."
      extra={<Badge className="badge-gold"><CircleDollarSign size={15} /> $100k cap</Badge>} />
    <Panel title="Budget utilization" description="Catalog spend as a share of the approved cap."
      action={<Badge className="badge-gold">{percent(spent, 1)} allocated</Badge>}>
      <div className="budget-meter" role="progressbar" aria-label="July budget used"
        aria-valuemin={0} aria-valuemax={plan.budget_usd} aria-valuenow={plan.spent_usd}>
        <span style={{ width: percent(spent) }} />
      </div>
      <div className="flex justify-between gap-3 pt-2 text-xs muted"><span>{usd(plan.spent_usd)} planned</span><span>{usd(plan.budget_usd)} cap</span></div>
    </Panel>
    <div className="metrics metrics-three">
      <Metric label="Planned spend" value={usd(plan.spent_usd)} detail="Two catalog action types" tone="gold" />
      <Metric label="Budget retained" value={usd(plan.retained_usd)} detail="Available for future decisions" />
      <Metric label="Base net benefit" value={usd(plan.net_base_usd)}
        detail={usd(plan.net_low_usd) + ' to ' + usd(plan.net_high_usd) + ' scenario range'} tone="sage" />
    </div>
    <div className="dashboard-grid action-grid">
      {plan.actions.map(action => {
        const inspection = action.evidence_link === 'inspection'
        const Icon = inspection ? ScanSearch : MapPinned
        return <Panel key={action.action_type_id} className={inspection ? 'action-inspect' : 'action-wayfinding'}
          title={inspection ? 'Inspect a machine and verify its payout' : 'Back Forty wayfinding and signage'}
          description={action.target} action={<Badge className={inspection ? 'badge-alert' : 'badge-gold'}><Icon size={14} /> {action.action_type_id}</Badge>}>
          <div className="action-price">{usd(action.cost_usd)}</div>
          <dl className="action-facts">
            <div><dt>Quantity / catalog limit</dt><dd>{action.quantity} / {action.quantity_limit}</dd></div>
            <div><dt>Lead / active days</dt><dd>{action.lead_days} / {action.active_days}</dd></div>
            <div><dt>First active date</dt><dd>{shortDate(action.activation_date)}</dd></div>
            <div><dt>Machine downtime</dt><dd>{action.downtime_minutes} min</dd></div>
          </dl>
          <p className="formula">{action.quantity} × ({usd(action.unit_cost_cents / 100)} + {usd(action.recurring_cost_cents_per_day / 100)} × max(0, 30 − {action.lead_days}))</p>
          <DataTable label={action.name + ' sensitivity'} headings={['Scenario', 'Operating benefit', 'Net benefit', 'ROI']}
            rows={scenarios.map(scenario => [scenario[0].toUpperCase() + scenario.slice(1),
              usd(action[`gross_${scenario}_usd`]), usd(action[`net_${scenario}_usd`]),
              percent(action[`roi_${scenario}`], 1)])} numeric={1} />
          <ActionBrief action={action} inspection={inspection} />
          <div className="action-card-footer">
            <Button variant="outline" size="sm" onClick={() => openEvidence(inspection ? 'inspection' : 'wayfinding')}>
              {inspection ? 'Open M-1158 Evidence' : 'Open Closure Evidence'} <ArrowUpRight size={13} />
            </Button>
          </div>
        </Panel>
      })}
    </div>
    <Panel title="Retain the balance and schedule existing coverage"
      description="Keep the Friday–Sunday staffing decision separate from catalog spend."
      action={<Badge className="badge-sage"><ShieldCheck size={14} /> {usd(plan.retained_usd)} retained</Badge>}>
      <p className="muted text-sm">The calendar forecast supports pre-staging existing technician coverage for peak days. Swing had the largest estimated theo opportunity, and the repair queue provides no demonstrated payback for a new technician package.</p>
    </Panel>
  </>
}
