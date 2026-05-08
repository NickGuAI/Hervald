import { Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function GlobalAutomationChip({
  activeCount,
}: {
  activeCount: number
}) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      data-testid="global-automation-chip"
      onClick={() => navigate('/automations?commander=global')}
      className="flex w-full items-center justify-between gap-4 rounded-[16px] border border-ink-border/70 bg-washi-white/55 px-5 py-4 text-left transition-colors hover:bg-ink-wash/40"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-wash text-sumi-black">
          <Zap className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-base font-medium text-sumi-black">
            Global Automation · {activeCount} active
          </span>
          <span className="mt-1 block text-sm text-sumi-diluted">
            Automation page
          </span>
        </span>
      </span>
      <span className="shrink-0 text-lg text-sumi-diluted" aria-hidden="true">→</span>
    </button>
  )
}
