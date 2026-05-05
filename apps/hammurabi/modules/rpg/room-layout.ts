// room-layout.ts — 30x20 tile grid from hams.tmx
// Source: app-assets/game/hams.tmx
// Tileset: kenney_tiny-dungeon/Tiled/sampleSheet.tsx (firstgid=140)
// Packed tileset: workroom-tiles.png (tilemap_packed.png, no spacing, 12 cols)
// Frame formula for workroom-tiles.png: x = (index % 12) * 16, y = floor(index / 12) * 16
//
// TMX uses GIDs (140-based for sampleSheet). Both layers store tile indices = GID - 140.
// Dungeon layer = floors/walls/doors. Objects layer = agent spots + decorations.
//
// Key tiles (by packed index):
//   Dungeon layer:
//     tile 48 (GID 188) = walkable floor
//     tile 50 (GID 190) = walkable transition floor
//     tile 40 (GID 180) = corridor floor
//     tile 10 (GID 150) = left door
//     tile 11 (GID 151) = right door
//     tile 30 (GID 170) = column gap (walkable)
//   Objects layer:
//     tile 60 (GID 200) = workstation (worker/command-room agents)
//     tile 62 (GID 202) = commander station

export const TILE_SIZE = 16
export const ROOM_COLS = 30
export const ROOM_ROWS = 20
export const ROOM_WIDTH  = ROOM_COLS * TILE_SIZE  // 480
export const ROOM_HEIGHT = ROOM_ROWS * TILE_SIZE  // 320

// Dungeon layer tile indices derived from hams.tmx CSV (each value = GID - 140)
// prettier-ignore
export const DUNGEON_LAYER: number[][] = [
  // row 0 — top wall
  [ 4,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26, 5],
  // row 1 — inner ceiling main room + commander room entrance
  [15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3,13],
  // row 2 — inner ceiling continued + commander room upper
  [15, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3,13,50,50,50,50,50,50,50,50,15,13],
  // row 3 — main floor (agent spots moved to Objects layer)
  [15,13,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,15,13,48,48,48,48,48,48,48,48,15,13],
  // row 4 — floor (workstations in Objects layer)
  [15,13,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,15,13,48,48,48,48,48,48,48,48,15,13],
  // row 5 — floor
  [15,13,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,15,13,48,48,48,48,48,48,48,48,15,13],
  // row 6 — floor (commander stations in Objects layer)
  [15,13,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,15,13,48,48,48,48,48,48,48,48,15,13],
  // row 7 — floor (workstations in Objects layer)
  [15,13,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,15,13,48,48,48,48,48,48,48,48,15,13],
  // row 8 — floor
  [15,13,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,15,13,48,48,48,48,48,48,48,48,15,13],
  // row 9 — floor (sparse workstations + commander stations in Objects layer)
  [15,13,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,15,13,48,48,48,48,48,48,48,48,15,13],
  // row 10 — floor (sparse workstations in Objects layer)
  [15,13,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,15,13,48,48,48,48,48,48,48,48,15,13],
  // row 11 — bottom wall divider
  [15,25,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,26,27,25,26,26,26,26,26,26,26,26,27,13],
  // row 12 — corridor ceiling
  [16, 2, 2, 6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,17],
  // row 13 — corridor + doors (10=left door, 11=right door at cols 9-10 and 23-24)
  [57,40,40,18,28,40,40,40,40,10,11,40,40,40,40,28,18,40,40,40,40,40,40,10,11,40,40,40,40,40],
  // row 14 — transition zone
  [50,50,50,30,50,50,50,50,50,48,48,50,50,50,50,50,30,50,50,50,50,50,50,50,50,50,50,50,50,50],
  // rows 15-19 — open floor (all 48)
  [48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48],
  [48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48],
  [48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48],
  [48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48],
  [48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48,48],
]

// Objects layer tile indices from hams.tmx (GID - 140, 0 = empty)
// prettier-ignore
export const OBJECTS_LAYER: number[][] = [
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,32,89, 0, 0, 0, 0,89,32, 0, 0],
  [ 0, 0,72,72,72,72,72,72,72,72,72,72,72,72,72,72,72,72, 0, 0,62, 0, 0, 0, 0, 0, 0,62, 0, 0],
  [ 0, 0,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,32,89, 0,84,110, 0,89,32, 0, 0],
  [ 0, 0,72,72,72,72,72,72,72, 0, 0,72,72,72,72,72,72,72, 0, 0,62, 0, 0, 0, 0, 0, 0,62, 0, 0],
  [ 0, 0,60,60,60,60,60,60,60, 0, 0,60,60,60,60,60,60,60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,32,89, 0, 0, 0, 0,89,32, 0, 0],
  [ 0, 0,72,60, 0,72,60, 0, 0, 0, 0, 0, 0,60,72, 0,60,72, 0, 0,62, 0, 0, 0, 0, 0, 0,62, 0, 0],
  [ 0, 0,72,60, 0,72,60, 0, 0, 0, 0, 0, 0,60,72, 0,60,72, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
]

// Walkable tile indices (by packed index = GID - 140):
//   48 = floor, 50 = transition, 40 = corridor, 10 = left door,
//   11 = right door, 30 = column gap, 60 = workstation, 62 = commander station
const WALKABLE_TILES = new Set([48, 50, 40, 10, 11, 30, 60, 62])

// Door-path overrides: cells walkable despite wall tiles in dungeon layer.
// Left door path (cols 9-10, rows 11-13) and right door path (cols 23-24, rows 11-13).
// Row 13 cols 9-10 and 23-24 already have door tiles (10,11) in WALKABLE_TILES,
// but rows 11-12 have wall tiles (26/2) that need overrides.
const DOOR_PATH_OVERRIDES = new Set([
  '9,11',  '10,11',
  '9,12',  '10,12',
  '9,13',  '10,13',
  '23,11', '24,11',
  '23,12', '24,12',
  '23,13', '24,13',
])

export const WALKABLE_GRID: boolean[][] = DUNGEON_LAYER.map(
  (row, r) => row.map((tileIndex, c) =>
    WALKABLE_TILES.has(tileIndex) || DOOR_PATH_OVERRIDES.has(`${c},${r}`),
  ),
)

// ---------------------------------------------------------------------------
// Workstation spots — agents stand ON the workstation/commander tiles (Objects layer).
// Tile 60 (GID 200) = worker/command-room workstations (38 spots).
// Tile 62 (GID 202) = commander stations (6 spots).
// ---------------------------------------------------------------------------

/** pixel center of tile (col, row) */
function tc(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 }
}

// Regular/command-room agents stand ON tile-200 positions
// Row 4: cols 2-17 (16 spots)
// Row 7: cols 2-8, 11-17 (14 spots, gap at 9-10)
// Row 9: cols 3, 6, 13, 16 (4 spots)
// Row 10: cols 3, 6, 13, 16 (4 spots)
export const WORKSTATION_SPOTS: Array<{ x: number; y: number }> = [
  // Row 4 (16 spots)
  tc( 2, 4), tc( 3, 4), tc( 4, 4), tc( 5, 4), tc( 6, 4), tc( 7, 4), tc( 8, 4), tc( 9, 4),
  tc(10, 4), tc(11, 4), tc(12, 4), tc(13, 4), tc(14, 4), tc(15, 4), tc(16, 4), tc(17, 4),
  // Row 7 (14 spots)
  tc( 2, 7), tc( 3, 7), tc( 4, 7), tc( 5, 7), tc( 6, 7), tc( 7, 7), tc( 8, 7),
  tc(11, 7), tc(12, 7), tc(13, 7), tc(14, 7), tc(15, 7), tc(16, 7), tc(17, 7),
  // Row 9 (4 spots)
  tc( 3, 9), tc( 6, 9), tc(13, 9), tc(16, 9),
  // Row 10 (4 spots)
  tc( 3,10), tc( 6,10), tc(13,10), tc(16,10),
]

// Commander agents stand ON tile-202 positions (one commander per 202 tile).
// Row 3: cols 20, 27 / Row 6: cols 20, 27 / Row 9: cols 20, 27
export const COMMANDER_SPOTS: Array<{ x: number; y: number }> = [
  tc(20, 3), tc(27, 3),
  tc(20, 6), tc(27, 6),
  tc(20, 9), tc(27, 9),
]

// Idle agent spots — open floor area south of corridor (rows 15-19)
export const IDLE_SPOTS: Array<{ x: number; y: number }> = [
  tc( 2,15), tc( 5,15), tc( 8,15), tc(11,15), tc(14,15), tc(17,15), tc(20,15), tc(23,15), tc(26,15),
  tc( 2,17), tc( 5,17), tc( 8,17), tc(11,17), tc(14,17), tc(17,17), tc(20,17), tc(23,17), tc(26,17),
  tc( 2,19), tc( 5,19), tc( 8,19), tc(11,19), tc(14,19), tc(17,19), tc(20,19), tc(23,19), tc(26,19),
]

// Spawn positions
export const REGULAR_SPAWN = tc(10, 10)
export const COMMANDER_SPAWN = tc(24, 10)

// Object interaction positions (from objects layer)
export const QUEST_BOARD_POS = tc(23, 5)
export const AGENT_CONTROL_POS = tc(24, 5)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isWalkable(x: number, y: number, radius = 6): boolean {
  const corners = [
    { cx: x - radius, cy: y - radius },
    { cx: x + radius, cy: y - radius },
    { cx: x - radius, cy: y + radius },
    { cx: x + radius, cy: y + radius },
  ]
  for (const { cx, cy } of corners) {
    const col = Math.floor(cx / TILE_SIZE)
    const row = Math.floor(cy / TILE_SIZE)
    if (col < 0 || col >= ROOM_COLS || row < 0 || row >= ROOM_ROWS) return false
    if (!WALKABLE_GRID[row][col]) return false
  }
  return true
}

export function resolveMovement(
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius = 6,
): { x: number; y: number } {
  if (isWalkable(x + dx, y + dy, radius)) return { x: x + dx, y: y + dy }
  if (dx !== 0 && isWalkable(x + dx, y, radius)) return { x: x + dx, y }
  if (dy !== 0 && isWalkable(x, y + dy, radius)) return { x, y: y + dy }
  return { x, y }
}

// ---------------------------------------------------------------------------
// A* pathfinding on WALKABLE_GRID
// ---------------------------------------------------------------------------

/** pixel center of tile at (col, row) */
function tilePx(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 }
}

function heuristic(ac: number, ar: number, bc: number, br: number): number {
  return Math.abs(ac - bc) + Math.abs(ar - br)
}

/**
 * Find a walkable tile-center path from pixel (sx,sy) to (tx,ty).
 * Returns an array of pixel-center waypoints (not including the start tile).
 * If no path is found, returns a direct two-point array as fallback.
 */
export function findPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): Array<{ x: number; y: number }> {
  const sc = Math.floor(sx / TILE_SIZE)
  const sr = Math.floor(sy / TILE_SIZE)
  const tc2 = Math.floor(tx / TILE_SIZE)
  const tr = Math.floor(ty / TILE_SIZE)

  if (sc === tc2 && sr === tr) return [tilePx(tc2, tr)]

  // Node key: row * ROOM_COLS + col
  const key = (c: number, r: number) => r * ROOM_COLS + c

  const gScore = new Float32Array(ROOM_ROWS * ROOM_COLS).fill(Infinity)
  const fScore = new Float32Array(ROOM_ROWS * ROOM_COLS).fill(Infinity)
  const cameFrom = new Int32Array(ROOM_ROWS * ROOM_COLS).fill(-1)
  const closed = new Uint8Array(ROOM_ROWS * ROOM_COLS)

  // Tiny min-heap via sorted array (small map, 600 nodes max — acceptable)
  const open: number[] = []

  const startKey = key(sc, sr)
  gScore[startKey] = 0
  fScore[startKey] = heuristic(sc, sr, tc2, tr)
  open.push(startKey)

  const DIRS = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ]
  const COSTS = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414]

  while (open.length > 0) {
    // Pop lowest fScore
    let bestIdx = 0
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i
    }
    const current = open[bestIdx]
    open.splice(bestIdx, 1)

    if (current === key(tc2, tr)) {
      // Reconstruct path
      const path: Array<{ x: number; y: number }> = []
      let node = current
      while (node !== -1) {
        const c = node % ROOM_COLS
        const r = Math.floor(node / ROOM_COLS)
        path.unshift(tilePx(c, r))
        node = cameFrom[node]
      }
      // Skip the start tile (index 0) — return remaining waypoints
      return path.length > 1 ? path.slice(1) : path
    }

    closed[current] = 1
    const curC = current % ROOM_COLS
    const curR = Math.floor(current / ROOM_COLS)

    for (let d = 0; d < DIRS.length; d++) {
      const nc = curC + DIRS[d][0]
      const nr = curR + DIRS[d][1]
      if (nc < 0 || nc >= ROOM_COLS || nr < 0 || nr >= ROOM_ROWS) continue
      if (!WALKABLE_GRID[nr][nc]) continue
      // For diagonals, both cardinal neighbours must be walkable too
      if (d >= 4 && (!WALKABLE_GRID[curR][nc] || !WALKABLE_GRID[nr][curC])) continue

      const nk = key(nc, nr)
      if (closed[nk]) continue

      const tentativeG = gScore[current] + COSTS[d]
      if (tentativeG >= gScore[nk]) continue

      cameFrom[nk] = current
      gScore[nk] = tentativeG
      fScore[nk] = tentativeG + heuristic(nc, nr, tc2, tr)
      if (!open.includes(nk)) open.push(nk)
    }
  }

  // No path found — fall back to direct target
  return [{ x: tx, y: ty }]
}
