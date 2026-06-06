import BottomSheet from '@/components/BottomSheet'
import type { PendingApproval } from '@/hooks/use-approvals'
import type { ChatSession } from '@modules/command-room/components/desktop/SessionsColumn'
import { TeamMemberRow } from '@modules/command-room/components/desktop/TeamMemberRow'
import type { Commander, Worker } from '@modules/command-room/components/desktop/SessionRow'

interface MobileTeamSheetProps {
  open: boolean
  commander: Commander | null
  workers: Worker[]
  automationSessions: ChatSession[]
  approvals: PendingApproval[]
  onOpenApproval: (approvalId: string) => void
  onClose: () => void
}

export function MobileTeamSheet({
  open,
  commander,
  workers,
  automationSessions,
  approvals,
  onOpenApproval,
  onClose,
}: MobileTeamSheetProps) {
  const commanderWorkers = commander
    ? workers.filter((worker) => worker.commanderId === commander.id)
    : []
  const commanderAutomationSessions = commander
    ? automationSessions.filter((session) => session.parentCommanderId === commander.id)
    : []
  const commanderApprovals = commander
    ? approvals.filter((approval) =>
      approval.commanderId === commander.id || approval.commanderName === commander.name)
    : []

  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="80dvh" dark>
      <div className="hv-dark">
        <div className="border-b border-[color:var(--hv-border-hair)] px-4 pb-3 pt-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[color:var(--hv-fg-subtle)]">
            {commander ? `${commander.name}'s team` : 'team'}
          </p>
          <h3 className="mt-2 font-display text-xl text-[color:var(--hv-fg-inverse)]">
            {commanderWorkers.length} workers · {commanderAutomationSessions.length} automations · {commanderApprovals.length} pend
          </h3>
        </div>

        <div className="max-h-[58dvh] overflow-y-auto px-2 py-3" data-testid="mobile-team-sheet">
          <section data-testid="mobile-team-sheet-workers">
            <p className="px-3 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[color:var(--hv-fg-subtle)]">
              Workers
            </p>
            {commanderWorkers.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[color:var(--hv-fg-faint)]">No delegated workers for this commander.</p>
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
          </section>

          <section className="mt-4" data-testid="mobile-team-sheet-automations">
            <p className="px-3 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[color:var(--hv-fg-subtle)]">
              Commander automations
            </p>
            {commanderAutomationSessions.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[color:var(--hv-fg-faint)]">No commander-local automations for this commander.</p>
            ) : (
              commanderAutomationSessions.map((session) => (
                <div
                  key={session.id}
                  data-testid="mobile-team-sheet-automation-row"
                  className="mx-3 flex items-center justify-between gap-3 border-b border-[color:var(--hv-border-hair)] py-3 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[color:var(--hv-fg-inverse)]">
                      {session.label ?? session.name}
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--hv-fg-subtle)]">
                      automation
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-[color:var(--hv-fg-faint)]">
                    {session.status ?? 'idle'}
                  </span>
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    </BottomSheet>
  )
}
