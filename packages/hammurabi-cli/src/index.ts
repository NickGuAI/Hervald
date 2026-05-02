import { runCli as runOnboardCli } from './onboard.js'
import { runMachinesCli } from './machines.js'
import { runQuestsCli } from './quests.js'
import { runWorkersCli } from './workers.js'
import { runCommanderCli } from './commander.js'
import { runCronCli } from './cron.js'
import { runMemoryCli } from './memory.js'
import { runSessionCli } from './session.js'
import { runSentinelCli } from './sentinel.js'
import { runConversationsCli } from './conversations.js'
import {
  buildCommanderSessionName,
  isOwnedByCommander,
  workerLifecycle,
} from './session-contract.js'
import { runUpCli } from './up.js'

export async function runCli(args: readonly string[]): Promise<number> {
  const command = args[0]

  if (!command || command === 'onboard') {
    return runOnboardCli(command ? args : [])
  }
  if (command === 'machine') {
    return runMachinesCli(args.slice(1))
  }
  if (command === 'quests') {
    return runQuestsCli(args.slice(1))
  }
  if (command === 'workers') {
    return runWorkersCli(args.slice(1))
  }
  if (command === 'conversations') {
    return runConversationsCli(args.slice(1))
  }
  if (command === 'cron') {
    return runCronCli(args.slice(1))
  }
  if (command === 'commander') {
    return runCommanderCli(args.slice(1))
  }
  if (command === 'memory') {
    return runMemoryCli(args.slice(1))
  }
  if (command === 'session' || command === 'sessions') {
    return runSessionCli(args.slice(1))
  }
  if (command === 'sentinel') {
    return runSentinelCli(args.slice(1))
  }
  if (command === 'up') {
    return runUpCli(args.slice(1))
  }

  process.stdout.write('Usage:\n')
  process.stdout.write('  hammurabi onboard\n')
  process.stdout.write('  hammurabi machine <command>\n')
  process.stdout.write('  hammurabi quests <command>\n')
  process.stdout.write('  hammurabi workers <command>\n')
  process.stdout.write('  hammurabi conversations <command>\n')
  process.stdout.write('  hammurabi cron <command>\n')
  process.stdout.write('  hammurabi commander <command>\n')
  process.stdout.write('  hammurabi commander transcripts <command>\n')
  process.stdout.write('  hammurabi memory <command>\n')
  process.stdout.write('  hammurabi session <command>\n')
  process.stdout.write('  hammurabi sessions <command>\n')
  process.stdout.write('  hammurabi sentinel <command>\n')
  process.stdout.write('  hammurabi up [--dev] [--port <port>]\n')
  return 1
}

export { runUpCli } from './up.js'
export { runMachinesCli } from './machines.js'
export { runQuestsCli } from './quests.js'
export { runWorkersCli } from './workers.js'
export { runConversationsCli } from './conversations.js'
export { runCommanderCli } from './commander.js'
export { runCronCli } from './cron.js'
export { runMemoryCli } from './memory.js'
export { runSessionCli } from './session.js'
export { runSentinelCli } from './sentinel.js'
export { runTranscriptsCli } from './transcripts.js'
export { buildCommanderSessionName, isOwnedByCommander, workerLifecycle }
