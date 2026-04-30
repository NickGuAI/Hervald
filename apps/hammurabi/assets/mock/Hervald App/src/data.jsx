// ============================================================
// Hervald — mock data layer.
// Single source of truth. Wire real data by replacing the
// exported window.HV_DATA object; every surface reads from it.
// ============================================================

const now = Date.now();
const minAgo = (n) => new Date(now - n * 60_000).toISOString();

// Commanders — the "agents" the user operates.
const commanders = [
  {
    id: "jarvis",
    name: "jarvis",
    title: "Report editor",
    avatar: "J",
    accent: "#C23B22",            // vermillion-seal
    status: "connected",          // connected | idle | offline | paused
    uptime: "48:55",              // h:m since spawn
    idle: "0m 0s",
    activeSession: "ses_7f4d7d8",
    unread: 0,
    description: "Rewrites research drafts. Watches Google-docs baseline; republishes at the same URL.",
  },
  {
    id: "athena",
    name: "athena",
    title: "Market scout",
    avatar: "A",
    accent: "#6B7B5E",
    status: "connected",
    uptime: "12:04",
    idle: "3m 12s",
    activeSession: "ses_a29b10c",
    unread: 2,
    description: "Watches news + filings; posts digests to #market-pulse.",
  },
  {
    id: "einstein",
    name: "einstein",
    title: "Research runner",
    avatar: "E",
    accent: "#D4763A",
    status: "connected",
    uptime: "02:19",
    idle: "0m 0s",
    activeSession: "ses_e11a2b",
    unread: 0,
    description: "Deep research + synthesis. Long-running; surfaces intermediate findings as quests.",
  },
  {
    id: "zendude",
    name: "zendude",
    title: "Calendar + inbox",
    avatar: "Z",
    accent: "#4A4A4A",
    status: "idle",
    uptime: "09:41",
    idle: "22m 08s",
    activeSession: null,
    unread: 1,
    description: "Triage. Drafts replies, proposes meeting moves, flags anything needing a human.",
  },
  {
    id: "jake",
    name: "jake",
    title: "Engineer",
    avatar: "K",
    accent: "#1C1C1C",
    status: "paused",
    uptime: "31:02",
    idle: "—",
    activeSession: "ses_j3k4m5n",
    unread: 0,
    description: "Pairs on code. Waits for approvals on writes. Currently paused: 3 approvals queued.",
  },
];

// Sub-agents / workers currently running under each commander.
// Used for Fleet swim-lanes and Team panel.
const workers = [
  // jarvis
  { id: "w01", commanderId: "jarvis",  name: "bash",       kind: "tool",    state: "done",   startedAt: minAgo(28), durationSec: 4,   label: "hammurabi quests list" },
  { id: "w02", commanderId: "jarvis",  name: "write",      kind: "tool",    state: "done",   startedAt: minAgo(26), durationSec: 12,  label: "republish report.md" },
  { id: "w03", commanderId: "jarvis",  name: "researcher", kind: "worker",  state: "done",   startedAt: minAgo(24), durationSec: 180, label: "Cohen · background check" },
  { id: "w04", commanderId: "jarvis",  name: "editor",     kind: "worker",  state: "active", startedAt: minAgo(2),  durationSec: 120, label: "Pass 3 · tone smoothing" },

  // athena
  { id: "w10", commanderId: "athena",  name: "scraper",    kind: "tool",    state: "done",   startedAt: minAgo(27), durationSec: 45,  label: "sec.gov feed" },
  { id: "w11", commanderId: "athena",  name: "summarizer", kind: "worker",  state: "done",   startedAt: minAgo(22), durationSec: 90,  label: "Q1 filings digest" },
  { id: "w12", commanderId: "athena",  name: "notifier",   kind: "tool",    state: "done",   startedAt: minAgo(18), durationSec: 3,   label: "slack → #market-pulse" },
  { id: "w13", commanderId: "athena",  name: "scraper",    kind: "tool",    state: "active", startedAt: minAgo(1),  durationSec: 60,  label: "bloomberg · rate ticks" },

  // einstein
  { id: "w20", commanderId: "einstein", name: "searcher",   kind: "worker", state: "done",   startedAt: minAgo(15), durationSec: 300, label: "long-context search · GLP-1" },
  { id: "w21", commanderId: "einstein", name: "searcher",   kind: "worker", state: "active", startedAt: minAgo(4),  durationSec: 240, label: "cross-ref · Nature + NEJM" },
  { id: "w22", commanderId: "einstein", name: "writer",     kind: "worker", state: "queued", startedAt: minAgo(0),  durationSec: 0,   label: "synthesize findings" },

  // zendude (idle)
  { id: "w30", commanderId: "zendude", name: "triage",      kind: "worker", state: "done",   startedAt: minAgo(25), durationSec: 220, label: "inbox sweep · 42 → 4" },

  // jake — paused, 3 approvals queued
  { id: "w40", commanderId: "jake",    name: "code",        kind: "tool",   state: "blocked", startedAt: minAgo(12), durationSec: 90, label: "await approval · migrate.sql" },
  { id: "w41", commanderId: "jake",    name: "bash",        kind: "tool",   state: "blocked", startedAt: minAgo(8),  durationSec: 60, label: "await approval · rm build/" },
  { id: "w42", commanderId: "jake",    name: "edit",        kind: "tool",   state: "blocked", startedAt: minAgo(5),  durationSec: 30, label: "await approval · edit prod.env" },
];

// Approvals queue — what the human needs to sign off on.
const approvals = [
  { id: "ap01", commanderId: "jake", workerId: "w40", kind: "write", risk: "medium", title: "Run migration",  detail: "hammurabi migrate --file=migrate.sql", requestedAt: minAgo(12) },
  { id: "ap02", commanderId: "jake", workerId: "w41", kind: "shell", risk: "high",   title: "Delete build/",  detail: "rm -rf build/",                        requestedAt: minAgo(8) },
  { id: "ap03", commanderId: "jake", workerId: "w42", kind: "edit",  risk: "high",   title: "Edit prod.env",  detail: "VITE_API_URL=https://api.v2.hervald.co", requestedAt: minAgo(5) },
  { id: "ap04", commanderId: "athena", workerId: null, kind: "post", risk: "low",    title: "Post to slack",  detail: "#market-pulse · 'Fed minutes are in…'", requestedAt: minAgo(2) },
];

// Current session transcript for the default-selected commander (jarvis).
// The transcript is intentionally small — agents should replace at runtime.
const transcript = [
  {
    id: "m01", role: "tool",
    title: "2 tool calls",
    state: "done",
    children: [
      { kind: "note", text: "Done. Report republished at the same URL." },
      { kind: "md",   text: "这篇加上去之后的核心判断：\n\n• **留在 Google**（现状 baseline）\n\n| 维度 | 状态 | 说明 |\n|---|---|---|\n| 职级 | L5 Baseline | 稳定，不求增长 |\n| 薪资 | $450–700/h 咨询 | 附加收入 |\n| 职业 | COMPLICATED | 多头下注，optionality 很高 |\n| 契合度 | 最大化 optionality | 固在 Google 是 default, 不是 decision |\n\n⚠️ 关键一句话：\"固在 Google\" 是 default, 不是 decision. 要把它变成 decision, 你得回答：Google 给你的时间，你拿来做了什么？" },
    ],
    at: minAgo(6),
  },
  {
    id: "m02", role: "user",
    text: "Check your quest board. What is your current task? Post a progress note, then continue or pick up the next quest.",
    at: minAgo(3),
  },
  {
    id: "m03", role: "tool",
    title: "bash",
    state: "done",
    children: [
      { kind: "code", text: "export HAMMURABI_COMMANDER_ID=\"9f4d8740-1348-4d4c-b5f8-4c5cf51553c9\" && hammurabi quests list" },
    ],
    at: minAgo(3),
  },
  {
    id: "m04", role: "assistant",
    text: "Board is clear. No pending or active quests. The Google baseline section was added and published in the last turn — that was a direct request, not a quest.\n\nWhat's on your mind?",
    at: minAgo(2),
  },
];

// Fleet — every commander × time bucket.
// Each event is (commanderId, startMin, durMin, kind, label).
// Times measured as minutes-ago (0 = now, 30 = thirty minutes ago).
const fleetWindow = 30; // minutes
const fleetEvents = [
  // jarvis
  { commanderId: "jarvis", start: 29, dur: 2, kind: "worker", label: "researcher" },
  { commanderId: "jarvis", start: 26, dur: 3, kind: "tool",   label: "read × 4" },
  { commanderId: "jarvis", start: 22, dur: 4, kind: "worker", label: "editor · pass 1" },
  { commanderId: "jarvis", start: 17, dur: 3, kind: "worker", label: "editor · pass 2" },
  { commanderId: "jarvis", start: 13, dur: 2, kind: "tool",   label: "write · report.md" },
  { commanderId: "jarvis", start: 10, dur: 8, kind: "idle",   label: "awaiting input" },
  { commanderId: "jarvis", start: 2,  dur: 2, kind: "worker", label: "editor · pass 3" },

  // athena
  { commanderId: "athena", start: 28, dur: 1, kind: "tool",   label: "scraper" },
  { commanderId: "athena", start: 26, dur: 4, kind: "worker", label: "summarizer" },
  { commanderId: "athena", start: 21, dur: 1, kind: "tool",   label: "notifier" },
  { commanderId: "athena", start: 19, dur: 8, kind: "idle",   label: "—" },
  { commanderId: "athena", start: 10, dur: 3, kind: "tool",   label: "scraper · rate ticks" },
  { commanderId: "athena", start: 6,  dur: 3, kind: "worker", label: "summarizer · fed minutes" },
  { commanderId: "athena", start: 2,  dur: 2, kind: "blocked", label: "awaiting approval" },

  // einstein
  { commanderId: "einstein", start: 20, dur: 5, kind: "worker", label: "searcher" },
  { commanderId: "einstein", start: 14, dur: 10, kind: "worker", label: "cross-ref · long" },
  { commanderId: "einstein", start: 3,  dur: 3,  kind: "worker", label: "synthesize" },

  // zendude
  { commanderId: "zendude", start: 27, dur: 4, kind: "worker", label: "triage · inbox" },
  { commanderId: "zendude", start: 22, dur: 22, kind: "idle",  label: "idle · 22m" },

  // jake
  { commanderId: "jake", start: 25, dur: 4, kind: "worker", label: "code" },
  { commanderId: "jake", start: 20, dur: 1, kind: "tool",   label: "test" },
  { commanderId: "jake", start: 12, dur: 12, kind: "blocked", label: "awaiting 3 approvals" },
];

// Workspace (repo) — files + changes + git log.
const workspace = {
  repo: "hervald / hervald-core",
  branch: "jarvis/report-google-baseline",
  tree: [
    { path: ".ai-debrief",     kind: "dir",  added: true },
    { path: ".antigravity-server", kind: "dir" },
    { path: ".aws", kind: "dir" },
    { path: ".bun", kind: "dir" },
    { path: ".cache", kind: "dir" },
    { path: ".claude", kind: "dir" },
    { path: ".codex", kind: "dir" },
    { path: ".config", kind: "dir" },
    { path: ".cursor", kind: "dir" },
    { path: ".cursor-server", kind: "dir" },
    { path: ".docker", kind: "dir" },
    { path: ".factory", kind: "dir" },
    { path: ".gemini", kind: "dir" },
    { path: ".hammurabi", kind: "dir", open: true, children: [
      { path: ".hammurabi/commanders.toml", kind: "file" },
      { path: ".hammurabi/quests.db",       kind: "file" },
      { path: ".hammurabi/cron.yaml",       kind: "file", modified: true },
    ]},
    { path: "reports", kind: "dir", open: true, children: [
      { path: "reports/google-baseline.md", kind: "file", modified: true, selected: true },
      { path: "reports/market-pulse.md",    kind: "file" },
      { path: "reports/glp1-synthesis.md",  kind: "file" },
    ]},
    { path: "src", kind: "dir" },
    { path: "README.md", kind: "file" },
    { path: "package.json", kind: "file" },
  ],
  changes: [
    { path: "reports/google-baseline.md", status: "M", additions: 24, deletions: 3 },
    { path: ".hammurabi/cron.yaml",       status: "M", additions: 2,  deletions: 0 },
    { path: ".ai-debrief/jarvis.md",      status: "A", additions: 48, deletions: 0 },
  ],
  log: [
    { sha: "a3f91c2", author: "jarvis",  at: minAgo(2),  message: "report: republish google baseline section" },
    { sha: "7b20ee0", author: "jarvis",  at: minAgo(14), message: "editor: pass 3 tone pass" },
    { sha: "f01d9a1", author: "athena",  at: minAgo(28), message: "market-pulse: fed minutes digest" },
    { sha: "1c88b30", author: "you",     at: minAgo(46), message: "cron: move 6am digest to 5:45am" },
    { sha: "9e4b2f8", author: "einstein", at: minAgo(92), message: "research: GLP-1 first-pass notes" },
    { sha: "4a0c77d", author: "jake",    at: minAgo(180), message: "chore: bump deps" },
  ],
  preview: {
    path: "reports/google-baseline.md",
    language: "markdown",
    content:
`# Report · Google baseline — v2

> Republished at the same URL. Editor pass 3 complete.

## Snapshot

这篇加上去之后的核心判断：

- **留在 Google**（现状 baseline）
- **副业咨询**（optionality 层）
- **明年再决定 L6**（不急）

## 维度

| 维度   | 状态                | 说明 |
|--------|---------------------|-----------------------------|
| 职级   | L5 Baseline         | 稳定，不求增长               |
| 薪资   | $450–700/h 咨询     | 附加收入                     |
| 职业   | COMPLICATED         | 多头下注，optionality 很高   |
| 契合度 | 最大化 optionality  | 固在 Google 是 default       |

## 一句话

"固在 Google" 是 **default**, 不是 **decision**.
要把它变成 decision, 你得回答：Google 给你的时间，你拿来做了什么？

---

*All stakeholders should align on this baseline — assumption, not aspiration.*`,
  },
};

// Top-level nav in the shell sidebar.
const nav = [
  { id: "command",   label: "Command room",  icon: "command"   },
  { id: "fleet",     label: "Fleet",         icon: "fleet"     },
  { id: "sessions",  label: "Sessions",      icon: "sessions"  },
  { id: "quests",    label: "Quests",        icon: "quests"    },
  { id: "sentinels", label: "Sentinels",     icon: "sentinels" },
  { id: "cron",      label: "Cron",          icon: "cron"      },
  { id: "identity",  label: "Identity",      icon: "identity"  },
  { id: "settings",  label: "Settings",      icon: "settings"  },
];

window.HV_DATA = {
  nav,
  commanders,
  workers,
  approvals,
  transcript,
  fleetWindow,
  fleetEvents,
  workspace,
};
