import BottomSheet from '@/components/BottomSheet'
import type { PendingApproval } from '@/hooks/use-approvals'
import { TeamMemberRow } from '@/surfaces/hervald/TeamMemberRow'
import type { Commander, Worker } from '@/surfaces/hervald/SessionRow'

interface MobileTeamSheetProps {
  open: boolean
  commander: Commander | null
  workers: Worker[]
  approvals: PendingApproval[]
  onOpenApproval: (approvalId: string) => void
  onClose: () => void
}

export function MobileTeamSheet({
  open,
  commander,
  workers,
  approvals,
  onOpenApproval,
  onClose,
}: MobileTeamSheetProps) {
  const commanderWorkers = commander
    ? workers.filter((worker) => worker.commanderId === commander.id)
    : []
  const commanderApprovals = commander
    ? approvals.filter((approval) =>
      approval.commanderId === commander.id || approval.commanderName === commander.name)
    : []

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="80dvh" dark>
      <div className="hv-dark">
        <div className="border-b border-ink-border/70 px-4 pb-3 pt-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-sumi-diluted">
            {commander ? `${commander.name}'s team` : 'team'}
          </p>
          <h3 className="mt-2 font-display text-xl text-washi-white">
            {commanderWorkers.length} workers · {commanderApprovals.length} pend
          </h3>
        </div>

        <div className="max-h-[58dvh] overflow-y-auto px-2 py-3" data-testid="mobile-team-sheet">
          {commanderWorkers.length === 0 ? (
            <p className="px-3 py-4 text-sm text-sumi-mist">No delegated workers for this commander.</p>
          ) : (
            commanderWorkers.map((worker) => {
              const workerApprovals = commanderApprovals.filter((approval) => approval.context?.workerId === worker.id || approval.raw.workerId === worker.id)
              const latestApproval = workerApprovals[0] ?? null

              return (
                <div key={worker.id} className="py-1">
                  <TeamMemberRow
                    worker={{
                      id: worker.id,
                      name: worker.name,
                      label: worker.kind ?? 'worker',
                      kind: worker.kind ?? 'worker',
                      state: worker.state ?? 'idle',
                    }}
                    selected={false}
                    approvalCount={workerApprovals.length}
                    onClick={() => {
                      if (latestApproval) {
                        onOpenApproval(latestApproval.id)
                      }
                    }}
                  />
                </div>
              )
            })
          )}
        </div>
      </div>
    </BottomSheet>
  )
}
