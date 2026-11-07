import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { all } from '@/data/dashboard'
import { cn } from '@/lib/utils'



export function Section({ index, title, description, extra }: {
  index: string; title: string; description: string; extra?: ReactNode
}) {
  return <div className="section-heading">
    <div><div className="eyebrow">{index}</div><h2>{title}</h2><p>{description}</p></div>
    {extra}
  </div>
}

export function Panel({ title, description, children, className, id, action }: {
  title: string; description?: string; children: ReactNode; className?: string; id?: string; action?: ReactNode
}) {
  return <Card id={id} tabIndex={id ? -1 : undefined} className={cn('panel', className)}>
    <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <CardTitle className="text-[15px] font-semibold tracking-tight">{title}</CardTitle>
        {description && <CardDescription className="mt-1.5 text-[13px] leading-relaxed">{description}</CardDescription>}
      </div>
      {action}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
}

export function Metric({ label, value, detail, tone = 'normal' }: {
  label: string; value: string; detail: string; tone?: 'normal' | 'sage' | 'gold' | 'alert'
}) {
  return <Card className={cn('metric', 'metric-' + tone)}>
    <CardContent>
      <div className="metric-label"><span />{label}</div>
      <div className="metric-value">{value}</div>
      <p>{detail}</p>
    </CardContent>
  </Card>
}

export function Filter({ label, value, change, options, allLabel }: {
  label: string; value: string; change: (value: string) => void
  options: readonly { value: string; label: string }[]; allLabel?: string
}) {
  return <div className="filter">
    <span className="field-label">{label}</span>
    <Select value={value} onValueChange={change}>
      <SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={all}>{allLabel}</SelectItem>}
        {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
}

export function DataTable({ headings, rows, numeric = Infinity, label, onInspect }: {
  headings: string[]; rows: ReactNode[][]; numeric?: number; label: string
  onInspect?: (index: number, trigger: HTMLButtonElement | null) => void
}) {
  if (!rows.length) return <p className="empty">No rows match this selection.</p>
  return <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
    <Table>
      <TableHeader>{<TableRow>{headings.map((heading, i) =>
        <TableHead scope="col" key={heading} className={i >= numeric ? 'text-right' : ''}>{heading}</TableHead>)}</TableRow>}</TableHeader>
      <TableBody>{rows.map((row, i) => <TableRow key={i} data-inspectable={onInspect ? true : undefined}
        onClick={onInspect ? event => onInspect(i, event.currentTarget.querySelector('button')) : undefined}>{row.map((cell, j) =>
        <TableCell key={j} className={cn(j >= numeric && 'text-right', typeof cell === 'string' &&
          /^(?:\d{4}-\d{2}|[MBL]-\d|[+-]?\$)/.test(cell) && 'font-mono')}>{cell}</TableCell>)}</TableRow>)}</TableBody>
    </Table>
  </div>
}

export function Help({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" className="help" aria-label={label}><Info size={16} /></button>
    </TooltipTrigger>
    <TooltipContent className="max-w-64">{children}</TooltipContent>
  </Tooltip>
}

export function ChartFrame({ label, children, height = 276 }: { label: string; children: ReactNode; height?: number }) {
  return <div aria-label={label} role="group" className="chart-frame" style={{ height }}>
    <ResponsiveContainer minWidth={0} width="100%" height="100%" debounce={40}>{children}</ResponsiveContainer>
  </div>
}
