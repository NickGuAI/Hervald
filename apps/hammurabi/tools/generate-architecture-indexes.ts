import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HAMMURABI_MODULE_GRAPH } from '../src/module-manifest.js'
import { HAMMURABI_MODULE_MANIFESTS } from '../server/module-manifest.js'

const __filename = fileURLToPath(import.meta.url)
const appRoot = path.resolve(path.dirname(__filename), '..')
const outputDir = path.join(appRoot, 'docs/architecture/indexes')

const scannedRoots = ['src', 'server', 'modules', 'ios', 'assets', 'public', 'tools'] as const

const excludedSegments = new Set([
  'node_modules',
  'dist',
  'dist-server',
  '.turbo',
  '.cocoindex_code',
  '.git',
  'build',
  'coverage',
])

interface FileEntry {
  path: string
  directory: string
  name: string
  extension: string
  sourceArea: string
  moduleId: string | null
  role: string
}

interface DirectoryEntry {
  path: string
  sourceArea: string
  moduleId: string | null
  directFiles: FileEntry[]
}

interface FeatureMapping {
  id: string
  name: string
  route: string
  userVisible: string
  modules: string[]
  ui: string[]
  hooks: string[]
  api: string[]
  runtime: string[]
  storage: string[]
  tests: string[]
  notes: string[]
}

interface ConceptMapping {
  id: string
  name: string
  meaning: string
  userEffect: string
  owners: string[]
  files: string[]
  avoidConfusingWith?: string
}

interface SourceObservation {
  id: string
  kind: 'current-state' | 'drift' | 'legacy'
  summary: string
  userEffect: string
  evidence: string[]
  recommendation: string
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function indent(level: number): string {
  return '  '.repeat(level)
}

function attr(name: string, value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }
  return ` ${name}="${escapeXml(value)}"`
}

function listAttr(name: string, value: readonly string[] | undefined): string {
  if (!value || value.length === 0) {
    return ''
  }
  return attr(name, value.join(', '))
}

function moduleFromPath(relativePath: string): string | null {
  const parts = relativePath.split('/')
  if (parts[0] !== 'modules') {
    return null
  }
  return parts[1] ?? null
}

function sourceAreaFromPath(relativePath: string): string {
  return relativePath.split('/')[0] ?? ''
}

function classifyFile(relativePath: string): string {
  const name = path.basename(relativePath)
  const ext = path.extname(relativePath)
  if (relativePath.includes('/__tests__/') || name.includes('.test.')) return 'test'
  if (name === 'runtime.ts') return 'module-runtime'
  if (name === 'routes.ts' || name === 'route.ts' || relativePath.includes('/routes/')) return 'api-route'
  if (name === 'page.tsx' || name === 'page.ts') return 'page'
  if (name.startsWith('use') || relativePath.includes('/hooks/')) return 'hook'
  if (relativePath.includes('/components/') || /^[A-Z].*\.tsx$/.test(name)) return 'ui-component'
  if (name.includes('store')) return 'store'
  if (name.includes('adapter') || relativePath.includes('/adapters/')) return 'provider-adapter'
  if (name.includes('resolver')) return 'resolver'
  if (name.includes('scheduler') || name.includes('executor')) return 'background-worker'
  if (name.includes('websocket') || name.includes('ws-')) return 'websocket'
  if (name.includes('manifest')) return 'manifest'
  if (name.includes('registry')) return 'registry'
  if (name.endsWith('.md') || ext === '.md') return 'documentation'
  if (ext === '.css') return 'style'
  if (ext === '.swift' || ext === '.plist' || ext === '.pbxproj' || ext === '.xcconfig') return 'ios-wrapper'
  if (['.png', '.jpg', '.jpeg', '.svg', '.mp3'].includes(ext)) return 'asset'
  if (ext === '.json') return 'data'
  return 'source'
}

async function walkFiles(root: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = []

  async function visit(current: string): Promise<void> {
    const currentEntries = await readdir(current, { withFileTypes: true })
    for (const entry of currentEntries) {
      if (excludedSegments.has(entry.name)) {
        continue
      }
      const absolutePath = path.join(current, entry.name)
      const relativePath = path.relative(appRoot, absolutePath).split(path.sep).join('/')
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      entries.push({
        path: relativePath,
        directory: path.dirname(relativePath).split(path.sep).join('/'),
        name: entry.name,
        extension: path.extname(entry.name).replace(/^\./, '') || 'none',
        sourceArea: sourceAreaFromPath(relativePath),
        moduleId: moduleFromPath(relativePath),
        role: classifyFile(relativePath),
      })
    }
  }

  const absoluteRoot = path.join(appRoot, root)
  try {
    const rootStat = await stat(absoluteRoot)
    if (rootStat.isDirectory()) {
      await visit(absoluteRoot)
    }
  } catch {
    // Missing source roots are recorded by absence.
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

function buildDirectories(files: FileEntry[]): DirectoryEntry[] {
  const directories = new Map<string, DirectoryEntry>()
  for (const file of files) {
    const existing = directories.get(file.directory)
    if (existing) {
      existing.directFiles.push(file)
      continue
    }
    directories.set(file.directory, {
      path: file.directory,
      sourceArea: file.sourceArea,
      moduleId: file.moduleId,
      directFiles: [file],
    })
  }
  return [...directories.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function roleSummary(files: FileEntry[]): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const file of files) {
    summary[file.role] = (summary[file.role] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)))
}

function filesForModule(files: FileEntry[], moduleId: string): FileEntry[] {
  return files.filter((file) => file.moduleId === moduleId)
}

const features: FeatureMapping[] = [
  {
    id: 'authenticated-shell',
    name: 'Authenticated App Shell And Navigation',
    route: 'all authenticated routes',
    userVisible: 'After login, users see desktop navigation, mobile bottom tabs, route redirects, theme state, and module-owned pages.',
    modules: ['src', 'module-graph', 'settings'],
    ui: [
      'src/App.tsx',
      'src/app/AuthenticatedAppRouter.tsx',
      'src/surfaces/desktop/Shell.tsx',
      'src/surfaces/desktop/TopBar.tsx',
      'src/surfaces/mobile/MobileShell.tsx',
      'src/surfaces/mobile/MobileBottomTabs.tsx',
      'src/surfaces/mobile/mobile-shell-routes.ts',
    ],
    hooks: ['src/hooks/use-module-graph.ts', 'src/hooks/use-is-mobile.ts', 'src/hooks/use-font-scale.ts'],
    api: ['/api/modules', '/api/settings'],
    runtime: ['server/module-registry.ts', 'modules/module-graph/runtime.ts', 'modules/module-graph/routes.ts'],
    storage: ['settings.app'],
    tests: [
      'src/app/__tests__/AuthenticatedAppRouter.test.tsx',
      'src/surfaces/desktop/__tests__/Shell-mobile-nav.test.tsx',
      'src/surfaces/desktop/__tests__/Shell-mobile-viewport.test.tsx',
    ],
    notes: ['Navigation is declared in src/module-manifest.ts and served through module-graph, not hand-coded per page.'],
  },
  {
    id: 'org-page',
    name: 'Org Page',
    route: '/org',
    userVisible: 'Users see founder/operator identity, commander cards, channel counts, automation summaries, archive state, and org setup state.',
    modules: ['org', 'operators', 'org-identity', 'commanders', 'automations', 'channels'],
    ui: [
      'modules/org/page.tsx',
      'modules/org/OrgPage.tsx',
      'modules/org/MobileOrgPage.tsx',
      'modules/org/components/CommanderProfileCardGrid.tsx',
      'modules/org/components/ChannelsCard.tsx',
      'modules/org/components/AutomationsCard.tsx',
      'modules/org-identity/components/OrgIdentityCard.tsx',
      'modules/operators/hooks/useFounderProfile.ts',
    ],
    hooks: ['modules/org/hooks/useOrgTree.ts', 'modules/org/hooks/useOrgActions.ts', 'modules/org-identity/hooks/useOrgIdentity.ts'],
    api: ['/api/org', '/api/org/identity', '/api/operators', '/api/commanders'],
    runtime: ['modules/org/runtime.ts', 'modules/org/route.ts', 'modules/org/aggregator.ts'],
    storage: ['org.identity', 'operators.profiles', 'commanders.sessions', 'automations.definitions'],
    tests: ['modules/org/__tests__/OrgPage.test.tsx', 'modules/org/__tests__/MobileOrgPage.test.tsx', 'modules/org/__tests__/aggregator.test.ts'],
    notes: ['Org is a read model over other owners. It should not become the store owner for commanders, channels, or automations.'],
  },
  {
    id: 'command-room',
    name: 'Command Room',
    route: '/command-room',
    userVisible: 'Users operate commanders from the main desktop and mobile chat surface with sessions, chat, queue, workspace, approvals, automations, identity, and settings.',
    modules: ['command-room', 'agents', 'commanders', 'conversation', 'workspace', 'approvals', 'automations', 'settings'],
    ui: [
      'modules/command-room/page.tsx',
      'modules/command-room/components/CommandRoom.tsx',
      'modules/command-room/components/desktop/SessionsColumn.tsx',
      'modules/command-room/components/desktop/CenterColumn.tsx',
      'modules/command-room/components/desktop/ChatPane.tsx',
      'modules/command-room/components/mobile/MobileCommandRoom.tsx',
      'modules/command-room/components/mobile/MobileChatView.tsx',
      'modules/command-room/components/mobile/MobileWorkspaceSheet.tsx',
    ],
    hooks: [
      'src/hooks/use-agents.ts',
      'src/hooks/use-agent-session-stream.ts',
      'modules/conversation/hooks/use-conversations.ts',
      'modules/workspace/use-workspace.ts',
      'src/hooks/use-approvals.ts',
    ],
    api: ['/api/agents', '/api/agents/sessions/:name/ws', '/api/commanders', '/api/conversations', '/api/workspace', '/api/approvals'],
    runtime: [
      'modules/agents/runtime.ts',
      'modules/commanders/runtime.ts',
      'modules/conversation/runtime.ts',
      'modules/workspace/runtime.ts',
    ],
    storage: ['agents.stream-sessions', 'commanders.conversations', 'workspace.conversation-targets', 'approvals.pending'],
    tests: [
      'modules/command-room/__tests__/hervald-routing.test.ts',
      'modules/command-room/components/desktop/__tests__/CommandRoom.chat-start.test.tsx',
      'modules/command-room/components/mobile/__tests__/MobileCommandRoom.workspace.test.tsx',
    ],
    notes: ['Command Room composes state owned elsewhere. Durable data ownership remains in agents, commanders, workspace, approvals, automations, and settings.'],
  },
  {
    id: 'chat-sessions',
    name: 'Agent Sessions And Chat Transcript',
    route: '/command-room and embedded agents session UI',
    userVisible: 'Users start sessions, send messages, see streamed assistant output, subagent blocks, tool blocks, queued messages, provider model controls, and session status.',
    modules: ['agents', 'command-room', 'commanders'],
    ui: [
      'modules/agents/components/SessionComposer.tsx',
      'modules/agents/components/SessionMessageList.tsx',
      'modules/agents/components/QueuePanel.tsx',
      'modules/agents/components/session-message-list/blocks.tsx',
      'modules/agents/components/use-stream-event-processor.ts',
      'modules/agents/page-shell/MobileSessionShell.tsx',
    ],
    hooks: ['src/hooks/use-agents.ts', 'src/hooks/use-agent-session-stream.ts', 'src/hooks/send-dispatcher.ts'],
    api: ['/api/agents/sessions', '/api/agents/sessions/:name/message', '/api/agents/sessions/:name/queue', '/api/agents/sessions/:name/ws'],
    runtime: [
      'modules/agents/routes.ts',
      'modules/agents/routes/session-control-routes.ts',
      'modules/agents/routes/session-query-routes.ts',
      'modules/agents/websocket.ts',
      'modules/agents/messages/stream-event-machine.ts',
      'modules/agents/messages/planning.ts',
    ],
    storage: ['agents.stream-sessions', 'agents.transcripts'],
    tests: [
      'modules/agents/components/__tests__/SessionMessageList.test.ts',
      'modules/agents/components/session-message-list/__tests__/blocks.test.tsx',
      'modules/agents/__tests__/queue-mutation.test.ts',
      'src/hooks/__tests__/use-agent-session-stream.test.ts',
    ],
    notes: ['Queued user messages belong in the queue surface until runtime processing emits the chat turn.'],
  },
  {
    id: 'session-queue',
    name: 'Session Queue',
    route: 'Queue tab and queue controls inside command-room chat',
    userVisible: 'Users can queue follow-up messages, see waiting/current queue state, reorder or clear queued items, and avoid seeing queued text as duplicate chat turns.',
    modules: ['agents', 'command-room', 'conversation'],
    ui: [
      'modules/agents/components/QueuePanel.tsx',
      'modules/agents/components/SessionComposer.tsx',
      'modules/command-room/components/desktop/CenterColumn.tsx',
      'modules/command-room/components/transcript.ts',
    ],
    hooks: ['modules/agents/session-queue-api.ts', 'modules/agents/queue-mutation.ts', 'src/hooks/send-dispatcher.ts'],
    api: ['/api/agents/sessions/:name/queue', '/api/agents/sessions/:name/message?queue=true', '/api/conversations/:id/message with queue flag'],
    runtime: [
      'modules/agents/message-queue.ts',
      'modules/agents/queue-state.ts',
      'modules/agents/queue-capability.ts',
      'modules/agents/routes/session-control-routes.ts',
      'modules/agents/websocket.ts',
    ],
    storage: ['live session queue state', 'agents.stream-sessions for persisted runtime session metadata'],
    tests: [
      'modules/agents/__tests__/queue-mutation.test.ts',
      'modules/agents/__tests__/queue-capability.test.ts',
      'modules/agents/components/__tests__/SessionComposer.test.tsx',
      'modules/command-room/__tests__/hervald-transcript.test.ts',
    ],
    notes: ['Queued backlog is deliberately not merged into the transcript. It appears in chat once when the runtime processes it.'],
  },
  {
    id: 'subagent-and-plan-blocks',
    name: 'Subagent Blocks And Plan-Mode Questions',
    route: 'chat transcript blocks inside command-room and session UI',
    userVisible: 'Users should see subagent work, planning, and blocked-on-user questions as structured chat blocks instead of one-line plain text.',
    modules: ['agents', 'command-room', 'approvals'],
    ui: [
      'modules/agents/components/session-message-list/blocks.tsx',
      'modules/agents/components/session-message-list/render-items.ts',
      'modules/agents/components/use-stream-event-processor.ts',
      'modules/command-room/components/desktop/ChatPane.tsx',
      'modules/command-room/components/mobile/MobileChatView.tsx',
    ],
    hooks: ['src/hooks/use-agent-session-stream.ts'],
    api: ['/api/agents/sessions/:name/ws', '/api/agents/sessions/:name/messages'],
    runtime: [
      'src/types/hammurabi-events.ts',
      'modules/agents/messages/stream-event-machine.ts',
      'modules/agents/messages/planning.ts',
      'modules/agents/event-normalizers/claude.ts',
      'modules/agents/event-normalizers/codex.ts',
      'modules/agents/event-normalizers/opencode.ts',
    ],
    storage: ['agent transcript event history'],
    tests: [
      'modules/agents/components/session-message-list/__tests__/blocks.test.tsx',
      'modules/agents/components/session-message-list/__tests__/render-items.test.ts',
      'modules/agents/components/__tests__/use-stream-event-processor.test.ts',
    ],
    notes: ['Provider-native plan mode or ask-user-question events must normalize into Hammurabi event shapes before UI rendering.'],
  },
  {
    id: 'commander-identity',
    name: 'Commander Identity, Hiring, Memory, And Quests',
    route: 'embedded in /org and /command-room',
    userVisible: 'Users create or edit commanders, inspect COMMANDER.md identity, start/stop conversations, view heartbeat, manage quests, and dispatch workers.',
    modules: ['commanders', 'quests', 'agents', 'automations'],
    ui: [
      'modules/commanders/components/CreateCommanderWizard.tsx',
      'modules/commanders/components/CommanderIdentityTab.tsx',
      'modules/commanders/components/CommanderMdPreview.tsx',
      'modules/commanders/components/QuestBoard.tsx',
      'modules/commanders/components/HeartbeatMonitor.tsx',
      'modules/conversation/components/CreateConversationPanel.tsx',
      'modules/conversation/components/ConversationRow.tsx',
    ],
    hooks: ['modules/commanders/hooks/useCommander.ts', 'modules/conversation/hooks/use-conversations.ts'],
    api: ['/api/commanders', '/api/commanders/:id/quests', '/api/conversations', '/api/commanders/:id/workers'],
    runtime: [
      'modules/commanders/runtime.ts',
      'modules/commanders/routes/register-core.ts',
      'modules/commanders/routes/register-conversations.ts',
      'modules/commanders/routes/register-quests.ts',
      'modules/commanders/routes/register-workers.ts',
      'modules/commanders/memory/session-seed.ts',
    ],
    storage: ['commanders.sessions', 'commanders.memory', 'commanders.quests', 'commanders.transcripts'],
    tests: [
      'modules/commanders/__tests__/routes.test.ts',
      'modules/commanders/__tests__/CommanderIdentityTab.test.tsx',
      'modules/commanders/__tests__/register-workers.test.ts',
      'modules/commanders/memory/__tests__/context-builder.test.ts',
    ],
    notes: ['COMMANDER.md is the canonical prompt-bearing identity source; persona-like UI labels must not be treated as runtime identity.'],
  },
  {
    id: 'channels',
    name: 'Channels: WhatsApp And Email',
    route: '/channels',
    userVisible: 'Users connect channel accounts, manage allowlists and pairing state, receive inbound messages as commander conversations, and have replies sent back out.',
    modules: ['channels', 'commanders', 'policies', 'agents'],
    ui: ['modules/channels/page.tsx', 'modules/channels/hooks/useChannels.ts', 'modules/org/components/ChannelsCard.tsx'],
    hooks: ['modules/channels/hooks/useChannels.ts'],
    api: ['/api/commanders/:id/channels', '/api/commanders/channel-message', '/api/commanders/:id/channel-reply'],
    runtime: [
      'modules/channels/runtime.ts',
      'modules/channels/runtime-manager.ts',
      'modules/channels/registry.ts',
      'modules/channels/resolver.ts',
      'modules/channels/surface-binding-store.ts',
      'modules/channels/whatsapp/adapter.ts',
      'modules/channels/email/adapter.ts',
      'modules/commanders/routes/register-channels.ts',
      'modules/commanders/channel-dispatchers.ts',
    ],
    storage: ['channels.bindings', 'channels.surface-bindings', 'channels.email-attachments', 'channels.whatsapp-auth', 'commanders.conversations'],
    tests: [
      'modules/channels/__tests__/inbound-roundtrip.test.ts',
      'modules/channels/__tests__/outbound.test.ts',
      'modules/channels/__tests__/resolver.test.ts',
      'modules/commanders/__tests__/channel-message-routes.test.ts',
    ],
    notes: ['Account binding chooses the commander. Surface binding chooses the conversation. The channel page does not choose an existing conversation by default.'],
  },
  {
    id: 'workspace-files',
    name: 'Workspace Files, Preview, Git, And Context',
    route: 'right panel in /command-room and mobile workspace sheet',
    userVisible: 'Users browse a selected workspace target, preview files, inspect git state, insert file context, and materialize ad hoc annotations.',
    modules: ['workspace', 'agents', 'command-room', 'commanders'],
    ui: [
      'modules/workspace/components/WorkspacePanel.tsx',
      'modules/workspace/components/WorkspaceTree.tsx',
      'modules/workspace/components/WorkspaceFilePreview.tsx',
      'modules/workspace/components/WorkspaceGitPanel.tsx',
      'modules/command-room/components/mobile/MobileWorkspaceSheet.tsx',
      'modules/agents/components/WorkspaceOverlay.tsx',
    ],
    hooks: ['modules/workspace/use-workspace.ts', 'modules/agents/components/workspace-overlay/use-workspace-overlay-tree.ts'],
    api: ['/api/workspace/open', '/api/workspace/tree', '/api/workspace/file', '/api/workspace/raw', '/api/workspace/git', '/api/workspace/context/materialize'],
    runtime: ['modules/workspace/routes.ts', 'modules/workspace/resolver.ts', 'modules/workspace/files.ts', 'modules/workspace/git.ts', 'modules/workspace/store.ts'],
    storage: ['workspace.conversation-targets', 'workspace.preferences'],
    tests: ['modules/workspace/__tests__/service.test.ts', 'modules/workspace/components/__tests__/WorkspacePanel-context.test.tsx', 'src/__tests__/workspace-preview-mobile.test.tsx'],
    notes: ['Workspace targets are resolved from conversation/session/commander/location context. Missing target mapping is surfaced as Workspace path not found.'],
  },
  {
    id: 'approvals-policies',
    name: 'Approvals And Action Policies',
    route: '/approvals, /policies, /command-room/inbox',
    userVisible: 'Users review pending tool actions, approve or deny them, set policy defaults, and use mobile inbox sheets.',
    modules: ['approvals', 'policies', 'agents'],
    ui: [
      'modules/approvals/page.tsx',
      'modules/approvals/ApprovalCard.tsx',
      'modules/approvals/ApprovalSheet.tsx',
      'modules/approvals/MobileInbox.tsx',
      'modules/policies/page.tsx',
    ],
    hooks: ['src/hooks/use-approvals.ts', 'src/hooks/use-action-policies.ts'],
    api: ['/api/approvals', '/api/approvals/stream', '/api/action-policies', '/api/approval'],
    runtime: [
      'modules/policies/runtime.ts',
      'modules/policies/action-policy-gate.ts',
      'modules/policies/pending-store.ts',
      'modules/policies/approvals-routes.ts',
      'modules/policies/provider-approval-adapter.ts',
    ],
    storage: ['policies.rules', 'approvals.pending', 'approvals.audit'],
    tests: ['modules/policies/__tests__/routes.test.ts', 'modules/policies/__tests__/provider-approval-adapter.test.ts', 'modules/approvals/__tests__/approval-preview.test.tsx'],
    notes: ['Approval stream is owned by approvals UI but queue storage and coordinator currently live in policies.'],
  },
  {
    id: 'automations-quests',
    name: 'Automations, Scheduled Work, And Quest Board',
    route: '/automations and command-room quest tabs',
    userVisible: 'Users create scheduled automation work, see run history, filter mobile automations, and manage commander quests.',
    modules: ['automations', 'commanders', 'quests', 'sentinels'],
    ui: [
      'modules/automations/page.tsx',
      'modules/automations/MobileAutomations.tsx',
      'modules/commanders/components/AutomationPanel.tsx',
      'modules/commanders/components/QuestBoard.tsx',
      'modules/quests/page.tsx',
    ],
    hooks: ['modules/automations/hooks/useAutomations.ts'],
    api: ['/api/automations', '/api/commanders/:id/quests'],
    runtime: [
      'modules/automations/runtime.ts',
      'modules/automations/scheduler.ts',
      'modules/automations/executor.ts',
      'modules/automations/store.ts',
      'modules/automations/quest-event-bus.ts',
      'modules/commanders/quest-store.ts',
    ],
    storage: ['automations.definitions', 'automations.runs', 'automations.memory', 'commanders.quests'],
    tests: ['modules/automations/__tests__/scheduler-lifecycle.test.ts', 'modules/automations/__tests__/AutomationsPage.test.tsx', 'modules/commanders/__tests__/quest-store.test.ts'],
    notes: ['Sentinels is classified as retired legacy code and should not be treated as the active scheduler surface.'],
  },
  {
    id: 'telemetry',
    name: 'Telemetry Hub',
    route: '/telemetry',
    userVisible: 'Users inspect telemetry events, summaries, local scan status, and OTEL-ingested service events.',
    modules: ['telemetry'],
    ui: ['modules/telemetry/page.tsx', 'modules/telemetry/components/TelemetryPreviewCard.tsx'],
    hooks: ['src/hooks/use-telemetry.ts'],
    api: ['/api/telemetry', '/v1'],
    runtime: [
      'modules/telemetry/runtime.ts',
      'modules/telemetry/routes.ts',
      'modules/telemetry/hub.ts',
      'modules/telemetry/otel-receiver.ts',
      'modules/telemetry/local-scanner.ts',
      'modules/telemetry/store.ts',
    ],
    storage: ['telemetry.events'],
    tests: ['modules/telemetry/__tests__/routes.test.ts', 'modules/telemetry/__tests__/hub.test.ts', 'modules/telemetry/__tests__/otel-receiver.test.ts'],
    notes: ['The OTEL parser is mounted before global JSON at /v1 and is separate from /api/telemetry reads.'],
  },
  {
    id: 'settings-api-keys-skills',
    name: 'Settings, API Keys, Provider Secrets, And Skills',
    route: '/api-keys, /command-room/settings, embedded skill picker',
    userVisible: 'Users manage app settings, provider credentials, transcription/image keys, account profile cards, mobile settings, and skills available to commanders.',
    modules: ['api-keys', 'settings', 'skills', 'agents', 'commanders'],
    ui: [
      'modules/api-keys/page.tsx',
      'modules/api-keys/components/AccountProfileCard.tsx',
      'modules/settings/MobileSettings.tsx',
      'modules/agents/components/SkillsPicker.tsx',
    ],
    hooks: ['src/hooks/use-api-keys.ts', 'src/hooks/use-skills.ts'],
    api: ['/api/auth', '/api/settings', '/api/skills', '/api/providers'],
    runtime: [
      'modules/api-keys/runtime.ts',
      'server/routes/api-keys.ts',
      'server/api-keys/provider-secrets-store.ts',
      'modules/settings/runtime.ts',
      'modules/settings/routes.ts',
      'modules/skills/runtime.ts',
      'modules/skills/routes.ts',
      'modules/skills/skill-roots.ts',
      'modules/agents/providers/runtime.ts',
    ],
    storage: ['api-keys.keys', 'api-keys.provider-secrets', 'settings.app', 'installed skill roots'],
    tests: ['modules/skills/__tests__/routes.test.ts', 'src/hooks/__tests__/use-skills.test.ts', 'modules/settings/__tests__/MobileSettings.test.tsx', 'modules/api-keys/__tests__/ApiKeysPage.magic-bento.test.tsx'],
    notes: ['The provider registry endpoint is declared as agents.providers-api but mounted by the providers runtime at /api/providers.'],
  },
  {
    id: 'onboarding',
    name: 'Founder Onboarding',
    route: '/welcome',
    userVisible: 'New users complete founder and organization setup before using the main shell.',
    modules: ['onboarding', 'org', 'operators', 'org-identity'],
    ui: ['modules/onboarding/page.tsx', 'modules/onboarding/FounderOrgSetupPage.tsx'],
    hooks: ['modules/onboarding/hooks/useFounderOnboarding.ts'],
    api: ['/api/org', '/api/operators', '/api/org/identity'],
    runtime: ['modules/org/runtime.ts', 'modules/operators/runtime.ts', 'modules/org-identity/route.ts'],
    storage: ['org.identity', 'operators.profiles'],
    tests: ['modules/onboarding/__tests__/FounderOrgSetupPage.test.tsx'],
    notes: ['Onboarding owns the setup flow UI; durable profile data is written through org/operator/org-identity owners.'],
  },
  {
    id: 'realtime-voice',
    name: 'Realtime Voice And Transcription',
    route: 'composer microphone and realtime websocket',
    userVisible: 'Users can dictate or stream voice input from the browser into transcription-backed chat flows.',
    modules: ['realtime', 'api-keys', 'agents'],
    ui: ['modules/agents/components/SessionComposer.tsx'],
    hooks: ['src/hooks/use-openai-transcription.ts', 'src/hooks/use-speech-recognition.ts'],
    api: ['/api/realtime', '/api/realtime/transcription', '/api/auth/transcription/openai'],
    runtime: ['modules/realtime/runtime.ts', 'server/realtime/proxy.ts', 'server/realtime/openai-realtime.ts', 'server/voice/stt.ts', 'server/voice/tts.ts'],
    storage: ['realtime.transcription-key-store'],
    tests: ['server/realtime/__tests__/proxy.test.ts', 'src/hooks/__tests__/use-openai-transcription.test.ts', 'modules/channels/__tests__/voice-stt.test.ts'],
    notes: ['Realtime is stateless. Credentials are owned by api-keys.'],
  },
  {
    id: 'rpg',
    name: 'Experimental RPG Visualization',
    route: '/rpg',
    userVisible: 'Users can open a hidden experimental world-state visualization with party, quests, economy, log, and command prompt screens.',
    modules: ['rpg', 'agents', 'commanders'],
    ui: [
      'modules/rpg/page.tsx',
      'modules/rpg/RpgScene.tsx',
      'modules/rpg/screens/OverworldScreen.tsx',
      'modules/rpg/screens/QuestsScreen.tsx',
      'modules/rpg/CommandPrompt.tsx',
    ],
    hooks: ['modules/rpg/use-session-ws.tsx', 'modules/rpg/use-world-state.tsx', 'modules/rpg/hooks/use-world-state.ts'],
    api: ['/api/agents/world', '/api/agents/sessions/:name/ws'],
    runtime: ['modules/agents/routes/machine-world-routes.ts', 'modules/agents/websocket.ts'],
    storage: [],
    tests: [],
    notes: ['RPG is hidden experimental UI. It consumes agents world-state and session websocket capabilities.'],
  },
  {
    id: 'ios-mobile-wrapper',
    name: 'iOS And Mobile Wrapper',
    route: 'Capacitor iOS shell and mobile web routes',
    userVisible: 'Mobile users access Hammurabi through responsive command-room/org/automations/settings/inbox surfaces and the iOS wrapper project.',
    modules: ['ios', 'command-room', 'org', 'automations', 'settings', 'approvals'],
    ui: [
      'ios/README.md',
      'ios/App/App/AppDelegate.swift',
      'ios/App/App/SceneDelegate.swift',
      'ios/App/App/Info.plist',
      'src/surfaces/mobile/MobileShell.tsx',
      'modules/command-room/components/mobile/MobileCommandRoom.tsx',
      'modules/settings/MobileSettings.tsx',
    ],
    hooks: ['src/hooks/use-is-mobile.ts'],
    api: ['same authenticated web APIs as mobile web routes'],
    runtime: ['Capacitor shell; server runtime remains Express module runtime'],
    storage: [],
    tests: ['src/__tests__/mobile-chat-shell-css.test.ts', 'src/__tests__/mobile-input-autozoom.test.ts', 'modules/command-room/components/mobile/__tests__/MobileCommandRoom.test.tsx'],
    notes: ['iOS wraps the web app. Feature ownership remains in the same modules as desktop.'],
  },
]

const concepts: ConceptMapping[] = [
  {
    id: 'module-manifest',
    name: 'Module Manifest',
    meaning: 'The source declaration for module identity, navigation, UI surfaces, route ids, parser ids, websocket ids, storage keys, dependencies, and capabilities.',
    userEffect: 'Controls which pages appear in navigation and how the frontend knows what the backend claims to provide.',
    owners: ['src/module-manifest.ts', 'server/module-manifest.ts'],
    files: ['src/module-manifest.ts', 'server/module-manifest.ts', 'server/module-loader.ts'],
  },
  {
    id: 'runtime',
    name: 'Runtime',
    meaning: 'A server-side module factory result that wires routers, stores, capabilities, lifecycle work, parser declarations, and websocket handlers into the Express process.',
    userEffect: 'Determines whether a page API, channel runtime, service log stream, skill list, or chat session actually works after startup.',
    owners: ['server/module-runtime-factories.ts', 'modules/*/runtime.ts'],
    files: ['server/module-runtime-factories.ts', 'server/module-runtime.ts', 'server/module-registry.ts'],
  },
  {
    id: 'route-id',
    name: 'Route Id',
    meaning: 'Stable manifest identifier that connects frontend module graph declarations to backend mounts.',
    userEffect: 'Lets the shell and module graph show accurate routes without guessing from URL strings.',
    owners: ['src/module-manifest.ts', 'server/module-manifest.ts'],
    files: ['src/module-manifest.ts', 'server/module-manifest.ts', 'server/module-loader.ts'],
  },
  {
    id: 'agents-providers-api',
    name: 'agents.providers-api',
    meaning: 'Provider registry metadata route declared under agents because provider metadata belongs to the agents provider registry.',
    userEffect: 'Provider/model selectors can list available providers and onboarding state.',
    owners: ['agents manifest declaration', 'providers runtime'],
    files: ['src/module-manifest.ts', 'server/module-manifest.ts', 'modules/agents/providers/runtime.ts', 'modules/agents/providers/http-router.ts'],
    avoidConfusingWith: 'It is not mounted by the agents session runtime at /api/agents; it is mounted by the providers runtime at /api/providers.',
  },
  {
    id: 'commander',
    name: 'Commander',
    meaning: 'A durable identity and operating context with COMMANDER.md, memory, quests, conversations, heartbeat, and worker dispatch.',
    userEffect: 'The named assistant persona users hire, configure, chat with, and assign work to.',
    owners: ['commanders'],
    files: ['modules/commanders/store.ts', 'modules/commanders/memory/session-seed.ts', 'modules/commanders/routes/register-core.ts'],
    avoidConfusingWith: 'A commander is not a channel account and not a single conversation.',
  },
  {
    id: 'conversation',
    name: 'Conversation',
    meaning: 'A durable chat surface under a commander. It may be created by UI or by an inbound channel surface.',
    userEffect: 'Shows up as a chat under a commander and provides target context for runtime, messages, and workspace.',
    owners: ['commanders', 'conversation UI helpers'],
    files: ['modules/commanders/conversation-store.ts', 'modules/commanders/routes/register-conversations.ts', 'modules/conversation/hooks/use-conversations.ts'],
    avoidConfusingWith: 'A conversation is not the external account binding. Surface binding maps external peer/thread to the conversation.',
  },
  {
    id: 'channel-account-binding',
    name: 'Channel Account Binding',
    meaning: 'Provider/account-level ownership record that tells Hammurabi which commander owns an external account.',
    userEffect: 'When WhatsApp or email receives a message, this chooses the commander that should receive it.',
    owners: ['channels'],
    files: ['modules/channels/store.ts', 'modules/channels/route.ts', 'modules/channels/runtime-manager.ts'],
    avoidConfusingWith: 'It does not choose the exact conversation. Surface binding does that.',
  },
  {
    id: 'channel-surface-binding',
    name: 'Channel Surface Binding',
    meaning: 'Provider/account/peer/thread mapping that chooses or creates the commander conversation for an external surface.',
    userEffect: 'The same WhatsApp person or email thread continues in the same Hammurabi conversation.',
    owners: ['channels'],
    files: ['modules/channels/surface-binding-store.ts', 'modules/channels/surface-key.ts', 'modules/channels/resolver.ts'],
    avoidConfusingWith: 'It is not the transport connection and not commander identity.',
  },
  {
    id: 'queue-message',
    name: 'Queued Message',
    meaning: 'A pending user input waiting behind runtime startup or other queued work.',
    userEffect: 'Appears in the Queue tab while waiting and becomes a single chat message only when processed.',
    owners: ['agents'],
    files: ['modules/agents/message-queue.ts', 'modules/agents/queue-mutation.ts', 'modules/agents/session-queue-api.ts', 'modules/agents/components/QueuePanel.tsx'],
  },
  {
    id: 'ask-user-question',
    name: 'Ask User Question Event',
    meaning: 'Normalized blocked-on-user interaction event for plan mode or approval-like workflows.',
    userEffect: 'Lets the UI render an interactive blocker instead of a plain text line when Claude, Codex, or OpenCode asks for user input.',
    owners: ['agents stream events', 'command-room chat rendering'],
    files: ['src/types/hammurabi-events.ts', 'modules/agents/messages/planning.ts', 'modules/agents/components/session-message-list/blocks.tsx'],
  },
  {
    id: 'workspace-target',
    name: 'Workspace Target',
    meaning: 'Resolved source location for file browsing and edits, derived from conversation, session, commander, or explicit location context.',
    userEffect: 'The workspace panel opens the correct project tree for the selected chat or session.',
    owners: ['workspace'],
    files: ['modules/workspace/resolver.ts', 'modules/workspace/store.ts', 'modules/workspace/routes.ts', 'modules/workspace/use-workspace.ts'],
  },
  {
    id: 'skill-root',
    name: 'Skill Root',
    meaning: 'Filesystem roots scanned for installed commander skills exposed through discovery-only skill APIs.',
    userEffect: 'The skills picker and skill APIs show the available skills for a commander session.',
    owners: ['skills', 'commanders memory'],
    files: ['modules/skills/skill-roots.ts', 'modules/skills/routes.ts', 'src/hooks/use-skills.ts', 'modules/agents/components/SkillsPicker.tsx'],
  },
  {
    id: 'retired-roots',
    name: 'Retired Roots',
    meaning: 'Former root directories that must not be revived as hidden runtime/script locations.',
    userEffect: 'Prevents surprise hard-coded pipelines outside the module system.',
    owners: ['docs/module-index.xml', 'architecture contract'],
    files: ['apps/hammurabi/scripts (retired)', 'apps/hammurabi/migrations (retired)', 'apps/hammurabi/agents (retired)'],
    avoidConfusingWith: 'Use module-owned tools and module-owned data roots instead of root scripts or migrations.',
  },
  {
    id: 'sentinels-legacy',
    name: 'Sentinels Legacy Source',
    meaning: 'A retained legacy scheduler/API/UI source tree that is classified as retired in the manifest and is not part of the active runtime mount path.',
    userEffect: 'Users should use Automations for current scheduled work; searches may still find sentinel source and tests, but those are not the active product path.',
    owners: ['sentinels legacy source', 'automations active scheduler'],
    files: ['modules/sentinels/routes.ts', 'modules/sentinels/scheduler.ts', 'modules/sentinels/page.tsx', 'server/module-manifest.ts', 'server/module-runtime-factories.ts'],
    avoidConfusingWith: 'Automations owns current scheduler behavior, run history, and quest-triggered work.',
  },
  {
    id: 'mobile-route-embedding',
    name: 'Mobile Route Embedding',
    meaning: 'Some mobile routes are declared in module metadata but rendered under the command-room wildcard shell rather than direct static top-level bindings.',
    userEffect: 'Mobile users can open inbox, settings, workspace, and chat sheets while still staying inside command-room navigation.',
    owners: ['command-room frontend shell', 'module manifest route declarations'],
    files: ['src/module-manifest.ts', 'src/module-registry.ts', 'modules/command-room/components/mobile/MobileCommandRoom.tsx', 'modules/settings/MobileSettings.tsx', 'modules/approvals/MobileInbox.tsx'],
    avoidConfusingWith: 'A manifest route declaration is not always a direct lazy import in src/module-registry.ts.',
  },
]

const observations: SourceObservation[] = [
  {
    id: 'org-identity-storage-path-drift',
    kind: 'drift',
    summary: 'Server manifest metadata describes org identity storage under ${HAMMURABI_DATA_DIR}/org/identity.json, while the current store default resolves to ${HAMMURABI_DATA_DIR}/org.json.',
    userEffect: 'Org identity still works through the store, but architecture readers should check the concrete store path before changing storage or migrations.',
    evidence: ['server/module-manifest.ts', 'modules/org-identity/store.ts'],
    recommendation: 'Treat modules/org-identity/store.ts as the runtime source of truth until the manifest metadata is reconciled.',
  },
  {
    id: 'ios-domain-doc-drift',
    kind: 'drift',
    summary: 'iOS README references hervald.gehirn.ai while Capacitor config and native API base target hervald.gehirn.ai.',
    userEffect: 'Mobile/iOS setup readers may use the wrong production host if they follow the stale README text.',
    evidence: ['ios/README.md', 'capacitor.config.ts', 'src/lib/api-base.ts'],
    recommendation: 'Use capacitor.config.ts and src/lib/api-base.ts as current runtime truth; update prose docs separately before mobile release work.',
  },
  {
    id: 'skills-discovery-only',
    kind: 'current-state',
    summary: 'Skills are discovery-only: the standalone /skills management page and config/history endpoints are removed.',
    userEffect: 'Users choose skills from composer, automation, policy, and quest pickers rather than a standalone skills management page.',
    evidence: ['src/module-manifest.ts', 'src/module-registry.ts', 'modules/skills/routes.ts', 'modules/agents/components/SkillsPicker.tsx'],
    recommendation: 'Do not infer a standalone skills route or skills config API unless the module manifest and router add them back.',
  },
  {
    id: 'sentinels-source-retained',
    kind: 'legacy',
    summary: 'Sentinel source, tests, routes, scheduler, and UI remain in the repository, but the module is manifest-retired and not part of current runtime setup.',
    userEffect: 'Current scheduled work appears through Automations; legacy sentinel files can mislead code search and architecture diagrams.',
    evidence: ['modules/sentinels', 'src/module-manifest.ts', 'server/module-manifest.ts', 'server/module-runtime-factories.ts'],
    recommendation: 'Document sentinel references as legacy unless a future issue explicitly reactivates them.',
  },
]

function sourceTreeXml(files: FileEntry[], directories: DirectoryEntry[]): string {
  const bySourceArea = new Map<string, FileEntry[]>()
  for (const file of files) {
    const area = bySourceArea.get(file.sourceArea) ?? []
    area.push(file)
    bySourceArea.set(file.sourceArea, area)
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<architectureSourceTree app="hammurabi" generatedBy="tools/generate-architecture-indexes.ts">',
    `${indent(1)}<sourceRoots>${scannedRoots.map((root) => `<root path="${root}"/>`).join('')}</sourceRoots>`,
    `${indent(1)}<summary files="${files.length}" directories="${directories.length}"/>`,
  ]

  for (const [sourceArea, areaFiles] of [...bySourceArea.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const areaDirectories = directories.filter((directory) => directory.sourceArea === sourceArea)
    lines.push(`${indent(1)}<sourceArea id="${escapeXml(sourceArea)}" files="${areaFiles.length}" directories="${areaDirectories.length}">`)
    for (const directory of areaDirectories) {
      lines.push(`${indent(2)}<directory path="${escapeXml(directory.path)}"${attr('module', directory.moduleId)} files="${directory.directFiles.length}">`)
      for (const file of directory.directFiles.sort((left, right) => left.name.localeCompare(right.name))) {
        lines.push(`${indent(3)}<file path="${escapeXml(file.path)}" name="${escapeXml(file.name)}" extension="${escapeXml(file.extension)}" role="${escapeXml(file.role)}"${attr('module', file.moduleId)}/>`)
      }
      lines.push(`${indent(2)}</directory>`)
    }
    lines.push(`${indent(1)}</sourceArea>`)
  }

  lines.push('</architectureSourceTree>')
  return `${lines.join('\n')}\n`
}

function runtimeIndexXml(files: FileEntry[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<architectureRuntimeIndex app="hammurabi" generatedBy="tools/generate-architecture-indexes.ts">',
    `${indent(1)}<sourceOfTruth graph="src/module-manifest.ts" server="server/module-manifest.ts" factories="server/module-runtime-factories.ts" existingIndex="docs/module-index.xml"/>`,
  ]

  for (const manifest of HAMMURABI_MODULE_MANIFESTS) {
    const graph = manifest.graph
    const server = manifest.server
    const moduleFiles = filesForModule(files, graph.id)
    const roles = roleSummary(moduleFiles)
    lines.push(`${indent(1)}<module id="${escapeXml(graph.id)}" label="${escapeXml(graph.label)}" status="${escapeXml(graph.status)}" directory="${escapeXml(graph.directory)}" files="${moduleFiles.length}">`)
    lines.push(`${indent(2)}<summary>${escapeXml(graph.summary)}</summary>`)
    lines.push(`${indent(2)}<dependencies${listAttr('modules', graph.dependencies.modules)}${listAttr('capabilities', graph.dependencies.capabilities)}/>`)
    lines.push(`${indent(2)}<capabilities${listAttr('provides', graph.capabilities.provides)}${listAttr('consumes', graph.capabilities.consumes)}/>`)
    lines.push(`${indent(2)}<ui kind="${escapeXml(graph.ui.kind)}"${listAttr('surfaces', graph.ui.surfaces)}>` )
    for (const route of graph.ui.routes ?? []) {
      lines.push(`${indent(3)}<route id="${escapeXml(route.id)}" path="${escapeXml(route.path)}" componentKey="${escapeXml(route.componentKey)}"${listAttr('surfaces', route.surfaces)}${attr('navLabel', route.nav?.label)}${attr('navGroup', route.nav?.group)}${attr('hidden', (route.nav as { hidden?: boolean } | undefined)?.hidden ? 'true' : undefined)}/>`)
    }
    for (const redirect of (graph.ui as { redirects?: readonly { id: string; from: string; toRouteId: string }[] }).redirects ?? []) {
      lines.push(`${indent(3)}<redirect id="${escapeXml(redirect.id)}" from="${escapeXml(redirect.from)}" toRouteId="${escapeXml(redirect.toRouteId)}"/>`)
    }
    for (const componentKey of graph.ui.componentKeys ?? []) {
      lines.push(`${indent(3)}<componentKey value="${escapeXml(componentKey)}"/>`)
    }
    lines.push(`${indent(2)}</ui>`)
    lines.push(`${indent(2)}<serverRoutes>`)
    for (const route of server.routes) {
      lines.push(`${indent(3)}<route id="${escapeXml(route.id)}" mount="${escapeXml(route.mount)}"${listAttr('methods', route.methods)} auth="${escapeXml(route.auth)}" owner="${escapeXml(route.ownerModuleId)}"${listAttr('parserIds', route.parserIds)}${attr('notes', route.notes)}/>`)
    }
    lines.push(`${indent(2)}</serverRoutes>`)
    lines.push(`${indent(2)}<parsers>`)
    for (const parser of server.parsers) {
      lines.push(`${indent(3)}<parser id="${escapeXml(parser.id)}" kind="${escapeXml(parser.kind)}" mount="${escapeXml(parser.mount)}" owner="${escapeXml(parser.ownerModuleId)}"${attr('limit', parser.limit)}${attr('notes', parser.notes)}/>`)
    }
    lines.push(`${indent(2)}</parsers>`)
    lines.push(`${indent(2)}<websockets>`)
    for (const websocket of server.websockets) {
      lines.push(`${indent(3)}<websocket id="${escapeXml(websocket.id)}" path="${escapeXml(websocket.path)}" match="${escapeXml(websocket.match)}" auth="${escapeXml(websocket.auth)}" owner="${escapeXml(websocket.ownerModuleId)}"/>`)
    }
    lines.push(`${indent(2)}</websockets>`)
    lines.push(`${indent(2)}<storage owner="${escapeXml(server.storage.ownerModuleId)}" kind="${escapeXml(server.storage.kind)}"${listAttr('keys', server.storage.keys)}${listAttr('roots', server.storage.roots)}${listAttr('files', server.storage.files)}${listAttr('sharedWith', server.storage.sharedWith)}>${escapeXml(server.storage.notes)}</storage>`)
    lines.push(`${indent(2)}<lifecycle mode="${escapeXml(server.lifecycle.mode)}">`)
    for (const phase of ['startup', 'background', 'shutdown'] as const) {
      lines.push(`${indent(3)}<${phase}>`)
      for (const item of server.lifecycle[phase]) {
        lines.push(`${indent(4)}<item id="${escapeXml(item.id)}" owner="${escapeXml(item.ownerModuleId)}">${escapeXml(item.notes)}</item>`)
      }
      lines.push(`${indent(3)}</${phase}>`)
    }
    lines.push(`${indent(2)}</lifecycle>`)
    lines.push(`${indent(2)}<fileRoleSummary>`)
    for (const [role, count] of Object.entries(roles)) {
      lines.push(`${indent(3)}<role name="${escapeXml(role)}" count="${count}"/>`)
    }
    lines.push(`${indent(2)}</fileRoleSummary>`)
    lines.push(`${indent(1)}</module>`)
  }

  lines.push('</architectureRuntimeIndex>')
  return `${lines.join('\n')}\n`
}

function routeIndexXml(): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<architectureRouteIndex app="hammurabi" generatedBy="tools/generate-architecture-indexes.ts">',
    `${indent(1)}<frontendRoutes>`,
  ]
  for (const graph of HAMMURABI_MODULE_GRAPH) {
    for (const route of graph.ui.routes ?? []) {
      lines.push(`${indent(2)}<route id="${escapeXml(route.id)}" module="${escapeXml(graph.id)}" path="${escapeXml(route.path)}" componentKey="${escapeXml(route.componentKey)}"${listAttr('surfaces', route.surfaces)}${attr('navLabel', route.nav?.label)}${attr('navGroup', route.nav?.group)}${attr('hidden', (route.nav as { hidden?: boolean } | undefined)?.hidden ? 'true' : undefined)}/>`)
    }
    for (const redirect of (graph.ui as { redirects?: readonly { id: string; from: string; toRouteId: string }[] }).redirects ?? []) {
      lines.push(`${indent(2)}<redirect id="${escapeXml(redirect.id)}" module="${escapeXml(graph.id)}" from="${escapeXml(redirect.from)}" toRouteId="${escapeXml(redirect.toRouteId)}"/>`)
    }
  }
  lines.push(`${indent(1)}</frontendRoutes>`)
  lines.push(`${indent(1)}<apiRoutes>`)
  for (const manifest of HAMMURABI_MODULE_MANIFESTS) {
    for (const route of manifest.server.routes) {
      lines.push(`${indent(2)}<route id="${escapeXml(route.id)}" module="${escapeXml(manifest.graph.id)}" mount="${escapeXml(route.mount)}"${listAttr('methods', route.methods)} auth="${escapeXml(route.auth)}" owner="${escapeXml(route.ownerModuleId)}"${listAttr('parserIds', route.parserIds)}${attr('notes', route.notes)}/>`)
    }
  }
  lines.push(`${indent(1)}</apiRoutes>`)
  lines.push(`${indent(1)}<websockets>`)
  for (const manifest of HAMMURABI_MODULE_MANIFESTS) {
    for (const websocket of manifest.server.websockets) {
      lines.push(`${indent(2)}<websocket id="${escapeXml(websocket.id)}" module="${escapeXml(manifest.graph.id)}" path="${escapeXml(websocket.path)}" owner="${escapeXml(websocket.ownerModuleId)}" auth="${escapeXml(websocket.auth)}"/>`)
    }
  }
  lines.push(`${indent(1)}</websockets>`)
  lines.push(`${indent(1)}<parsers>`)
  for (const manifest of HAMMURABI_MODULE_MANIFESTS) {
    for (const parser of manifest.server.parsers) {
      lines.push(`${indent(2)}<parser id="${escapeXml(parser.id)}" module="${escapeXml(manifest.graph.id)}" kind="${escapeXml(parser.kind)}" mount="${escapeXml(parser.mount)}" owner="${escapeXml(parser.ownerModuleId)}"${attr('limit', parser.limit)}${attr('notes', parser.notes)}/>`)
    }
  }
  lines.push(`${indent(1)}</parsers>`)
  lines.push('</architectureRouteIndex>')
  return `${lines.join('\n')}\n`
}

function featureIndexXml(): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<architectureFeatureIndex app="hammurabi" generatedBy="tools/generate-architecture-indexes.ts">',
    `${indent(1)}<purpose>Map user-visible Hammurabi features to the UI components, hooks, API routes, runtime files, storage keys, tests, and architectural notes behind them.</purpose>`,
  ]

  for (const feature of features) {
    lines.push(`${indent(1)}<feature id="${escapeXml(feature.id)}" name="${escapeXml(feature.name)}" route="${escapeXml(feature.route)}"${listAttr('modules', feature.modules)}>`)
    lines.push(`${indent(2)}<userVisible>${escapeXml(feature.userVisible)}</userVisible>`)
    for (const section of ['ui', 'hooks', 'api', 'runtime', 'storage', 'tests', 'notes'] as const) {
      lines.push(`${indent(2)}<${section}>`)
      for (const value of feature[section]) {
        lines.push(`${indent(3)}<item value="${escapeXml(value)}"/>`)
      }
      lines.push(`${indent(2)}</${section}>`)
    }
    lines.push(`${indent(1)}</feature>`)
  }

  lines.push('</architectureFeatureIndex>')
  return `${lines.join('\n')}\n`
}

function conceptIndexXml(): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<architectureConceptIndex app="hammurabi" generatedBy="tools/generate-architecture-indexes.ts">',
    `${indent(1)}<purpose>Define Hammurabi concepts in terms of ownership, user-visible effect, and source files so diagrams and fixes do not mix domains.</purpose>`,
  ]
  for (const concept of concepts) {
    lines.push(`${indent(1)}<concept id="${escapeXml(concept.id)}" name="${escapeXml(concept.name)}">`)
    lines.push(`${indent(2)}<meaning>${escapeXml(concept.meaning)}</meaning>`)
    lines.push(`${indent(2)}<userEffect>${escapeXml(concept.userEffect)}</userEffect>`)
    lines.push(`${indent(2)}<owners>`)
    for (const owner of concept.owners) {
      lines.push(`${indent(3)}<owner value="${escapeXml(owner)}"/>`)
    }
    lines.push(`${indent(2)}</owners>`)
    lines.push(`${indent(2)}<files>`)
    for (const file of concept.files) {
      lines.push(`${indent(3)}<file path="${escapeXml(file)}"/>`)
    }
    lines.push(`${indent(2)}</files>`)
    if (concept.avoidConfusingWith) {
      lines.push(`${indent(2)}<avoidConfusingWith>${escapeXml(concept.avoidConfusingWith)}</avoidConfusingWith>`)
    }
    lines.push(`${indent(1)}</concept>`)
  }
  lines.push('</architectureConceptIndex>')
  return `${lines.join('\n')}\n`
}

function observationsXml(): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<architectureSourceObservations app="hammurabi" generatedBy="tools/generate-architecture-indexes.ts">',
    `${indent(1)}<purpose>Capture current-state observations and source/doc drift found during the architecture mapping pass so future readers know where source-of-truth checks matter.</purpose>`,
  ]
  for (const observation of observations) {
    lines.push(`${indent(1)}<observation id="${escapeXml(observation.id)}" kind="${escapeXml(observation.kind)}">`)
    lines.push(`${indent(2)}<summary>${escapeXml(observation.summary)}</summary>`)
    lines.push(`${indent(2)}<userEffect>${escapeXml(observation.userEffect)}</userEffect>`)
    lines.push(`${indent(2)}<evidence>`)
    for (const evidence of observation.evidence) {
      lines.push(`${indent(3)}<file path="${escapeXml(evidence)}"/>`)
    }
    lines.push(`${indent(2)}</evidence>`)
    lines.push(`${indent(2)}<recommendation>${escapeXml(observation.recommendation)}</recommendation>`)
    lines.push(`${indent(1)}</observation>`)
  }
  lines.push('</architectureSourceObservations>')
  return `${lines.join('\n')}\n`
}

function buildVisualizerHtml(files: FileEntry[], directories: DirectoryEntry[]): string {
  const featureData = features.map((feature) => ({
    id: feature.id,
    name: feature.name,
    route: feature.route,
    userVisible: feature.userVisible,
    modules: feature.modules,
    ui: feature.ui,
    hooks: feature.hooks,
    api: feature.api,
    runtime: feature.runtime,
    storage: feature.storage,
    tests: feature.tests,
    notes: feature.notes,
  }))
  const moduleData = HAMMURABI_MODULE_MANIFESTS.map((manifest) => {
    const moduleFiles = filesForModule(files, manifest.graph.id)
    return {
      id: manifest.graph.id,
      label: manifest.graph.label,
      status: manifest.graph.status,
      summary: manifest.graph.summary,
      files: moduleFiles.length,
      roles: roleSummary(moduleFiles),
      uiRoutes: manifest.graph.ui.routes?.map((route) => route.path) ?? [],
      apiRoutes: manifest.server.routes.map((route) => route.mount),
      websockets: manifest.server.websockets.map((websocket) => websocket.path),
      storage: manifest.server.storage.keys ?? [],
      capabilities: manifest.graph.capabilities,
    }
  })
  const directoryData = directories.map((directory) => ({
    path: directory.path,
    moduleId: directory.moduleId,
    sourceArea: directory.sourceArea,
    files: directory.directFiles.map((file) => ({ path: file.path, role: file.role, moduleId: file.moduleId })),
  }))
  const data = {
    generatedBy: 'tools/generate-architecture-indexes.ts',
    sourceFiles: files.length,
    directories: directories.length,
    features: featureData,
    modules: moduleData,
    concepts,
    observations,
    tree: directoryData,
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hammurabi Architecture Index Visualizer</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --text: #23251f;
      --muted: #687064;
      --line: #d9ddcf;
      --accent: #2e6f68;
      --accent-2: #8b5e34;
      --code: #f1f3eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid var(--line);
      background: rgba(247, 247, 244, 0.94);
      backdrop-filter: blur(10px);
      padding: 14px 18px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      letter-spacing: 0;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 360px) repeat(3, max-content);
      gap: 8px;
      align-items: center;
    }
    input, select, button {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      border-radius: 6px;
      min-height: 34px;
      padding: 7px 10px;
      font: inherit;
    }
    button {
      cursor: pointer;
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    main {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      gap: 14px;
      padding: 14px;
    }
    aside, section.panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-width: 0;
    }
    aside {
      position: sticky;
      top: 92px;
      height: calc(100vh - 112px);
      overflow: auto;
      padding: 12px;
    }
    .panel {
      padding: 14px;
      margin-bottom: 14px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
    }
    .stat strong {
      display: block;
      font-size: 22px;
    }
    .feature, .module, .concept {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
      background: #fffefa;
    }
    .feature h3, .module h3, .concept h3 {
      margin: 0 0 4px;
      font-size: 16px;
    }
    .muted { color: var(--muted); }
    .pill-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
    .pill {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      background: #f7f8f1;
      font-size: 12px;
      color: #394037;
    }
    details {
      border-top: 1px solid var(--line);
      padding-top: 8px;
      margin-top: 8px;
    }
    summary { cursor: pointer; font-weight: 650; }
    code {
      display: inline-block;
      max-width: 100%;
      overflow-wrap: anywhere;
      background: var(--code);
      border-radius: 4px;
      padding: 1px 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    ul { margin: 6px 0 0; padding-left: 18px; }
    li { margin: 3px 0; }
    .tree-dir {
      border-left: 2px solid var(--line);
      padding-left: 10px;
      margin: 8px 0;
    }
    .tree-file {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      gap: 8px;
      align-items: baseline;
      padding: 2px 0;
    }
    .role {
      color: var(--accent-2);
      font-size: 12px;
    }
    .hidden { display: none !important; }
    @media (max-width: 900px) {
      .toolbar { grid-template-columns: 1fr; }
      main { grid-template-columns: 1fr; }
      aside { position: static; height: auto; max-height: 42vh; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Hammurabi Architecture Index Visualizer</h1>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Search feature, module, route, file, concept">
      <select id="view">
        <option value="features">Features</option>
        <option value="modules">Modules</option>
        <option value="concepts">Concepts</option>
        <option value="observations">Observations</option>
        <option value="tree">Source Tree</option>
      </select>
      <button id="expand">Expand</button>
      <button id="collapse">Collapse</button>
    </div>
  </header>
  <main>
    <aside>
      <div class="stats">
        <div class="stat"><strong id="featureCount">0</strong><span>features</span></div>
        <div class="stat"><strong id="moduleCount">0</strong><span>modules</span></div>
        <div class="stat"><strong id="fileCount">0</strong><span>files</span></div>
      </div>
      <p class="muted">Canonical XML lives beside this page: source-tree.xml, runtime-index.xml, route-index.xml, feature-index.xml, and concept-index.xml.</p>
      <div id="nav"></div>
    </aside>
    <div>
      <section id="features" class="panel"></section>
      <section id="modules" class="panel hidden"></section>
      <section id="concepts" class="panel hidden"></section>
      <section id="observations" class="panel hidden"></section>
      <section id="tree" class="panel hidden"></section>
    </div>
  </main>
  <script id="architecture-data" type="application/json">${JSON.stringify(data)}</script>
  <script>
    const data = JSON.parse(document.getElementById('architecture-data').textContent);
    const search = document.getElementById('search');
    const view = document.getElementById('view');
    const sections = ['features', 'modules', 'concepts', 'observations', 'tree'];
    document.getElementById('featureCount').textContent = data.features.length;
    document.getElementById('moduleCount').textContent = data.modules.length;
    document.getElementById('fileCount').textContent = data.sourceFiles;

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
    const list = (items) => '<ul>' + (items || []).map((item) => '<li><code>' + esc(item) + '</code></li>').join('') + '</ul>';
    const pills = (items) => '<div class="pill-row">' + (items || []).map((item) => '<span class="pill">' + esc(item) + '</span>').join('') + '</div>';
    const searchable = (node, text) => JSON.stringify(node).toLowerCase().includes(text.toLowerCase());

    function renderFeatures() {
      const q = search.value.trim();
      document.getElementById('features').innerHTML = '<h2>Features To Components</h2>' + data.features
        .filter((feature) => !q || searchable(feature, q))
        .map((feature) => '<article class="feature" id="feature-' + esc(feature.id) + '">' +
          '<h3>' + esc(feature.name) + '</h3>' +
          '<div class="muted">' + esc(feature.route) + '</div>' +
          '<p>' + esc(feature.userVisible) + '</p>' +
          pills(feature.modules) +
          ['ui', 'hooks', 'api', 'runtime', 'storage', 'tests', 'notes'].map((section) =>
            '<details><summary>' + section + '</summary>' + list(feature[section]) + '</details>'
          ).join('') +
        '</article>').join('');
    }

    function renderModules() {
      const q = search.value.trim();
      document.getElementById('modules').innerHTML = '<h2>Modules And Runtime Surface</h2>' + data.modules
        .filter((module) => !q || searchable(module, q))
        .map((module) => '<article class="module" id="module-' + esc(module.id) + '">' +
          '<h3>' + esc(module.label) + ' <span class="pill">' + esc(module.status) + '</span></h3>' +
          '<p>' + esc(module.summary) + '</p>' +
          '<div class="muted">' + esc(module.files) + ' files</div>' +
          '<details open><summary>UI routes</summary>' + list(module.uiRoutes) + '</details>' +
          '<details><summary>API routes</summary>' + list(module.apiRoutes) + '</details>' +
          '<details><summary>WebSockets</summary>' + list(module.websockets) + '</details>' +
          '<details><summary>Storage</summary>' + list(module.storage) + '</details>' +
          '<details><summary>File roles</summary>' + list(Object.entries(module.roles).map(([role, count]) => role + ': ' + count)) + '</details>' +
        '</article>').join('');
    }

    function renderConcepts() {
      const q = search.value.trim();
      document.getElementById('concepts').innerHTML = '<h2>Concepts</h2>' + data.concepts
        .filter((concept) => !q || searchable(concept, q))
        .map((concept) => '<article class="concept" id="concept-' + esc(concept.id) + '">' +
          '<h3>' + esc(concept.name) + '</h3>' +
          '<p>' + esc(concept.meaning) + '</p>' +
          '<p class="muted">' + esc(concept.userEffect) + '</p>' +
          (concept.avoidConfusingWith ? '<p><strong>Avoid confusing with:</strong> ' + esc(concept.avoidConfusingWith) + '</p>' : '') +
          '<details><summary>Owners</summary>' + list(concept.owners) + '</details>' +
          '<details><summary>Files</summary>' + list(concept.files) + '</details>' +
        '</article>').join('');
    }

    function renderObservations() {
      const q = search.value.trim();
      document.getElementById('observations').innerHTML = '<h2>Source Observations</h2>' + data.observations
        .filter((observation) => !q || searchable(observation, q))
        .map((observation) => '<article class="concept" id="observation-' + esc(observation.id) + '">' +
          '<h3>' + esc(observation.summary) + ' <span class="pill">' + esc(observation.kind) + '</span></h3>' +
          '<p class="muted">' + esc(observation.userEffect) + '</p>' +
          '<p><strong>Recommendation:</strong> ' + esc(observation.recommendation) + '</p>' +
          '<details><summary>Evidence</summary>' + list(observation.evidence) + '</details>' +
        '</article>').join('');
    }

    function renderTree() {
      const q = search.value.trim();
      document.getElementById('tree').innerHTML = '<h2>Directory By Directory File Map</h2>' + data.tree
        .filter((directory) => !q || searchable(directory, q))
        .map((directory) => '<div class="tree-dir">' +
          '<h3><code>' + esc(directory.path) + '</code></h3>' +
          '<div class="muted">' + esc(directory.sourceArea) + (directory.moduleId ? ' / ' + esc(directory.moduleId) : '') + '</div>' +
          directory.files.map((file) => '<div class="tree-file"><code>' + esc(file.path) + '</code><span class="role">' + esc(file.role) + '</span></div>').join('') +
        '</div>').join('');
    }

    function renderNav() {
      const current = view.value;
      const source = current === 'features' ? data.features : current === 'modules' ? data.modules : current === 'concepts' ? data.concepts : current === 'observations' ? data.observations : data.tree;
      document.getElementById('nav').innerHTML = source.slice(0, 160).map((item) => {
        const label = item.name || item.label || item.summary || item.path;
        const id = current === 'features' ? 'feature-' + item.id : current === 'modules' ? 'module-' + item.id : current === 'concepts' ? 'concept-' + item.id : current === 'observations' ? 'observation-' + item.id : '';
        return id ? '<p><a href="#' + esc(id) + '">' + esc(label) + '</a></p>' : '<p><code>' + esc(label) + '</code></p>';
      }).join('');
    }

    function render() {
      sections.forEach((id) => document.getElementById(id).classList.toggle('hidden', id !== view.value));
      renderFeatures();
      renderModules();
      renderConcepts();
      renderObservations();
      renderTree();
      renderNav();
    }

    search.addEventListener('input', render);
    view.addEventListener('change', render);
    document.getElementById('expand').addEventListener('click', () => document.querySelectorAll('details').forEach((node) => node.open = true));
    document.getElementById('collapse').addEventListener('click', () => document.querySelectorAll('details').forEach((node) => node.open = false));
    render();
  </script>
</body>
</html>
`
}

function readmeMarkdown(files: FileEntry[], directories: DirectoryEntry[]): string {
  return `# Hammurabi Architecture Indexes

Generated by \`tools/generate-architecture-indexes.ts\` from live module manifests and a source-tree scan.

## Files

- \`source-tree.xml\`: directory-by-directory and file-by-file architecture map for \`src\`, \`server\`, \`modules\`, \`ios\`, \`assets\`, \`public\`, and \`tools\`.
- \`runtime-index.xml\`: module manifest, runtime, route, parser, websocket, lifecycle, storage, dependency, and capability index.
- \`route-index.xml\`: frontend routes, API routes, parsers, and websocket mounts.
- \`feature-index.xml\`: user-visible features mapped to UI components, hooks, APIs, runtime files, storage, and tests.
- \`concept-index.xml\`: concept glossary for runtime, route ids, channels, conversations, workspace targets, skills, queues, and retired roots.
- \`source-observations.xml\`: current-state and drift notes discovered during source mapping.
- \`architecture-visualizer.html\`: self-contained browser page for exploring the generated indexes.

## Coverage

- Source files scanned: ${files.length}
- Directories scanned: ${directories.length}
- User-visible features mapped: ${features.length}
- Runtime modules mapped: ${HAMMURABI_MODULE_MANIFESTS.length}
- Source observations recorded: ${observations.length}

Regenerate after structural changes with:

\`\`\`bash
pnpm --filter hammurabi exec tsx tools/generate-architecture-indexes.ts
\`\`\`
`
}

async function main(): Promise<void> {
  const files = (await Promise.all(scannedRoots.map((root) => walkFiles(root)))).flat()
  const directories = buildDirectories(files)

  await mkdir(outputDir, { recursive: true })
  await writeFile(path.join(outputDir, 'source-tree.xml'), sourceTreeXml(files, directories), 'utf8')
  await writeFile(path.join(outputDir, 'runtime-index.xml'), runtimeIndexXml(files), 'utf8')
  await writeFile(path.join(outputDir, 'route-index.xml'), routeIndexXml(), 'utf8')
  await writeFile(path.join(outputDir, 'feature-index.xml'), featureIndexXml(), 'utf8')
  await writeFile(path.join(outputDir, 'concept-index.xml'), conceptIndexXml(), 'utf8')
  await writeFile(path.join(outputDir, 'source-observations.xml'), observationsXml(), 'utf8')
  await writeFile(path.join(outputDir, 'architecture-visualizer.html'), buildVisualizerHtml(files, directories), 'utf8')
  await writeFile(path.join(outputDir, 'README.md'), readmeMarkdown(files, directories), 'utf8')

  const llms = await readFile(path.join(appRoot, 'docs/llms.txt'), 'utf8').catch(() => '')
  if (llms && !llms.includes('architecture/indexes/feature-index.xml')) {
    console.warn('docs/llms.txt does not yet reference docs/architecture/indexes/feature-index.xml')
  }

  console.log(`Generated ${files.length} source file entries across ${directories.length} directories.`)
  console.log(`Wrote architecture indexes to ${path.relative(appRoot, outputDir)}.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
