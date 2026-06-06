import { randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AuthUser } from '@gehirn/auth-providers'
import { DEFAULT_CLAUDE_EFFORT_LEVEL } from '../claude-effort.js'
import { createMachineRegistryStore } from '../agents/machines.js'
import type { ProviderAdapter } from '../agents/providers/provider-adapter.js'
import type { AutomationScheduler } from '../automations/scheduler.js'
import type { AutomationStore } from '../automations/store.js'
import { createDefaultHeartbeatConfig } from '../commanders/heartbeat.js'
import {
  readCommanderDisplayNames,
  setCommanderDisplayName,
} from '../commanders/names-lock.js'
import { createDefaultCommanderRuntimeConfig } from '../commanders/runtime-config.shared.js'
import type { Conversation, ConversationStore } from '../commanders/conversation-store.js'
import type { CommanderSession, CommanderSessionStore } from '../commanders/store.js'
import { mergeIdentityOperatingStyleIntoCommanderWorkflow } from '../commanders/templates/workflow.js'
import { ensureCommanderVisualProfile } from '../commanders/commander-visual-profile.js'
import {
  GAIA_COMMANDER_AVATAR_URL,
  readCommanderUiProfile,
  resolveCommanderAvatarUrl,
  writeCommanderUiProfile,
} from '../commanders/commander-profile.js'
import { resolveHammurabiDataDir } from '../data-dir.js'
import { createFounderBootstrapCandidate } from '../operators/founder-bootstrap.js'
import type { OperatorStore } from '../operators/store.js'
import { OrgIdentityStore } from '../org-identity/store.js'
import {
  STARTER_COMMANDER_PACKAGE_IDS,
  loadCommanderPackage,
} from '../commanders/packages/registry.js'
import type { CommanderPackageDefinition } from '../commanders/packages/types.js'
import {
  getCommanderPackageInstallState,
  installCommanderPackage,
} from '../commanders/packages/install.js'
import {
  DEFAULT_FOUNDER_ORG_SETUP_FORM_VALUES,
  FOUNDER_SETUP_COMPLETED_PATH,
  FOUNDER_SETUP_PATH,
  validateFounderOrgSetupFormValues,
  type FounderSetupStatus,
  type GaiaOnboardingStatus,
  type MachineOnboardingReadiness,
  type OnboardingReadinessState,
  type OnboardingReceipt,
  type OnboardingStatus,
  type OnboardingStep,
  type OnboardingStepId,
  type ProviderOnboardingReadiness,
  type StarterCommanderPackageStatus,
  type StarterWorkforceOnboardingStatus,
} from './contracts.js'

const execFile = promisify(execFileCallback)

const GAIA_HOST = 'gaia'
const GAIA_DISPLAY_NAME = 'Gaia'
const GAIA_TEMPLATE_ID = 'gaia-onboarding'
const GAIA_SPEAKING_TONE = 'Mother-of-all onboarding'
const ONBOARDING_STATE_FILE = 'onboarding.json'
const GAIA_IDENTITY = [
  'Gaia is the mother-of-all onboarding commander for Hervald.',
  'She helps the founder complete first-run setup, create and manage commanders,',
  'configure providers and machines, and keep onboarding decisions routed through backend APIs.',
].join(' ')

export interface ShellCommandResult {
  ok: boolean
  stdout: string
}

export type OnboardingShellRunner = (
  command: string,
  args: readonly string[],
) => Promise<ShellCommandResult>

export interface BuildOnboardingStatusOptions {
  user?: AuthUser
  operatorStore: Pick<OperatorStore, 'getFounder'>
  orgIdentityStore?: OrgIdentityStore
  sessionStore: Pick<CommanderSessionStore, 'list'>
  conversationStore?: Pick<ConversationStore, 'listByCommander' | 'getActiveChatForCommander'>
  commanderDataDir: string
  publicBaseUrl?: string
  providers: readonly ProviderAdapter[]
  env?: NodeJS.ProcessEnv
  shellRunner?: OnboardingShellRunner
}

export interface SeedGaiaOptions extends BuildOnboardingStatusOptions {
  sessionStore: Pick<CommanderSessionStore, 'list' | 'create'>
  conversationStore?: Pick<ConversationStore, 'listByCommander' | 'getActiveChatForCommander' | 'ensureDefaultConversation'>
}

export interface SeedStarterWorkforceOptions extends BuildOnboardingStatusOptions {
  sessionStore: Pick<CommanderSessionStore, 'list' | 'create' | 'delete'>
  conversationStore?: Pick<ConversationStore, 'listByCommander' | 'getActiveChatForCommander' | 'ensureDefaultConversation' | 'delete'>
  automationStore?: Pick<AutomationStore, 'create' | 'delete'>
  automationScheduler?: Pick<AutomationScheduler, 'createAutomation' | 'deleteAutomation'>
  automationSchedulerInitialized?: Promise<void>
}

interface OnboardingState {
  starterWorkforceSkipped?: boolean
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function defaultShellRunner(command: string, args: readonly string[]): Promise<ShellCommandResult> {
  try {
    const { stdout } = await execFile(command, [...args], {
      timeout: 1600,
      maxBuffer: 64 * 1024,
    })
    return { ok: true, stdout }
  } catch (error) {
    const stdout = typeof (error as { stdout?: unknown }).stdout === 'string'
      ? (error as { stdout: string }).stdout
      : ''
    return { ok: false, stdout }
  }
}

function localMachineEnvFile(env: NodeJS.ProcessEnv): string {
  const configured = env.HAMMURABI_LOCAL_MACHINE_ENV_FILE?.trim()
  return configured || path.join(homedir(), '.hammurabi-env')
}

function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const eq = normalized.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = normalized.slice(0, eq).trim()
    let value = normalized.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

async function readLocalEnvValues(env: NodeJS.ProcessEnv): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(localMachineEnvFile(env), 'utf8'))
  } catch {
    return {}
  }
}

function onboardingStatePath(commanderDataDir: string): string {
  return path.join(commanderDataDir, ONBOARDING_STATE_FILE)
}

async function readOnboardingState(commanderDataDir: string): Promise<OnboardingState> {
  try {
    const parsed = JSON.parse(await readFile(onboardingStatePath(commanderDataDir), 'utf8')) as OnboardingState
    return {
      starterWorkforceSkipped: parsed.starterWorkforceSkipped === true,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function writeOnboardingState(
  commanderDataDir: string,
  state: OnboardingState,
): Promise<void> {
  await mkdir(commanderDataDir, { recursive: true })
  await writeFile(onboardingStatePath(commanderDataDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

async function setStarterWorkforceSkipped(
  commanderDataDir: string,
  skipped: boolean,
): Promise<void> {
  const current = await readOnboardingState(commanderDataDir)
  await writeOnboardingState(commanderDataDir, {
    ...current,
    starterWorkforceSkipped: skipped,
  })
}

async function buildFounderStatus(
  options: Pick<BuildOnboardingStatusOptions, 'user' | 'operatorStore' | 'orgIdentityStore'>,
): Promise<FounderSetupStatus> {
  const orgIdentityStore = options.orgIdentityStore ?? new OrgIdentityStore()
  const founder = await options.operatorStore.getFounder()
  const orgIdentity = founder ? await orgIdentityStore.get() : null
  const bootstrapCandidate = founder ? null : createFounderBootstrapCandidate(options.user)
  const defaultValues = founder
    ? {
        orgDisplayName: orgIdentity?.name ?? '',
        founderDisplayName: founder.displayName,
        founderEmail: founder.email ?? '',
      }
    : {
        ...DEFAULT_FOUNDER_ORG_SETUP_FORM_VALUES,
        founderDisplayName: bootstrapCandidate?.displayName ?? '',
        founderEmail: bootstrapCandidate?.email ?? '',
      }

  return {
    setupComplete: Boolean(founder),
    defaultValues,
    validationErrors: validateFounderOrgSetupFormValues(defaultValues),
    nextRoute: founder ? FOUNDER_SETUP_COMPLETED_PATH : FOUNDER_SETUP_PATH,
  }
}

async function getConversationId(
  conversationStore: BuildOnboardingStatusOptions['conversationStore'],
  commanderId: string,
): Promise<string | null> {
  if (!conversationStore) {
    return null
  }
  if (typeof conversationStore.getActiveChatForCommander === 'function') {
    const active = await conversationStore.getActiveChatForCommander(commanderId)
    if (active?.id) {
      return active.id
    }
  }
  const conversations = await conversationStore.listByCommander(commanderId)
  const selected = conversations
    .filter((conversation) => conversation.id && conversation.surface === 'ui')
    .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))[0]
  return selected?.id ?? null
}

async function buildGaiaStatus(
  options: Pick<BuildOnboardingStatusOptions, 'sessionStore' | 'conversationStore' | 'commanderDataDir' | 'providers'>,
  providers: readonly ProviderOnboardingReadiness[],
): Promise<GaiaOnboardingStatus> {
  const [sessions, displayNames] = await Promise.all([
    options.sessionStore.list(),
    readCommanderDisplayNames(options.commanderDataDir),
  ])
  const gaia = sessions
    .filter((session) => session.archived !== true)
    .find((session) => (
      session.host === GAIA_HOST ||
      displayNames[session.id]?.trim().toLowerCase() === GAIA_DISPLAY_NAME.toLowerCase()
    ))
  const defaultProviderId = gaia?.agentType
    ?? providers.find((provider) => provider.state === 'ready')?.id
    ?? options.providers[0]?.id
    ?? null

  return {
    commanderId: gaia?.id ?? null,
    displayName: GAIA_DISPLAY_NAME,
    avatarUrl: gaia
      ? await resolveCommanderAvatarUrl(
        gaia.id,
        options.commanderDataDir,
        await readCommanderUiProfile(gaia.id, options.commanderDataDir),
        { defaultAvatarUrl: GAIA_COMMANDER_AVATAR_URL },
      )
      : GAIA_COMMANDER_AVATAR_URL,
    exists: Boolean(gaia),
    conversationId: gaia ? await getConversationId(options.conversationStore, gaia.id) : null,
    defaultProviderId,
  }
}

async function buildStarterWorkforceStatus(
  options: Pick<BuildOnboardingStatusOptions, 'sessionStore' | 'commanderDataDir'>,
): Promise<StarterWorkforceOnboardingStatus> {
  const [packages, onboardingState] = await Promise.all([
    Promise.all(
      STARTER_COMMANDER_PACKAGE_IDS.map(async (packageId): Promise<StarterCommanderPackageStatus | null> => {
        const definition = await loadCommanderPackage(packageId)
        if (!definition) {
          return null
        }
        const installState = await getCommanderPackageInstallState(definition, {
          sessionStore: options.sessionStore,
          commanderDataDir: options.commanderDataDir,
        })
        return {
          packageId: definition.id,
          displayName: definition.displayName,
          role: definition.role,
          summary: definition.summary,
          installed: installState.installed,
          commanderId: installState.commanderId,
        }
      }),
    ),
    readOnboardingState(options.commanderDataDir),
  ])
  const visiblePackages = packages.filter((entry): entry is StarterCommanderPackageStatus => Boolean(entry))
  const installedCount = visiblePackages.filter((entry) => entry.installed).length
  const installedComplete = visiblePackages.length > 0 && installedCount === visiblePackages.length
  const skipped = !installedComplete && onboardingState.starterWorkforceSkipped === true

  return {
    packages: visiblePackages,
    installedCount,
    totalCount: visiblePackages.length,
    skipped,
    complete: installedComplete || skipped,
  }
}

async function probeProvider(
  provider: ProviderAdapter,
  env: NodeJS.ProcessEnv,
  fileEnv: Record<string, string>,
  shellRunner: OnboardingShellRunner,
): Promise<ProviderOnboardingReadiness> {
  const machineAuth = provider.machineAuth
  if (!machineAuth) {
    return {
      id: provider.id,
      label: provider.label,
      cliBinaryName: null,
      installed: null,
      authConfigured: true,
      authMode: 'not-required',
      state: 'ready',
      shortAction: 'No local CLI authentication required.',
      verificationCommand: null,
      envSourceKey: null,
    }
  }

  const cliBinaryName = machineAuth.cliBinaryName
  const installed = (await shellRunner('sh', ['-lc', `command -v ${quoteShell(cliBinaryName)}`])).ok
  const envSourceKey = machineAuth.authEnvKeys.find((key) => (
    Boolean(env[key]?.trim()) || Boolean(fileEnv[key]?.trim())
  )) ?? null
  let loginConfigured = false
  if (machineAuth.loginStatusCommand) {
    loginConfigured = (await shellRunner('sh', ['-lc', machineAuth.loginStatusCommand])).ok
  }

  const authConfigured = Boolean(envSourceKey || loginConfigured)
  const state: OnboardingReadinessState = !installed
    ? 'missing'
    : authConfigured
      ? 'ready'
      : 'warning'
  const authMode = envSourceKey
    ? 'env'
    : loginConfigured
      ? 'login'
      : 'missing'
  const installTarget = machineAuth.installPackageName ?? cliBinaryName
  const shortAction = !installed
    ? `Install ${installTarget}.`
    : authConfigured
      ? 'Ready for local machine execution.'
      : machineAuth.supportedAuthModes.includes('device-auth')
        ? `Run ${cliBinaryName} login and return here.`
        : `Configure ${machineAuth.authEnvKeys[0] ?? `${cliBinaryName.toUpperCase()} auth`}.`

  return {
    id: provider.id,
    label: provider.label,
    cliBinaryName,
    installed,
    authConfigured,
    authMode,
    state,
    shortAction,
    verificationCommand: machineAuth.loginStatusCommand ?? `${cliBinaryName} --version`,
    envSourceKey,
  }
}

async function buildProviderReadiness(
  options: Pick<BuildOnboardingStatusOptions, 'providers' | 'env' | 'shellRunner'>,
): Promise<ProviderOnboardingReadiness[]> {
  const env = options.env ?? process.env
  const fileEnv = await readLocalEnvValues(env)
  const shellRunner = options.shellRunner ?? defaultShellRunner
  return Promise.all(options.providers.map((provider) => probeProvider(provider, env, fileEnv, shellRunner)))
}

async function buildMachineReadiness(
  env: NodeJS.ProcessEnv,
): Promise<MachineOnboardingReadiness[]> {
  const registry = createMachineRegistryStore(path.join(resolveHammurabiDataDir(env), 'machines.json'))
  const machines = await registry.readMachineRegistry()
  const defaultEnvFile = localMachineEnvFile(env)

  return machines.map((machine): MachineOnboardingReadiness => {
    const isLocal = machine.id === 'local' || !machine.host
    const isDaemon = Boolean(machine.daemon)
    const state: OnboardingReadinessState = isLocal || machine.daemon?.lastSeenAt
      ? 'ready'
      : isDaemon
        ? 'warning'
        : 'ready'
    return {
      id: machine.id,
      label: machine.label,
      transport: isLocal ? 'local' : isDaemon ? 'daemon' : 'ssh',
      state,
      envFile: machine.envFile ?? (isLocal ? defaultEnvFile : null),
      cwd: machine.cwd ?? null,
      summary: isLocal
        ? 'This server can run provider CLIs directly.'
        : isDaemon
          ? (machine.daemon?.lastSeenAt ? 'Daemon paired and recently seen.' : 'Daemon pairing exists but is not connected.')
          : 'Remote SSH machine is registered.',
    }
  })
}

function buildSteps(args: {
  founderSetup: FounderSetupStatus
  gaia: GaiaOnboardingStatus
  starterWorkforce: StarterWorkforceOnboardingStatus
  providers: readonly ProviderOnboardingReadiness[]
  machines: readonly MachineOnboardingReadiness[]
}): { currentStepId: OnboardingStepId; steps: OnboardingStep[] } {
  const hasProviderReady = args.providers.length === 0 || args.providers.some((provider) => provider.state === 'ready')
  const hasMachineReady = args.machines.some((machine) => machine.state === 'ready')
  const currentStepId: OnboardingStepId = !args.founderSetup.setupComplete
    ? 'founder-org'
    : !args.gaia.exists
      ? 'gaia'
      : !args.starterWorkforce.complete
        ? 'starter-workforce'
        : (!hasProviderReady || !hasMachineReady)
          ? 'providers-machines'
          : 'launch'

  const stateFor = (id: OnboardingStepId): OnboardingStep['state'] => {
    if (id === currentStepId) return 'current'
    if (id === 'instance') return 'complete'
    if (id === 'founder-org') return args.founderSetup.setupComplete ? 'complete' : 'pending'
    if (id === 'gaia') return args.gaia.exists ? 'complete' : 'pending'
    if (id === 'starter-workforce') {
      if (args.starterWorkforce.complete) return 'complete'
      return args.gaia.exists ? 'current' : 'pending'
    }
    if (id === 'providers-machines') {
      if (hasProviderReady && hasMachineReady) return 'complete'
      return args.starterWorkforce.complete ? 'warning' : 'pending'
    }
    return currentStepId === 'launch' ? 'current' : 'pending'
  }

  const steps: OnboardingStep[] = [
    { id: 'instance', label: 'Instance ready', state: stateFor('instance'), summary: 'Local Hervald app and bootstrap admin are available.' },
    { id: 'founder-org', label: 'Founder + organization', state: stateFor('founder-org'), summary: args.founderSetup.setupComplete ? 'Founder profile and organization exist.' : 'Create the first local operator and org identity.' },
    { id: 'gaia', label: 'Gaia commander', state: stateFor('gaia'), summary: args.gaia.exists ? 'Gaia is ready to guide onboarding.' : 'Seed Gaia as the default onboarding commander.' },
    { id: 'starter-workforce', label: 'Starter workforce', state: stateFor('starter-workforce'), summary: args.starterWorkforce.skipped ? 'Starter commanders were skipped for this install.' : args.starterWorkforce.complete ? 'Starter commanders are installed.' : 'Install the bundled engineering, research, and assistant commanders.' },
    { id: 'providers-machines', label: 'Providers + machines', state: stateFor('providers-machines'), summary: hasProviderReady && hasMachineReady ? 'At least one provider and machine are ready.' : 'Review provider CLI/auth and machine readiness.' },
    { id: 'launch', label: 'Launch', state: stateFor('launch'), summary: 'Open the org page or command room.' },
  ]

  return { currentStepId, steps }
}

function buildReceipt(args: {
  founderSetup: FounderSetupStatus
  gaia: GaiaOnboardingStatus
  providers: readonly ProviderOnboardingReadiness[]
  machines: readonly MachineOnboardingReadiness[]
  publicBaseUrl?: string
}): OnboardingReceipt {
  const readyProviders = args.providers.filter((provider) => provider.state === 'ready').map((provider) => provider.label)
  const pendingProviders = args.providers.filter((provider) => provider.state !== 'ready').map((provider) => provider.label)
  const providerSummary = [
    readyProviders.length > 0 ? `${readyProviders.join(', ')} ready` : 'No provider ready',
    pendingProviders.length > 0 ? `${pendingProviders.join(', ')} follow-up` : null,
  ].filter(Boolean).join(' · ')

  return {
    url: buildReceiptUrl(args.publicBaseUrl),
    account: 'local bootstrap admin',
    organization: args.founderSetup.defaultValues.orgDisplayName || null,
    founder: args.founderSetup.defaultValues.founderDisplayName || null,
    commander: args.gaia.exists ? args.gaia.displayName : null,
    machine: args.machines.find((machine) => machine.state === 'ready')?.label ?? null,
    providerSummary,
  }
}

function buildReceiptUrl(publicBaseUrl: string | undefined): string {
  const fallbackPort = process.env.PORT?.trim() || '20001'
  const fallbackBaseUrl = `http://localhost:${fallbackPort}`
  const baseUrl = publicBaseUrl?.trim() || fallbackBaseUrl

  try {
    return new URL(FOUNDER_SETUP_COMPLETED_PATH, baseUrl).toString()
  } catch {
    return new URL(FOUNDER_SETUP_COMPLETED_PATH, fallbackBaseUrl).toString()
  }
}

export async function buildOnboardingStatus(
  options: BuildOnboardingStatusOptions,
): Promise<OnboardingStatus> {
  const providers = await buildProviderReadiness(options)
  const [founderSetup, machines] = await Promise.all([
    buildFounderStatus(options),
    buildMachineReadiness(options.env ?? process.env),
  ])
  const gaia = await buildGaiaStatus(options, providers)
  const starterWorkforce = await buildStarterWorkforceStatus(options)
  const { currentStepId, steps } = buildSteps({
    founderSetup,
    gaia,
    starterWorkforce,
    providers,
    machines,
  })

  return {
    currentStepId,
    steps,
    founderSetup,
    gaia,
    starterWorkforce,
    providers,
    machines,
    receipt: buildReceipt({
      founderSetup,
      gaia,
      providers,
      machines,
      publicBaseUrl: options.publicBaseUrl,
    }),
    launchTarget: gaia.commanderId && gaia.conversationId
      ? `/command-room?commander=${encodeURIComponent(gaia.commanderId)}&conversation=${encodeURIComponent(gaia.conversationId)}`
      : FOUNDER_SETUP_COMPLETED_PATH,
  }
}

export async function seedStarterWorkforce(
  options: SeedStarterWorkforceOptions,
): Promise<StarterWorkforceOnboardingStatus> {
  const definitions = (await Promise.all(
    STARTER_COMMANDER_PACKAGE_IDS.map((packageId) => loadCommanderPackage(packageId)),
  )).filter((definition): definition is CommanderPackageDefinition => Boolean(definition))

  for (const definition of definitions) {
    await installCommanderPackage(definition, {
      sessionStore: options.sessionStore,
      conversationStore: options.conversationStore,
      automationStore: options.automationStore,
      automationScheduler: options.automationScheduler,
      automationSchedulerInitialized: options.automationSchedulerInitialized,
      commanderDataDir: options.commanderDataDir,
      now: () => new Date(),
    })
  }

  await setStarterWorkforceSkipped(options.commanderDataDir, false)
  return buildStarterWorkforceStatus(options)
}

export async function skipStarterWorkforce(
  options: BuildOnboardingStatusOptions,
): Promise<StarterWorkforceOnboardingStatus> {
  await setStarterWorkforceSkipped(options.commanderDataDir, true)
  return buildStarterWorkforceStatus(options)
}

export async function seedGaiaCommander(options: SeedGaiaOptions): Promise<GaiaOnboardingStatus> {
  const providers = await buildProviderReadiness(options)
  const existing = await buildGaiaStatus(options, providers)
  if (existing.exists) {
    return existing
  }

  const runtimeConfig = createDefaultCommanderRuntimeConfig()
  const createdAt = new Date().toISOString()
  const session: CommanderSession = {
    id: randomUUID(),
    host: GAIA_HOST,
    state: 'idle',
    created: createdAt,
    agentType: (providers.find((provider) => provider.state === 'ready')?.id ?? 'claude') as CommanderSession['agentType'],
    effort: DEFAULT_CLAUDE_EFFORT_LEVEL,
    heartbeat: createDefaultHeartbeatConfig(),
    maxTurns: runtimeConfig.defaults.maxTurns,
    contextMode: 'thin',
    taskSource: null,
    templateId: GAIA_TEMPLATE_ID,
  }

  const created = await options.sessionStore.create(session)
  let conversationId: string | null = null
  const sideEffects: Array<Promise<unknown>> = [
    mergeIdentityOperatingStyleIntoCommanderWorkflow(created.id, GAIA_IDENTITY, { basePath: options.commanderDataDir }),
    setCommanderDisplayName(options.commanderDataDir, created.id, GAIA_DISPLAY_NAME),
    writeCommanderUiProfile(created.id, options.commanderDataDir, ensureCommanderVisualProfile(created.id, {
      avatar: GAIA_COMMANDER_AVATAR_URL,
      speakingTone: GAIA_SPEAKING_TONE,
    })),
  ]
  if (typeof options.conversationStore?.ensureDefaultConversation === 'function') {
    sideEffects.push(
      options.conversationStore.ensureDefaultConversation({
        commanderId: created.id,
        surface: 'ui',
        createdAt: created.created,
        currentTask: null,
      }).then((conversation: Conversation) => {
        conversationId = conversation.id
      }),
    )
  }

  const results = await Promise.allSettled(sideEffects)
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[onboarding] Gaia seed side effect failed:', result.reason)
    }
  }

  return {
    commanderId: created.id,
    displayName: GAIA_DISPLAY_NAME,
    avatarUrl: GAIA_COMMANDER_AVATAR_URL,
    exists: true,
    conversationId: conversationId ?? await getConversationId(options.conversationStore, created.id),
    defaultProviderId: created.agentType ?? providers[0]?.id ?? null,
  }
}
