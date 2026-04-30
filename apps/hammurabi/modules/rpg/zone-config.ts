export type AgentPhase = 'WORKSPACE' | 'COMMANDER_ROOM' | 'CORRIDOR' | 'OPEN_FLOOR'
export type RuntimePhase =
  | 'idle'
  | 'executing'
  | 'editing'
  | 'researching'
  | 'delegating'
  | 'thinking'
  | 'tool_use'
  | 'blocked'
  | 'completed'
export type RuntimeStatus = 'active' | 'idle' | 'stale' | 'completed'

export interface ZoneBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ZoneCenter {
  x: number
  y: number
}

export interface ZoneConfig {
  name: AgentPhase
  label: string
  bounds: ZoneBounds
  center: ZoneCenter
  deskPos: ZoneCenter
  color: number
}

// Zone bounds for the 30x20 hams.tmx two-room layout (TILE_SIZE = 16)
// Main workspace: cols 1-18, rows 1-10 (pixels 16-304, 16-176)
// Commander room: cols 20-28, rows 2-10 (pixels 320-464, 32-176)
// Corridor: cols 0-29, rows 12-14 (pixels 0-480, 192-240)
// Open floor: cols 0-29, rows 15-19 (pixels 0-480, 240-320)

export const ZONES: Record<AgentPhase, ZoneConfig> = {
  WORKSPACE: {
    name: 'WORKSPACE',
    label: 'Workspace',
    bounds: { x: 16, y: 16, width: 288, height: 160 },
    center: { x: 160, y: 96 },
    deskPos: { x: 160, y: 80 },
    color: 0xFF6B35,
  },
  COMMANDER_ROOM: {
    name: 'COMMANDER_ROOM',
    label: 'Commander Room',
    bounds: { x: 320, y: 32, width: 144, height: 144 },
    center: { x: 392, y: 104 },
    deskPos: { x: 376, y: 88 },
    color: 0xFFD700,
  },
  CORRIDOR: {
    name: 'CORRIDOR',
    label: 'Corridor',
    bounds: { x: 0, y: 192, width: 480, height: 48 },
    center: { x: 240, y: 216 },
    deskPos: { x: 240, y: 216 },
    color: 0x4ECDC4,
  },
  OPEN_FLOOR: {
    name: 'OPEN_FLOOR',
    label: 'Open Floor',
    bounds: { x: 0, y: 240, width: 480, height: 80 },
    center: { x: 240, y: 280 },
    deskPos: { x: 240, y: 280 },
    color: 0x9E9E9E,
  },
}

export const ZONE_LIST: ZoneConfig[] = [
  ZONES.WORKSPACE,
  ZONES.COMMANDER_ROOM,
  ZONES.CORRIDOR,
  ZONES.OPEN_FLOOR,
]

export function resolveZoneForAgent(status: RuntimeStatus, _phase: RuntimePhase, isCommander = false): AgentPhase {
  if (isCommander) return 'COMMANDER_ROOM'
  if (status === 'active') return 'WORKSPACE'
  if (status === 'completed') return 'WORKSPACE'
  if (status === 'stale' || status === 'idle') return 'OPEN_FLOOR'
  return 'OPEN_FLOOR'
}
