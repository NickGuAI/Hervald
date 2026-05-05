import type { CommanderSession } from '../hooks/useCommander'
import { AutomationPanel } from './AutomationPanel'

type CommanderCronScope =
  | {
      kind: 'commander'
      commander: CommanderSession
    }
  | {
      kind: 'global'
    }

export function CommanderCronTab({ scope }: { scope: CommanderCronScope }) {
  return <AutomationPanel scope={scope} filter="schedule" />
}
