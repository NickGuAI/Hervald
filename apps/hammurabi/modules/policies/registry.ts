import type { ActionCategoryDefinition } from './types.js'

export const INTERNAL_EDIT_IN_CWD_ACTION: ActionCategoryDefinition = {
  id: 'internal:edit-in-cwd',
  label: 'Internal Edit In CWD',
  group: 'Internal',
  description: 'Local file edits that stay inside the active session cwd.',
  primaryTargetLabel: 'Path',
  primaryTargetKey: 'path',
  matchers: {
    mcpServers: [],
    bashPatterns: [],
  },
}

export const INTERNAL_SAFE_BASH_ACTION: ActionCategoryDefinition = {
  id: 'internal:safe-bash',
  label: 'Internal Safe Bash',
  group: 'Internal',
  description: 'Read-only or cwd-scoped shell commands that Hammurabi auto-approves.',
  primaryTargetLabel: 'Command',
  primaryTargetKey: 'command',
  matchers: {
    mcpServers: [],
    bashPatterns: [],
  },
}

export const INTERNAL_SAFE_MCP_ACTION: ActionCategoryDefinition = {
  id: 'internal:safe-mcp',
  label: 'Internal Safe MCP',
  group: 'Internal',
  description: 'Non-outbound MCP tool calls that stay on the internal fast path.',
  primaryTargetLabel: 'Tool',
  primaryTargetKey: 'tool',
  matchers: {
    mcpServers: [],
    bashPatterns: [],
  },
}

export const SAFE_BASH_PATTERNS: RegExp[] = [
  /^(?:cat|ls|grep|find|head|tail|wc|stat|file|which|pwd|date|echo|printf|true|false|test)(?:\s|$)/i,
  /^\[(?:\s|$)/,
  /^(?:npm|pnpm)\s+(?:test|lint|run\s+(?:test|lint|build|typecheck|check)|list|why|view|outdated)(?:\s|$)/i,
  /^git\s+(?:status|diff|log|show|branch(?:\s+--show-current)?|rev-parse|ls-files|grep|merge-base|symbolic-ref|remote\s+-v)(?:\s|$)/i,
  /^gh\s+(?:auth\s+status|pr\s+(?:status|view|diff|checks)|issue\s+(?:list|view)|repo\s+view)(?:\s|$)/i,
  /^node\s+(?:--version|-v)(?:\s|$)/i,
]

export const BUILT_IN_ACTIONS: ActionCategoryDefinition[] = [
  {
    id: 'send-email',
    label: 'Send Email',
    group: 'Channels',
    description: 'Outbound email sends to people outside the agent workspace.',
    primaryTargetLabel: 'Recipient',
    primaryTargetKey: 'recipient',
    matchers: {
      mcpServers: ['gmail', 'superhuman', 'mail_n_notion', 'ses'],
      bashPatterns: [
        /^gog\s+gmail\s+send\b/i,
        /^gog\s+email\s+send\b/i,
        /^aws\s+ses\s+send-email\b/i,
        /^sendmail\b/i,
      ],
    },
  },
  {
    id: 'send-message',
    label: 'Send Message',
    group: 'Channels',
    description: 'Outbound chat or direct-message sends.',
    primaryTargetLabel: 'Channel / Recipient',
    primaryTargetKey: 'target',
    matchers: {
      mcpServers: ['slack', 'discord', 'telegram', 'whatsapp', 'twilio'],
      bashPatterns: [
        /^gog\s+slack\s+send\b/i,
        /^gog\s+discord\s+send\b/i,
        /^gog\s+telegram\s+send\b/i,
        /^gog\s+whatsapp\s+send\b/i,
      ],
    },
  },
  {
    id: 'post-social',
    label: 'Post to Social',
    group: 'Channels',
    description: 'Social-network or community publishing actions.',
    primaryTargetLabel: 'Platform',
    primaryTargetKey: 'platform',
    matchers: {
      mcpServers: ['x', 'twitter', 'linkedin', 'circle'],
      bashPatterns: [
        /^pan-social-post\b/i,
        /^gog\s+linkedin\s+post\b/i,
        /^gog\s+(x|twitter)\s+post\b/i,
        /^gog\s+circle\s+post\b/i,
      ],
    },
  },
  {
    id: 'push-code-prs',
    label: 'Push Code / PRs',
    group: 'Code & Infra',
    description: 'Git pushes and pull-request creation or merge operations.',
    primaryTargetLabel: 'Repo / Branch',
    primaryTargetKey: 'target',
    matchers: {
      mcpServers: ['github'],
      bashPatterns: [
        /^git\s+push\b/i,
        /^gh\s+pr\s+create\b/i,
        /^gh\s+pr\s+merge\b/i,
        /^gh\s+repo\s+sync\b/i,
      ],
    },
  },
  {
    id: 'deploy',
    label: 'Deploy',
    group: 'Code & Infra',
    description: 'Deployment commands targeting an external environment.',
    primaryTargetLabel: 'Service / Environment',
    primaryTargetKey: 'target',
    matchers: {
      mcpServers: ['vercel', 'netlify', 'render'],
      bashPatterns: [
        /^vercel\s+deploy\b/i,
        /^netlify\s+deploy\b/i,
        /^npm\s+run\s+deploy\b/i,
        /^pnpm\s+deploy\b/i,
        /^make\s+deploy\b/i,
      ],
    },
  },
  {
    id: 'publish-content',
    label: 'Publish Content',
    group: 'Code & Infra',
    description: 'Publishing content into an external knowledge or content system.',
    primaryTargetLabel: 'Target Platform',
    primaryTargetKey: 'target',
    matchers: {
      mcpServers: ['notion', 'ghost', 'wordpress'],
      bashPatterns: [
        /^publish-report\b/i,
        /^gog\s+notion\s+(create|update|publish)\b/i,
        /^gog\s+docs\s+(create|publish)\b/i,
        /^gog\s+blog\s+publish\b/i,
      ],
    },
  },
  {
    id: 'calendar-changes',
    label: 'Calendar Changes',
    group: 'Code & Infra',
    description: 'Calendar create, update, or delete operations.',
    primaryTargetLabel: 'Calendar / Event',
    primaryTargetKey: 'target',
    matchers: {
      mcpServers: ['googlecalendar', 'google-calendar', 'google_calendar'],
      bashPatterns: [
        /^gog\s+calendar\s+(create|update|delete)\b/i,
        /^gog\s+gcal\s+(create|update|delete)\b/i,
        /^gcalcli\s+(add|edit|delete)\b/i,
      ],
    },
  },
  {
    id: 'destructive-git',
    label: 'Destructive Git',
    group: 'Code & Infra',
    description: 'Irreversible git operations that can lose work (rm, clean -f, reset --hard, push --force, etc).',
    primaryTargetLabel: 'Command',
    primaryTargetKey: 'command',
    matchers: {
      mcpServers: [],
      bashPatterns: [
        /^git\s+rm\b/i,
        /^git\s+clean\s+-[a-z]*f/i,
        /^git\s+reset\s+--hard\b/i,
        /^git\s+push\s+(-f|--force)(?!-with-lease)/i,
        /^git\s+checkout\s+(--|\.)/i,
        /^git\s+branch\s+-D\b/i,
      ],
    },
  },
  INTERNAL_EDIT_IN_CWD_ACTION,
  INTERNAL_SAFE_BASH_ACTION,
  INTERNAL_SAFE_MCP_ACTION,
]

export function getBuiltInAction(actionId: string): ActionCategoryDefinition | undefined {
  return BUILT_IN_ACTIONS.find((action) => action.id === actionId)
}
