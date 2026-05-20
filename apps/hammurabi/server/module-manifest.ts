import { HAMMURABI_MODULE_GRAPH } from '../src/module-manifest.js'
import { MESSAGE_IMAGE_JSON_BODY_LIMIT } from '../modules/agents/message-images.js'
import type {
  HammurabiLifecycleDeclaration,
  HammurabiModuleManifest,
  HammurabiModuleServerMetadata,
  HammurabiStorageOwnership,
} from '../src/types/module-manifest.js'

function noLifecycle(): HammurabiLifecycleDeclaration {
  return {
    mode: 'none',
    startup: [],
    background: [],
    shutdown: [],
  }
}

function storage(
  ownerModuleId: string,
  kind: HammurabiStorageOwnership['kind'],
  notes: string,
  fields: Partial<Omit<HammurabiStorageOwnership, 'kind' | 'ownerModuleId' | 'notes'>> = {},
): HammurabiStorageOwnership {
  return {
    kind,
    ownerModuleId,
    keys: fields.keys ?? [],
    roots: fields.roots ?? [],
    files: fields.files ?? [],
    sharedWith: fields.sharedWith,
    notes,
  }
}

export const HAMMURABI_MODULE_SERVER_METADATA = [
  {
    id: 'agents',
    directory: 'agents',
    serverOnly: true,
    routes: [
      {
        id: 'agents.api',
        surface: 'api',
        mount: '/api/agents',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'agents',
        parserIds: ['agents.image-json', 'agents.upload-multipart'],
        notes: 'Mounted through the manifest-backed runtime registration.',
      },
      {
        id: 'agents.providers-api',
        surface: 'api',
        mount: '/api/providers',
        methods: ['GET'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'agents',
        notes: 'Provider registry endpoint is backed by modules/agents/providers.',
      },
    ],
    parsers: [
      {
        id: 'agents.image-json',
        kind: 'json',
        mount: '/api/agents',
        ownerModuleId: 'agents',
        limit: MESSAGE_IMAGE_JSON_BODY_LIMIT,
        notes: 'Large JSON parser for image-bearing queue/send/message endpoints.',
      },
      {
        id: 'agents.upload-multipart',
        kind: 'multipart-disk',
        mount: '/api/agents/upload',
        ownerModuleId: 'agents',
        notes: 'Discovery upload middleware owned by the agents route set.',
      },
    ],
    websockets: [
      {
        id: 'agents.session-stream',
        path: '/api/agents/sessions/:name/ws',
        match: 'exact',
        auth: 'api-key-or-auth0',
        ownerModuleId: 'agents',
      },
      {
        id: 'agents.daemon-channel',
        path: '/api/agents/daemons/ws',
        match: 'exact',
        auth: 'pairing-token',
        ownerModuleId: 'agents',
        notes: 'Outbound machine daemon channel authenticated by one-time pairing token hash stored on the machine record.',
      },
    ],
    lifecycle: {
      mode: 'shutdown',
      startup: [],
      background: [],
      shutdown: [
        {
          id: 'agents.sessions.shutdown',
          ownerModuleId: 'agents',
          notes: 'Stops provider runtimes through the sessions interface.',
        },
      ],
    },
    storage: storage('agents', 'owned', 'Agent runtime state is persisted under the Hammurabi data root.', {
      keys: ['agents.stream-sessions', 'agents.machines', 'agents.transcripts'],
      roots: ['${HAMMURABI_DATA_DIR}/agents'],
      files: ['stream-sessions.json'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[0].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[0].capabilities,
  },
  {
    id: 'api-keys',
    directory: 'api-keys',
    serverOnly: true,
    routes: [
      {
        id: 'api-keys.api',
        surface: 'api',
        mount: '/api/auth',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        auth: 'api-key',
        ownerModuleId: 'api-keys',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: {
      mode: 'startup',
      startup: [
        {
          id: 'api-keys.bootstrap-default-master-key',
          ownerModuleId: 'api-keys',
          notes: 'Server startup inspects bootstrap key state before module route mounting.',
        },
      ],
      background: [],
      shutdown: [],
    },
    storage: storage('api-keys', 'owned', 'API keys and provider secrets are server-side credential data.', {
      keys: ['api-keys.keys', 'api-keys.provider-secrets'],
      roots: ['${HAMMURABI_DATA_DIR}/api-keys', '${HAMMURABI_DATA_DIR}/settings'],
      files: ['keys.json'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[1].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[1].capabilities,
  },
  {
    id: 'approvals',
    directory: 'approvals',
    serverOnly: true,
    routes: [
      {
        id: 'approvals.api',
        surface: 'api',
        mount: '/api/approvals',
        methods: ['GET'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'approvals',
      },
    ],
    parsers: [],
    websockets: [
      {
        id: 'approvals.pending-stream',
        path: '/api/approvals/stream',
        match: 'exact',
        auth: 'api-key-or-auth0',
        ownerModuleId: 'approvals',
      },
    ],
    lifecycle: noLifecycle(),
    storage: storage('approvals', 'shared', 'Approval queue and audit files are currently implemented by the policies pending store.', {
      keys: ['approvals.pending', 'approvals.audit'],
      roots: ['${HAMMURABI_DATA_DIR}/policies'],
      files: ['pending.json', 'audit.jsonl'],
      sharedWith: ['policies'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[2].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[2].capabilities,
  },
  {
    id: 'automations',
    directory: 'automations',
    serverOnly: true,
    routes: [
      {
        id: 'automations.api',
        surface: 'api',
        mount: '/api/automations',
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'automations',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: {
      mode: 'combined',
      startup: [
        {
          id: 'automations.scheduler.initialize',
          ownerModuleId: 'automations',
          notes: 'Scheduler initialization is owned by the automations runtime registration.',
        },
      ],
      background: [
        {
          id: 'automations.internal-quest-schedules',
          ownerModuleId: 'automations',
          notes: 'Registers internal transcript maintenance schedules.',
        },
      ],
      shutdown: [
        {
          id: 'automations.scheduler.shutdown',
          ownerModuleId: 'automations',
          notes: 'Stops automation cron jobs, internal schedules, and quest-event subscriptions.',
        },
      ],
    },
    storage: storage('automations', 'owned', 'Automation definitions and run artifacts live under the automation store root.', {
      keys: ['automations.definitions', 'automations.runs', 'automations.memory'],
      roots: ['${HAMMURABI_DATA_DIR}/commander/automations'],
      files: ['*.json', 'runs/*.json', 'runs/*.md', 'memory.md'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[3].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[3].capabilities,
  },
  {
    id: 'channels',
    directory: 'channels',
    serverOnly: true,
    routes: [
      {
        id: 'channels.api',
        surface: 'api',
        mount: '/api/commanders/:id/channels',
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'channels',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: {
      mode: 'combined',
      startup: [
        {
          id: 'channels.adapters.start',
          ownerModuleId: 'channels',
          notes: 'Registers channel adapters and starts enabled channel-account runtimes.',
        },
      ],
      background: [],
      shutdown: [
        {
          id: 'channels.adapters.shutdown',
          ownerModuleId: 'channels',
          notes: 'Stops active channel adapter runtimes.',
        },
      ],
    },
    storage: storage('channels', 'owned', 'Commander channel bindings, surface bindings, email attachment caches, and WhatsApp auth state are persisted independently from commander sessions.', {
      keys: ['channels.bindings', 'channels.surface-bindings', 'channels.email-attachments', 'channels.whatsapp-auth'],
      roots: ['${HAMMURABI_DATA_DIR}'],
      files: ['channels.json', 'channels/surface-bindings.json', 'commander/<id>/secrets.enc', 'commander/channels/email/**', 'channels/whatsapp/**'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[4].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[4].capabilities,
  },
  {
    id: 'command-room',
    directory: 'command-room',
    serverOnly: true,
    routes: [],
    parsers: [],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('command-room', 'none', 'Command Room is a composed UI surface; durable data belongs to consumed modules.'),
    dependencies: HAMMURABI_MODULE_GRAPH[5].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[5].capabilities,
  },
  {
    id: 'commanders',
    directory: 'commanders',
    serverOnly: true,
    routes: [
      {
        id: 'commanders.api',
        surface: 'api',
        mount: '/api/commanders',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'commanders',
        parserIds: ['commanders.avatar-multipart'],
      },
      {
        id: 'commanders.quests-api',
        surface: 'api',
        mount: '/api/commanders/:id/quests',
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'commanders',
      },
    ],
    parsers: [
      {
        id: 'commanders.avatar-multipart',
        kind: 'multipart-memory',
        mount: '/api/commanders/:id/avatar',
        ownerModuleId: 'commanders',
      },
    ],
    websockets: [],
    lifecycle: {
      mode: 'shutdown',
      startup: [],
      background: [],
      shutdown: [
        {
          id: 'commanders.router.dispose',
          ownerModuleId: 'commanders',
          notes: 'Router result exposes the commanders shutdown hook.',
        },
      ],
    },
    storage: storage('commanders', 'owned', 'Commander profile, memory, quest, heartbeat, and transcript data share the commander data root.', {
      keys: ['commanders.sessions', 'commanders.names', 'commanders.memory', 'commanders.quests', 'commanders.transcripts'],
      roots: ['${HAMMURABI_DATA_DIR}/commander'],
      files: ['sessions.json', 'names.json', '<commander-id>/**'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[6].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[6].capabilities,
  },
  {
    id: 'components',
    directory: 'components',
    serverOnly: true,
    routes: [],
    parsers: [],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('components', 'none', 'Shared UI primitives do not own server storage.'),
    dependencies: HAMMURABI_MODULE_GRAPH[7].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[7].capabilities,
  },
  {
    id: 'conversation',
    directory: 'conversation',
    serverOnly: true,
    routes: [
      {
        id: 'conversation.api',
        surface: 'api',
        mount: '/api/conversations',
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'conversation',
        parserIds: ['conversation.image-json'],
        notes: 'Implemented through the commanders router result today.',
      },
    ],
    parsers: [
      {
        id: 'conversation.image-json',
        kind: 'json',
        mount: '/api/conversations',
        ownerModuleId: 'conversation',
        limit: MESSAGE_IMAGE_JSON_BODY_LIMIT,
        notes: 'Large JSON parser for image-bearing conversation message endpoints.',
      },
    ],
    websockets: [
      {
        id: 'conversation.session-stream',
        path: '/api/conversations/:id/ws',
        match: 'exact',
        auth: 'api-key-or-auth0',
        ownerModuleId: 'conversation',
        notes: 'Conversation-owned stream alias resolved server-side to the active agent session.',
      },
    ],
    lifecycle: noLifecycle(),
    storage: storage('conversation', 'shared', 'Conversation records currently share the commander data root.', {
      keys: ['commanders.conversations'],
      roots: ['${HAMMURABI_DATA_DIR}/commander'],
      sharedWith: ['commanders'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[8].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[8].capabilities,
  },
  {
    id: 'onboarding',
    directory: 'onboarding',
    serverOnly: true,
    routes: [
      {
        id: 'onboarding.api',
        surface: 'api',
        mount: '/api/onboarding',
        methods: ['GET', 'POST'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'onboarding',
        parserIds: ['onboarding.json'],
        notes: 'Backend-owned first-run status projection and idempotent onboarding actions.',
      },
    ],
    parsers: [
      {
        id: 'onboarding.json',
        kind: 'json',
        mount: '/api/onboarding',
        ownerModuleId: 'onboarding',
      },
    ],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('onboarding', 'shared', 'Onboarding projects existing org, operator, commander, provider, and machine setup state without owning a durable store.', {
      sharedWith: ['org', 'operators', 'commanders', 'agents'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[9].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[9].capabilities,
  },
  {
    id: 'operators',
    directory: 'operators',
    serverOnly: true,
    routes: [
      {
        id: 'operators.api',
        surface: 'api',
        mount: '/api/operators',
        methods: ['GET', 'PATCH', 'POST'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'operators',
        parserIds: ['operators.avatar-multipart'],
      },
    ],
    parsers: [
      {
        id: 'operators.avatar-multipart',
        kind: 'multipart-memory',
        mount: '/api/operators/founder/avatar',
        ownerModuleId: 'operators',
      },
    ],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('operators', 'owned', 'Operator profiles and avatars are stored by the operator module.', {
      keys: ['operators.profiles', 'operators.avatars'],
      roots: ['${HAMMURABI_DATA_DIR}/operators'],
      files: ['operators.json', 'avatars/**'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[10].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[10].capabilities,
  },
  {
    id: 'org',
    directory: 'org',
    serverOnly: true,
    routes: [
      {
        id: 'org.api',
        surface: 'api',
        mount: '/api/org',
        methods: ['GET', 'POST'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'org',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: {
      mode: 'startup',
      startup: [
        {
          id: 'org.founder-bootstrap-read-model',
          ownerModuleId: 'org',
          notes: 'Org route can bootstrap founder-linked data when a real authenticated human initializes the org.',
        },
      ],
      background: [],
      shutdown: [],
    },
    storage: storage('org', 'shared', 'Org reads and setup writes coordinate stores owned by commanders, operators, automations, and org identity.', {
      keys: ['org.identity', 'operators.profiles', 'commanders.sessions', 'automations.definitions'],
      sharedWith: ['commanders', 'operators', 'org-identity', 'automations'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[11].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[11].capabilities,
  },
  {
    id: 'org-identity',
    directory: 'org-identity',
    serverOnly: true,
    routes: [
      {
        id: 'org-identity.api',
        surface: 'api',
        mount: '/api/org/identity',
        methods: ['GET', 'PATCH'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'org-identity',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('org-identity', 'owned', 'Organization identity is a distinct store surfaced through org and settings UI.', {
      keys: ['org.identity'],
      roots: ['${HAMMURABI_DATA_DIR}/org'],
      files: ['identity.json'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[12].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[12].capabilities,
  },
  {
    id: 'policies',
    directory: 'policies',
    serverOnly: true,
    routes: [
      {
        id: 'policies.api',
        surface: 'api',
        mount: '/api/action-policies',
        methods: ['GET', 'PUT'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'policies',
      },
      {
        id: 'approval-check.api',
        surface: 'api',
        mount: '/api/approval',
        methods: ['GET', 'POST'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'policies',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: {
      mode: 'shutdown',
      startup: [],
      background: [],
      shutdown: [
        {
          id: 'policies.approval-coordinator.shutdown',
          ownerModuleId: 'policies',
          notes: 'Clears pending approval timeout timers.',
        },
      ],
    },
    storage: storage('policies', 'owned', 'Action policies and approval coordinator snapshots live under the policies data root.', {
      keys: ['policies.rules', 'approvals.pending', 'approvals.audit'],
      roots: ['${HAMMURABI_DATA_DIR}/policies'],
      files: ['policies.json', 'pending.json', 'audit.jsonl'],
      sharedWith: ['approvals'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[13].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[13].capabilities,
  },
  {
    id: 'quests',
    directory: 'quests',
    serverOnly: true,
    routes: [],
    parsers: [],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('quests', 'shared', 'Quest data is owned by the commanders quest store today.', {
      keys: ['commanders.quests'],
      roots: ['${HAMMURABI_DATA_DIR}/commander'],
      sharedWith: ['commanders'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[14].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[14].capabilities,
  },
  {
    id: 'rpg',
    directory: 'rpg',
    serverOnly: true,
    routes: [],
    parsers: [],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('rpg', 'none', 'RPG is an experimental client visualization over agents and commanders data.'),
    dependencies: HAMMURABI_MODULE_GRAPH[15].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[15].capabilities,
  },
  {
    id: 'sentinels',
    directory: 'sentinels',
    serverOnly: true,
    routes: [
      {
        id: 'sentinels.legacy-api',
        surface: 'api',
        mount: '/api/sentinels',
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'sentinels',
        notes: 'Legacy route factory exists but is not mounted by the current module registry.',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: {
      mode: 'background',
      startup: [],
      background: [
        {
          id: 'sentinels.legacy-scheduler',
          ownerModuleId: 'sentinels',
          notes: 'Legacy scheduler remains classified as retired until reactivated by a later task.',
        },
      ],
      shutdown: [],
    },
    storage: storage('sentinels', 'owned', 'Retired sentinel data has explicit legacy ownership for migration or deletion.', {
      keys: ['sentinels.legacy'],
      roots: ['${HAMMURABI_DATA_DIR}/sentinels'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[16].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[16].capabilities,
  },
  {
    id: 'settings',
    directory: 'settings',
    serverOnly: true,
    routes: [
      {
        id: 'settings.api',
        surface: 'api',
        mount: '/api/settings',
        methods: ['GET', 'PATCH'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'settings',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('settings', 'owned', 'Application settings, including theme, are persisted by the settings store.', {
      keys: ['settings.app'],
      roots: ['${HAMMURABI_DATA_DIR}/settings'],
      files: ['settings.json'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[17].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[17].capabilities,
  },
  {
    id: 'skills',
    directory: 'skills',
    serverOnly: true,
    routes: [
      {
        id: 'skills.api',
        surface: 'api',
        mount: '/api/skills',
        methods: ['GET', 'PUT'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'skills',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('skills', 'external', 'Skills reads installed skill directories and commander skill config/history roots.', {
      keys: ['skills.config', 'skills.history'],
      roots: ['${COMMANDER_DATA_DIR}', '~/.claude/skills', '~/.codex/skills'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[18].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[18].capabilities,
  },
  {
    id: 'telemetry',
    directory: 'telemetry',
    serverOnly: true,
    routes: [
      {
        id: 'telemetry.api',
        surface: 'api',
        mount: '/api/telemetry',
        methods: ['GET', 'DELETE'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'telemetry',
      },
      {
        id: 'telemetry.otel-api',
        surface: 'api',
        mount: '/v1',
        methods: ['POST'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'telemetry',
        parserIds: ['telemetry.otel-json'],
      },
    ],
    parsers: [
      {
        id: 'telemetry.otel-json',
        kind: 'json',
        mount: '/v1',
        ownerModuleId: 'telemetry',
        limit: '5mb',
        notes: 'OTEL receiver is intentionally mounted before the global JSON parser.',
      },
    ],
    websockets: [],
    lifecycle: {
      mode: 'combined',
      startup: [],
      background: [
        {
          id: 'telemetry.local-scanner',
          ownerModuleId: 'telemetry',
          notes: 'Runs an immediate local telemetry scan and, when configured, a recurring scan interval.',
        },
      ],
      shutdown: [
        {
          id: 'telemetry.local-scanner.shutdown',
          ownerModuleId: 'telemetry',
          notes: 'Clears the optional recurring local telemetry scan interval.',
        },
      ],
    },
    storage: storage('telemetry', 'owned', 'Telemetry events are stored by the telemetry module.', {
      keys: ['telemetry.events'],
      roots: ['${HAMMURABI_DATA_DIR}/telemetry'],
      files: ['events.jsonl'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[19].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[19].capabilities,
  },
  {
    id: 'workspace',
    directory: 'workspace',
    serverOnly: true,
    routes: [
      {
        id: 'workspace.api',
        surface: 'api',
        mount: '/api/workspace',
        methods: ['GET', 'POST', 'PUT'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'workspace',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('workspace', 'owned', 'Workspace targets and preferences are stored under the workspace module data root.', {
      keys: ['workspace.conversation-targets', 'workspace.preferences'],
      roots: ['${HAMMURABI_DATA_DIR}/workspace'],
      files: ['conversation-targets.json', 'preferences.json'],
    }),
    dependencies: HAMMURABI_MODULE_GRAPH[20].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[20].capabilities,
  },
  {
    id: 'module-graph',
    directory: 'module-graph',
    serverOnly: true,
    routes: [
      {
        id: 'module-graph.api',
        surface: 'api',
        mount: '/api/modules',
        methods: ['GET'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'module-graph',
      },
    ],
    parsers: [],
    websockets: [],
    lifecycle: noLifecycle(),
    storage: storage('module-graph', 'none', 'Module graph is derived from manifests and runtime provider registry summaries.'),
    dependencies: HAMMURABI_MODULE_GRAPH[21].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[21].capabilities,
  },
  {
    id: 'realtime',
    directory: 'realtime',
    serverOnly: true,
    routes: [
      {
        id: 'realtime.api',
        surface: 'api',
        mount: '/api/realtime',
        methods: ['GET', 'POST'],
        auth: 'api-key-or-auth0',
        ownerModuleId: 'realtime',
      },
    ],
    parsers: [],
    websockets: [
      {
        id: 'realtime.transcription',
        path: '/api/realtime/transcription',
        match: 'exact',
        auth: 'api-key-or-auth0',
        ownerModuleId: 'realtime',
      },
    ],
    lifecycle: noLifecycle(),
    storage: storage('realtime', 'none', 'Realtime proxy is stateless; transcription credentials are owned by api-keys.'),
    dependencies: HAMMURABI_MODULE_GRAPH[22].dependencies,
    capabilities: HAMMURABI_MODULE_GRAPH[22].capabilities,
  },
] as const satisfies readonly HammurabiModuleServerMetadata[]

const serverMetadataById: ReadonlyMap<string, HammurabiModuleServerMetadata> = new Map(
  HAMMURABI_MODULE_SERVER_METADATA.map((metadata) => [metadata.id, metadata]),
)

function getServerMetadata(moduleId: string): HammurabiModuleServerMetadata {
  const metadata = serverMetadataById.get(moduleId)
  if (!metadata) {
    throw new Error(`Missing server module manifest metadata for "${moduleId}"`)
  }
  return metadata
}

export const HAMMURABI_MODULE_MANIFESTS = HAMMURABI_MODULE_GRAPH.map((graph) => ({
  graph,
  server: getServerMetadata(graph.id),
})) satisfies readonly HammurabiModuleManifest[]

export const HAMMURABI_MODULE_MANIFEST_BY_ID = new Map(
  HAMMURABI_MODULE_MANIFESTS.map((manifest) => [manifest.graph.id, manifest]),
)
