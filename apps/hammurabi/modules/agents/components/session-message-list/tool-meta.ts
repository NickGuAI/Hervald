import {
  Bot,
  FilePlus,
  FileText,
  Pencil,
  Plug,
  Search,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'

type ToolColorClass =
  | 'text-sky-400'
  | 'text-violet-400'
  | 'text-amber-400'
  | 'text-emerald-400'
  | 'text-orange-400'
  | 'text-cyan-400'

const TOOL_META: Record<string, { icon: LucideIcon; colorClass: ToolColorClass }> = {
  Read: { icon: FileText, colorClass: 'text-sky-400' },
  Glob: { icon: Search, colorClass: 'text-sky-400' },
  Grep: { icon: Search, colorClass: 'text-sky-400' },
  Edit: { icon: Pencil, colorClass: 'text-amber-400' },
  MultiEdit: { icon: Pencil, colorClass: 'text-amber-400' },
  Write: { icon: FilePlus, colorClass: 'text-emerald-400' },
  NotebookEdit: { icon: Pencil, colorClass: 'text-amber-400' },
  Bash: { icon: TerminalSquare, colorClass: 'text-orange-400' },
  WebFetch: { icon: Search, colorClass: 'text-sky-400' },
  WebSearch: { icon: Search, colorClass: 'text-sky-400' },
  LSP: { icon: FileText, colorClass: 'text-sky-400' },
  TodoWrite: { icon: FilePlus, colorClass: 'text-emerald-400' },
  Agent: { icon: Bot, colorClass: 'text-violet-400' },
}

export function getToolMeta(name: string) {
  if (TOOL_META[name]) {
    return TOOL_META[name]
  }
  if (name.startsWith('mcp__')) {
    return { icon: Plug, colorClass: 'text-violet-400' as ToolColorClass }
  }
  return { icon: TerminalSquare, colorClass: 'text-orange-400' as ToolColorClass }
}

export function formatToolDisplayName(name: string): { displayName: string; service?: string } {
  if (!name.startsWith('mcp__')) {
    return { displayName: name }
  }

  const stripped = name.slice(5)
  const lastSep = stripped.lastIndexOf('__')
  if (lastSep === -1) {
    return { displayName: name }
  }

  const server = stripped
    .slice(0, lastSep)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()

  const toolPart = stripped
    .slice(lastSep + 2)
    .replace(/[-_]/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())

  return { displayName: toolPart, service: server }
}

export function isAgentAccentColor(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length > 80) {
    return false
  }
  return /^#[0-9a-f]{3,8}$/i.test(trimmed)
    || /^rgba?\(/i.test(trimmed)
    || /^[a-z][a-z0-9-]*$/i.test(trimmed)
}
