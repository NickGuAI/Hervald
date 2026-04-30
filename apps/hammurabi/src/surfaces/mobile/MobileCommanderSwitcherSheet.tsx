import BottomSheet from '@/components/BottomSheet'
import type { PendingApproval } from '@/hooks/use-approvals'
import { AgentAvatar, StatusDot } from '@/surfaces/hervald'
import type { Commander } from '@/surfaces/hervald/SessionRow'

const ACTIVE_STATES = new Set(['active', 'connected', 'running'])

function pendingCountForCommander(approvals: PendingApproval[], commander: Commander): number {
  return approvals.filter((approval) =>
    approval.commanderId === commander.id || approval.commanderName === commander.name).length
}

interface MobileCommanderSwitcherSheetProps {
  open: boolean
  currentCommanderId: string | null
  commanders: Commander[]
  approvals: PendingApproval[]
  onSelect: (id: string) => void
  onClose: () => void
  dark?: boolean
}

export function MobileCommanderSwitcherSheet({
  open,
  currentCommanderId,
  commanders,
  approvals,
  onSelect,
  onClose,
  dark = false,
}: MobileCommanderSwitcherSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      position="top"
      maxHeight="70dvh"
      dark={dark}
    >
      <div className={dark ? 'hv-dark' : 'hv-light'}>
        <div className="border-b border-ink-border/70 px-4 pb-3 pt-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-sumi-diluted">
            switch commander · {commanders.length}
          </p>
        </div>

        <div className="max-h-[52dvh] overflow-y-auto px-3 py-3" data-testid="mobile-commander-switcher-sheet">
          <div className="space-y-2">
            {commanders.map((commander) => {
              const pendingCount = pendingCountForCommander(approvals, commander)
              const isCurrent = commander.id === currentCommanderId
              return (
                <button
                  key={commander.id}
                  type="button"
                  onClick={() => {
                    onSelect(commander.id)
                    onClose()
                  }}
                  className="flex w-full items-center gap-3 rounded-[2px_10px_2px_10px] border border-ink-border/70 px-3 py-3 text-left transition-colors hover:bg-ink-wash/50"
                  style={{
                    background: isCurrent ? 'var(--hv-ink-wash-02)' : 'transparent',
                    borderColor: isCurrent ? 'var(--hv-border-firm)' : undefined,
                  }}
                >
                  <div className="relative flex-shrink-0">
                    <AgentAvatar
                      commander={commander}
                      size={28}
                      active={ACTIVE_STATES.has(commander.status)}
                    />
                    <span className="absolute -bottom-0.5 -right-0.5">
                      <StatusDot
                        state={commander.status}
                        size={8}
                        pulse={commander.status === 'running'}
                        style={{ border: '2px solid var(--hv-bg)', borderRadius: '50%' }}
                      />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-sm text-sumi-black">{commander.name}</span>
                      {isCurrent ? (
                        <span className="text-[9px] uppercase tracking-[0.14em] text-sumi-mist">current</span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs italic text-sumi-diluted">
                      {(commander.description || 'commander').toLowerCase()}
                    </p>
                  </div>
                  {pendingCount > 0 ? (
                    <span className="rounded-[2px_6px_2px_6px] bg-accent-vermillion/10 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-accent-vermillion">
                      {pendingCount}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </BottomSheet>
  )
}
