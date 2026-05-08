/**
 * Hervald — SVG icon map.
 *
 * Each entry is a JSX fragment rendered inside an <svg viewBox="0 0 24 24">.
 * The host <svg> supplies fill="none" stroke="currentColor" with round caps/joins.
 */
import type { ReactNode } from 'react'

export const ICONS: Record<string, ReactNode> = {
  /* ---- Navigation ---- */
  command: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sessions: (
    <>
      <path d="M4 5h16v12H4z" />
      <path d="M8 20h8" />
    </>
  ),
  quests: (
    <>
      <path d="M5 4h14l-2 5 2 5H5z" />
      <path d="M5 4v16" />
    </>
  ),
  sentinels: (
    <>
      <path d="M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  cron: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <path d="M12 4a12 12 0 010 16" />
      <path d="M12 4a12 12 0 000 16" />
    </>
  ),
  identity: (
    <>
      <circle cx="12" cy="9" r="4" />
      <path d="M4 20c1-4 4-6 8-6s7 2 8 6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
    </>
  ),

  /* ---- UI ---- */
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  plus: <path d="M12 3v18M3 12h18" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronR: <path d="M9 6l6 6-6 6" />,
  chevronD: <path d="M6 9l6 6 6-6" />,
  chevronL: <path d="M15 6l-6 6 6 6" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  folder: (
    <path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" />
  ),
  folderOpen: (
    <>
      <path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v2H3V6z" />
      <path d="M3 10h18l-2 8a1 1 0 01-1 1H4a1 1 0 01-1-1v-8z" />
    </>
  ),
  file: (
    <>
      <path d="M7 3h8l4 4v14H7z" />
      <path d="M15 3v4h4" />
    </>
  ),
  terminal: (
    <>
      <path d="M3 5h18v14H3z" />
      <path d="M6 9l3 3-3 3M12 15h6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20l4-1 11-11-3-3L5 16z" />
      <path d="M14 6l3 3" />
    </>
  ),
  send: <path d="M4 20l17-8L4 4v6l11 2-11 2z" />,
  paperclip: (
    <path d="M21 11l-9 9a5 5 0 01-7-7l9-9a3.5 3.5 0 014.95 4.95L9.88 18.12a2 2 0 11-2.83-2.83l7.3-7.3" />
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </>
  ),
  spark: (
    <path d="M12 3l2 6 6 1-5 4 2 7-5-4-5 4 2-7-5-4 6-1z" />
  ),
  workspace: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="1" />
      <path d="M9 18v2h6v-2M3 14h18" />
    </>
  ),
  queue: <path d="M4 6h16M4 12h10M4 18h7" />,
  check: <path d="M5 13l4 4L19 7" />,
  shield: <path d="M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7z" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M8 6a7 7 0 108 0" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="2" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M8 12h8M8 12a6 6 0 006-6" />
    </>
  ),
  commit: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6M15 12h6" />
    </>
  ),
  plus_sq: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </>
  ),
  play: <path d="M6 4l14 8-14 8z" />,
  alert: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </>
  ),
}
