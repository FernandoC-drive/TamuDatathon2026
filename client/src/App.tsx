import { useEffect, useState } from 'react'
import { ArrowUpRight, ChartNoAxesCombined, Coins, LayoutGrid, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BudgetView, type Evidence } from '@/components/budget-view'
import { DateControls } from '@/components/date-controls'
import { FloorView } from '@/components/floor-view'
import { GuestView } from '@/components/guest-view'
import { ModelView } from '@/components/model-view'
import { data, fullRange, fullScope, fullSegment, inRange, number } from '@/data/dashboard'

const navigation = [
  { id: 'floor', label: 'Floor & Operations', icon: LayoutGrid },
  { id: 'guests', label: 'Guests & Comps', icon: UsersRound },
  { id: 'model', label: 'Forecast Validation', icon: ChartNoAxesCombined },
  { id: 'budget', label: 'July Action Plan', icon: Coins },
]
const plan = data.q6_budget_plan
const backForty = String(data.zones.findIndex(row => row.zone_id === 'Z-B40'))

function App() {
  const [tab, setTab] = useState('floor')
  const [range, setRange] = useState(fullRange)
  const [scope, setScope] = useState(fullScope)
  const [segment, setSegment] = useState(fullSegment)
  const [tag, setTag] = useState('gm')
  const [evidence, setEvidence] = useState<{ target: Evidence } | null>(null)
  const days = data.dates.filter(day => inRange(day, range)).length

  function openEvidence(target: Evidence) {
    setTab('floor')
    setRange(fullRange)
    if (target === 'inspection') {
      setScope({ zone: backForty, bank: String(data.banks.indexOf('B-31')),
        machine: String(data.machine.findIndex(row => row.machine_id === 'M-1158')) })
      setTag('payout')
    } else {
      setScope({ ...fullScope, zone: backForty })
      setTag('gm')
    }
    setEvidence({ target })
  }

  useEffect(() => {
    if (!evidence || tab !== 'floor') return
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(evidence.target + '-evidence')
      card?.focus({ preventScroll: true })
      card?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [evidence, tab])

  return <TooltipProvider>
    <a className="skip" href="#workspace">Skip to analysis</a>
    <header className="command">
      <div className="shell command-inner">
        <div className="command-identity">
          <div className="identity"><span className="brand-icon" aria-hidden="true">♠</span>
            <h1>The Gilded Ace<span>Floor Analytics Console</span></h1>
          </div>
          <div className="audit-meta">
            <span className="audit-status" title="Interactive audit of a fixed historical dataset"><i /> Live Audit · H1 2025</span>
            <span className="audit-days" aria-live="polite">{days} {days === 1 ? 'Day' : 'Days'} Active</span>
          </div>
        </div>
        <DateControls range={range} change={setRange} />
        <Button variant="outline" className="capital-command" onClick={() => {setTab('budget'); setEvidence(null)}}>
          <span>July Capital</span><strong>${number(plan.spent_usd)} / ${number(plan.budget_usd)}</strong>
          <span className="capital-allocated">Allocated</span><ArrowUpRight size={14} />
        </Button>
      </div>
    </header>
    <main className="shell" id="workspace">
      <Tabs value={tab} onValueChange={value => {setTab(value); setEvidence(null)}} className="workspace-tabs">
        <TabsList className="view-nav" aria-label="Dashboard views">
          {navigation.map(({id, label, icon: Icon}) =>
            <TabsTrigger key={id} value={id}><Icon size={17} /><span>{label}</span></TabsTrigger>)}
        </TabsList>
        <TabsContent value="floor"><FloorView range={range} scope={scope} setScope={setScope} tag={tag} setTag={setTag} /></TabsContent>
        <TabsContent value="guests"><GuestView range={range} segment={segment} setSegment={setSegment} /></TabsContent>
        <TabsContent value="model"><ModelView range={range} /></TabsContent>
        <TabsContent value="budget"><BudgetView openEvidence={openEvidence} /></TabsContent>
      </Tabs>
      <footer className="footer"><span>Dashboard Royale · The Gilded Ace · Synthetic release 0.9.0-draft</span>
        <span>Gaming dates run 06:00–06:00 Las Vegas time.</span></footer>
    </main>
  </TooltipProvider>
}

export default App
