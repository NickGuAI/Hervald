import { useTelemetrySummary } from '@/hooks/use-telemetry'
import { cn } from '@/lib/utils'

export interface TelemetryPreviewCardProps {
  window?: '24h' | '7d'
  className?: string
}

export default function TelemetryPreviewCard({
  window: metricWindow = '24h',
  className,
}: TelemetryPreviewCardProps) {
  useTelemetrySummary()

  // The current summary payload does not expose these preview KPIs yet.
  // Keep the card honest with placeholders instead of fabricating values.
  const rows = [
    { label: 'tool calls', value: null },
    { label: 'avg latency', value: null },
    { label: 'approvals shown', value: null },
    { label: 'sentinels fired', value: null },
    { label: 'cron runs', value: null },
    { label: 'errors', value: null },
  ]

  return (
    <section className={cn('space-y-2.5', className)}>
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-sumi-diluted">
        telemetry · last {metricWindow}
      </div>
      <div
        className="border border-ink-border/70 bg-washi-white px-4 py-3"
        style={{ borderRadius: '3px 14px 3px 14px' }}
      >
        {rows.map((row, index) => (
          <div
            key={row.label}
            className={cn(
              'flex items-center justify-between py-2 text-xs',
              index < rows.length - 1 && 'border-b border-ink-border/70',
            )}
          >
            <span className="text-[10.5px] uppercase tracking-[0.06em] text-sumi-diluted">
              {row.label}
            </span>
            <span className="font-mono text-sumi-black">{row.value ?? '—'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
