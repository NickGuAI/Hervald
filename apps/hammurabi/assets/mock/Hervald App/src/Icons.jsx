/* Hervald · Icons — stroke-only, 1.5px, Lucide-flavored
   Handoff: swap for a real icon set by replacing ICONS. */

const ICONS = {
  // nav
  command:   <><path d="M8 4h8a4 4 0 014 4v8a4 4 0 01-4 4H8a4 4 0 01-4-4V8a4 4 0 014-4z"/><path d="M9 9l3 3-3 3M13 15h3"/></>,
  fleet:     <><path d="M3 7h18M3 12h18M3 17h12"/><circle cx="5" cy="7" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="7" cy="17" r="1"/></>,
  quests:    <><path d="M9 4h6l4 4v12a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z"/><path d="M9 12l2 2 4-4"/></>,
  sentinel:  <><path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z"/></>,
  telemetry: <><path d="M3 17l4-6 4 4 4-8 6 10"/></>,
  services:  <><path d="M4 5h16v4H4zM4 11h16v4H4zM4 17h16v3H4z"/></>,
  policy:    <><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></>,
  settings:  <><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"/></>,

  // chrome
  sidebar:   <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
  search:    <><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></>,
  plus:      <path d="M12 5v14M5 12h14"/>,
  close:     <path d="M6 6l12 12M18 6L6 18"/>,
  more:      <><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></>,
  chevronR:  <path d="M9 6l6 6-6 6"/>,
  chevronD:  <path d="M6 9l6 6 6-6"/>,
  chevronL:  <path d="M15 6l-6 6 6 6"/>,
  check:     <path d="M5 13l4 4L19 7"/>,
  dot:       <circle cx="12" cy="12" r="2.4"/>,

  // content
  play:      <path d="M7 4l13 8-13 8V4z"/>,
  stop:      <rect x="6" y="6" width="12" height="12" rx="1"/>,
  pause:     <><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></>,
  skull:     <><path d="M7 17v3h10v-3"/><circle cx="12" cy="10" r="7"/><circle cx="9" cy="11" r="1.2"/><circle cx="15" cy="11" r="1.2"/></>,
  folder:    <path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6z"/>,
  file:      <><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/></>,
  git:       <><circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="12" r="2"/><path d="M7 8v8M9 6h4a4 4 0 014 4"/></>,
  diff:      <><path d="M4 6h10M4 12h16M4 18h10"/></>,
  terminal:  <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></>,
  clock:     <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>,
  bolt:      <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"/>,
  attach:    <path d="M20 11l-8 8a4 4 0 01-6-6l8-8a3 3 0 114 4l-8 8a2 2 0 01-3-3l7-7"/>,
  send:      <path d="M4 12l16-8-6 18-4-7-6-3z"/>,
  chat:      <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 4v-4H6a2 2 0 01-2-2V6z"/>,
  user:      <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></>,
  trash:     <><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/></>,
  refresh:   <><path d="M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2"/><path d="M20 4v5h-5M4 20v-5h5"/></>,
  spark:     <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2"/>,
  bot:       <><rect x="4" y="7" width="16" height="12" rx="2"/><circle cx="9" cy="13" r="1.3"/><circle cx="15" cy="13" r="1.3"/><path d="M12 3v4"/></>,
  worker:    <><rect x="5" y="8" width="14" height="12" rx="2"/><path d="M8 8V6a4 4 0 018 0v2"/></>,
  mcp:       <><path d="M4 12h4l2-4 4 8 2-4h4"/></>,
  bash:      <><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 10l3 2-3 2"/></>,
  codex:     <><path d="M4 6h14a2 2 0 012 2v8a2 2 0 01-2 2H4zM4 6v12M8 10h8M8 14h5"/></>,
  warning:   <><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></>,
  info:      <><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></>,
  link:      <><path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 10-5.66-5.66L11 7"/><path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 105.66 5.66L13 17"/></>,
  book:      <path d="M4 5a2 2 0 012-2h13v18H6a2 2 0 01-2-2V5zM19 3v18"/>,
};

function Icon({ name, size = 18, stroke = 1.5, style = {}, ...rest }) {
  const g = ICONS[name] || ICONS.dot;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }} {...rest}>
      {g}
    </svg>
  );
}

window.Icon = Icon;
