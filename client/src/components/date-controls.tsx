import { format, parseISO } from 'date-fns'
import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { closureRange, fullRange, shortDate, type DateRange } from '@/data/dashboard'

const presets = [
  { label: 'Full Period', value: fullRange },
  { label: 'Q1', value: { start: '2025-01-01', end: '2025-03-31' } },
  { label: 'Q2', value: { start: '2025-04-01', end: '2025-06-30' } },
  { label: 'Closure Window', value: closureRange },
]

export function DateControls({ range, change }: { range: DateRange; change: (range: DateRange) => void }) {
  const [first, last] = [parseISO(fullRange.start), parseISO(fullRange.end)]
  function setDate(field: keyof DateRange, value: string) {
    if (!value) return
    const day = value < fullRange.start ? fullRange.start : value > fullRange.end ? fullRange.end : value
    if (field === 'start') change({ start: day, end: day > range.end ? day : range.end })
    else change({ start: day < range.start ? day : range.start, end: day })
  }
  return <div className="command-dates">
    <div className="presets" aria-label="Date presets">
      {presets.map(({ label, value }) => <Button key={label} size="sm" variant="ghost"
        aria-pressed={range.start === value.start && range.end === value.end}
        title={label === 'Closure Window' ? 'Mar 3 – Apr 6, 2025' : undefined}
        onClick={() => change(value)}>{label}</Button>)}
    </div>
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="icon-sm" aria-label="Choose custom date range" className="date-trigger"
        title={shortDate(range.start) + ' – ' + shortDate(range.end) + ', 2025'}>
        <CalendarDays size={15} />
      </Button></PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-1.5rem))] p-4" align="end">
        <p className="mb-3 text-sm font-semibold">Custom date range</p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="field-label">Start date<Input type="date" min={fullRange.start} max={fullRange.end}
            value={range.start} onChange={event => setDate('start', event.target.value)} /></label>
          <label className="field-label">End date<Input type="date" min={fullRange.start} max={fullRange.end}
            value={range.end} onChange={event => setDate('end', event.target.value)} /></label>
        </div>
        <Calendar mode="range" defaultMonth={parseISO(range.start)} startMonth={first} endMonth={last}
          selected={{ from: parseISO(range.start), to: parseISO(range.end) }}
          disabled={{ before: first, after: last }}
          onSelect={selection => {
            if (selection?.from) change({ start: format(selection.from, 'yyyy-MM-dd'),
              end: format(selection.to ?? selection.from, 'yyyy-MM-dd') })
          }}
          className="mx-auto" />
      </PopoverContent>
    </Popover>
  </div>
}
