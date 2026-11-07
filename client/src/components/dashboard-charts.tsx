import { CartesianGrid, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'

export const palette = { gold: 'var(--gold)', green: 'var(--green)', sage: 'var(--sage)', alert: 'var(--rust)', slate: 'var(--muted-text)' }

export const chartAxis = { fill: palette.slate, fontSize: 10, fontFamily: 'var(--font-mono)' }
export const chartGrid = <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
export function dateAxis(format: (value: string) => string) {
  return <XAxis dataKey="date" minTickGap={24} padding={{ left: 9, right: 14 }} tick={chartAxis} axisLine={false} tickLine={false} tickFormatter={format} />
}
export function categoryAxis(key = 'name') {
  return <XAxis dataKey={key} tick={chartAxis} axisLine={false} tickLine={false} minTickGap={10} />
}
export function valueAxis(format: (value: number) => string, width = 66) {
  return <YAxis tick={chartAxis} width={width} axisLine={false} tickLine={false} tickFormatter={value => format(value)} />
}
export function chartTooltip(format: (value: number) => string, describe?: (label: string) => string) {
  return <ChartTooltip
    animationDuration={80}
    animationEasing="ease-out"
    cursor={{ stroke: palette.slate, fill: 'var(--row-active)', opacity: 0.45 }}
    contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--foreground)', fontFamily: 'var(--font-mono)' }}
    labelStyle={{ color: 'var(--foreground)', fontWeight: 650 }}
    itemStyle={{ color: 'var(--foreground)' }}
    formatter={value => typeof value === 'number' ? format(value) : String(value ?? '—')}
    labelFormatter={label => describe && typeof label === 'string' ? describe(label) : label}
  />
}

