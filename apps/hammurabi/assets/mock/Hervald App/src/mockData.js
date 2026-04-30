/* ============================================================
   Hervald · Mock Data + Data Hooks
   ------------------------------------------------------------
   HANDOFF NOTES (for the engineering agent):

   Every screen reads ONLY from `window.HervaldData`. To wire this
   prototype to real data, replace the functions in the
   `HervaldData` export below with calls into your backend / store.

   The shape of each function's return value is the contract the
   UI depends on — keep the shape, the UI keeps working.

   Surface -> data it consumes:
     Shell          -> getNav()
     CommandRoom    -> listCommanders(), getCommander(id), listMessages(id),
                       listWorkers(id), listApprovals(id), sendMessage(id, text)
     Fleet          -> getFleet(windowMinutes)
     Workspace      -> getWorkspaceTree(commanderId), getWorkspaceFile(path),
                       getWorkspaceChanges(commanderId), getWorkspaceGitLog(commanderId)

   All mock IDs, timestamps, and paths are arbitrary — swap freely.
   ============================================================ */

(function () {

  // ---------- Commanders ----------------------------------------------------
  const COMMANDERS = [
    {
      id: "athena",     name: "athena",     status: "idle",
      agentType: "claude", effort: "max",
      pid: 3114893, uptime: "41d", cost: 312.33,
      uuid: "d66a5217-ac66-4f09-02ac-b0d64a9a7e7e",
      task: null,
    },
    {
      id: "jake",       name: "jake",       status: "running",
      agentType: "claude", effort: "max",
      pid: 3121174, uptime: "40d", cost: 243.76,
      uuid: "dfbc564a-9b30-4a21-8b77-2c9e1f2d4a5b",
      task: "Refactor the heartbeat service — split out message queue",
    },
    {
      id: "jarvis",     name: "jarvis",     status: "running",
      agentType: "claude", effort: "max",
      pid: 3145337, uptime: "39d", cost: 11.31,
      uuid: "b6ed74b-1340-4a3c-b1f6-4c9cf51352c7",
      task: "Publish Google baseline to the career report",
    },
    {
      id: "einstein",   name: "einstein",   status: "stopped",
      agentType: "claude", effort: "max",
      pid: null, uptime: "34d", cost: 593.38,
      uuid: "7568a97d-0c60-4a12-9e4f-56f7c8d3a2b1",
      task: null,
    },
    {
      id: "zendude",    name: "zendude",    status: "stopped",
      agentType: "claude", effort: "max",
      pid: null, uptime: "—", cost: 0,
      uuid: "d2002ca7-b651-4d88-a3e2-ef8a7c9d6b4f",
      description: "personal admin",
      task: null,
    },
  ];

  // ---------- Messages (keyed by commander id) -----------------------------
  // Each message: { id, role: 'agent'|'user'|'tool'|'system', text, ts, meta? }
  const MESSAGES = {
    jarvis: [
      { id: "m1", role: "system", text: "2 tool calls · done", ts: "09:14" },
      { id: "m2", role: "agent",
        text: "Done. Report republished at the same URL.\n\nCore judgment after this addition:\n\n🔵 Stay at Google (baseline)\n\nAll external roles should be benchmarked against this baseline — not against an imagined ideal state.",
        ts: "09:15" },
      { id: "m3", role: "user",
        text: "Check your quest board. What is your current task? Post a progress note, then continue or pick up the next quest.",
        ts: "09:22" },
      { id: "m4", role: "tool",
        text: "export HERVALD_COMMANDER_ID=\"3fab87d0-1340-4c4c-b1f6-4c9cf51352c7\" && hervald quests list",
        ts: "09:22",
        meta: { tool: "Bash", status: "done" } },
      { id: "m5", role: "agent",
        text: "Board is clear. No pending or active quests. The Google baseline section was added and published in the last turn — that was a direct request, not a quest.\n\nWhat's on your mind?",
        ts: "09:23" },
    ],
    jake: [
      { id: "m1", role: "system", text: "session resumed", ts: "08:02" },
      { id: "m2", role: "agent",
        text: "Picking up the heartbeat refactor. The queue is currently inline with the worker — I'll pull it into its own module and add a test.",
        ts: "08:02" },
      { id: "m3", role: "tool",
        text: "rg -n \"heartbeat\" src/workers/ | head -30",
        ts: "08:03", meta: { tool: "Bash", status: "done" } },
      { id: "m4", role: "agent",
        text: "Found 14 references across 6 files. Starting with `src/workers/pulse.ts` — it's the only one writing to the queue.",
        ts: "08:04" },
    ],
    athena: [
      { id: "m1", role: "agent",
        text: "Idle. Last quest finished 21h ago — implementing commenting system + agent-fetch API for visual iteration loop.",
        ts: "yesterday" },
    ],
    einstein: [],
    zendude: [],
  };

  // ---------- Sub-agents / workers (keyed by commander id) -----------------
  // Each worker: { id, kind: 'worker'|'codex'|'bash'|'mcp', label, status, startedAt, hostLabel? }
  const WORKERS = {
    jarvis: [
      { id: "w1", kind: "worker", label: "pm-920",    status: "running", startedAt: "2m ago", hostLabel: "claude" },
      { id: "w2", kind: "codex",  label: "staffswc01",status: "running", startedAt: "6m ago", hostLabel: "codex" },
      { id: "w3", kind: "bash",   label: "search index build", status: "running", startedAt: "just now" },
    ],
    jake: [
      { id: "w1", kind: "worker", label: "srsweworker", status: "running", startedAt: "18m ago" },
      { id: "w2", kind: "bash",   label: "test:watch",  status: "running", startedAt: "9m ago" },
      { id: "w3", kind: "mcp",    label: "github · list-prs", status: "idle", startedAt: "3m ago" },
    ],
    athena: [],
    einstein: [],
    zendude: [],
  };

  // ---------- Approvals (keyed by commander id) ----------------------------
  // Each approval: { id, kind: 'action'|'spend'|'commit'|'destructive', title, body, requestedBy, ts }
  const APPROVALS = {
    jarvis: [
      { id: "a1", kind: "action",
        title: "Publish report to public URL",
        body: "career-report.html · overwrite existing",
        requestedBy: "jarvis", ts: "just now" },
      { id: "a2", kind: "spend",
        title: "Claude sonnet · extended thinking",
        body: "estimated $0.42 · 32k tokens",
        requestedBy: "jarvis", ts: "1m ago" },
    ],
    jake: [
      { id: "a1", kind: "destructive",
        title: "Force-push to feature/heartbeat-split",
        body: "3 commits will be rewritten",
        requestedBy: "jake", ts: "30s ago" },
    ],
    athena: [],
    einstein: [],
    zendude: [],
  };

  // ---------- Fleet (flat activity log for swim-lanes) ---------------------
  // Each spell: { commanderId, workerId, kind, label, startMin, endMin, status }
  // Minutes are relative to NOW (0 = now, -30 = 30 min ago).
  const FLEET_SPELLS = [
    // jarvis
    { commanderId: "jarvis", workerId: "j-self", kind: "agent", label: "jarvis · main",       startMin: -28, endMin: 0,   status: "running" },
    { commanderId: "jarvis", workerId: "j-w1",   kind: "worker",label: "pm-920",              startMin: -26, endMin: -22, status: "done" },
    { commanderId: "jarvis", workerId: "j-w2",   kind: "codex", label: "staffswc01 · codex",  startMin: -20, endMin: -8,  status: "done" },
    { commanderId: "jarvis", workerId: "j-w3",   kind: "bash",  label: "search index build",  startMin: -6,  endMin: -0.5,status: "running" },
    { commanderId: "jarvis", workerId: "j-w4",   kind: "mcp",   label: "github · fetch",      startMin: -3,  endMin: -2,  status: "done" },

    // jake
    { commanderId: "jake", workerId: "k-self", kind: "agent", label: "jake · main",           startMin: -30, endMin: 0,   status: "running" },
    { commanderId: "jake", workerId: "k-w1",   kind: "worker",label: "srsweworker",           startMin: -18, endMin: 0,   status: "running" },
    { commanderId: "jake", workerId: "k-w2",   kind: "bash",  label: "test:watch",            startMin: -9,  endMin: 0,   status: "running" },
    { commanderId: "jake", workerId: "k-w3",   kind: "mcp",   label: "github · list-prs",     startMin: -4,  endMin: -3,  status: "done" },
    { commanderId: "jake", workerId: "k-w4",   kind: "bash",  label: "tsc --noEmit",          startMin: -22, endMin: -18, status: "failed" },

    // athena (idle — small heartbeat)
    { commanderId: "athena", workerId: "a-self", kind: "agent", label: "athena · idle",       startMin: -30, endMin: 0,   status: "idle" },
    { commanderId: "athena", workerId: "a-w1",   kind: "bash",  label: "heartbeat",           startMin: -21, endMin: -21, status: "done" },
    { commanderId: "athena", workerId: "a-w2",   kind: "bash",  label: "heartbeat",           startMin: -16, endMin: -16, status: "done" },
    { commanderId: "athena", workerId: "a-w3",   kind: "bash",  label: "heartbeat",           startMin: -11, endMin: -11, status: "done" },
    { commanderId: "athena", workerId: "a-w4",   kind: "bash",  label: "heartbeat",           startMin: -6,  endMin: -6,  status: "done" },
    { commanderId: "athena", workerId: "a-w5",   kind: "bash",  label: "heartbeat",           startMin: -1,  endMin: -1,  status: "done" },

    // einstein (stopped — flat line)
    { commanderId: "einstein", workerId: "e-self", kind: "agent", label: "einstein · stopped", startMin: -30, endMin: 0,  status: "stopped" },

    // zendude (stopped — flat line)
    { commanderId: "zendude", workerId: "z-self", kind: "agent", label: "zendude · stopped",   startMin: -30, endMin: 0,  status: "stopped" },
  ];

  // ---------- Workspace (keyed by commander id) ----------------------------
  // Trees are arbitrary but follow { name, kind: 'dir'|'file', children?, path }
  const WORKSPACE_TREES = {
    jarvis: {
      name: "report-site", kind: "dir", path: "/", children: [
        { name: ".claude", kind: "dir", path: "/.claude", children: [] },
        { name: ".hervald", kind: "dir", path: "/.hervald", children: [] },
        { name: "src", kind: "dir", path: "/src", children: [
          { name: "index.html", kind: "file", path: "/src/index.html" },
          { name: "report.md",  kind: "file", path: "/src/report.md" },
          { name: "styles.css", kind: "file", path: "/src/styles.css" },
        ]},
        { name: "public", kind: "dir", path: "/public", children: [
          { name: "career-report.html", kind: "file", path: "/public/career-report.html" },
        ]},
        { name: "package.json", kind: "file", path: "/package.json" },
        { name: "README.md",    kind: "file", path: "/README.md" },
      ],
    },
    jake: {
      name: "app-monorepo", kind: "dir", path: "/", children: [
        { name: "apps", kind: "dir", path: "/apps", children: [
          { name: "api", kind: "dir", path: "/apps/api", children: [] },
          { name: "web", kind: "dir", path: "/apps/web", children: [] },
        ]},
        { name: "packages", kind: "dir", path: "/packages", children: [
          { name: "workers", kind: "dir", path: "/packages/workers", children: [
            { name: "pulse.ts",    kind: "file", path: "/packages/workers/pulse.ts" },
            { name: "queue.ts",    kind: "file", path: "/packages/workers/queue.ts" },
            { name: "pulse.test.ts", kind: "file", path: "/packages/workers/pulse.test.ts" },
          ]},
        ]},
        { name: "package.json", kind: "file", path: "/package.json" },
      ],
    },
    athena:   { name: "hammurabi", kind: "dir", path: "/", children: [] },
    einstein: { name: "—",         kind: "dir", path: "/", children: [] },
    zendude:  { name: "—",         kind: "dir", path: "/", children: [] },
  };

  const WORKSPACE_FILES = {
    "/src/report.md": `# Career baseline — April 2026

## Stay at Google (baseline)

All external opportunities should be benchmarked against this line — not
against an imagined ideal state.

| Dimension       | Signal     | Notes |
|-----------------|------------|-------|
| Credential      | C+         | Known to Google folks; absent from FAANG rolodex. |
| Compensation    | Baseline   | "I'm making Google money" — the number most people won't beat. |
| Role            | $350K · 10–15h/week | L5 workload, external plateau, Gehim's trajectory sharp. |
| Complication    | COMPLICATED| Optionality capped (Gehim, PMAI, Aria, health) — binary signals coasting. |

**One sentence:** Staying at Google is the default, not the decision. To make
it a decision, ask: "If Google offered you the role today, would you take it?"
`,
    "/public/career-report.html": `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Career baseline</title></head>
<body>
<h1>Career baseline — April 2026</h1>
<p>See <code>src/report.md</code> for the source of truth.</p>
</body>
</html>`,
    "/package.json": `{
  "name": "report-site",
  "version": "0.4.1",
  "scripts": {
    "build": "vite build",
    "publish": "node scripts/publish.mjs"
  }
}`,
    "/README.md": `# report-site\n\nPublishing pipeline for jarvis' career report.\n`,
    "/packages/workers/pulse.ts": `import { Queue } from "./queue";

export class Pulse {
  private q: Queue;
  constructor(q: Queue) { this.q = q; }

  async tick() {
    const job = await this.q.pop();
    if (!job) return;
    // ... heartbeat work ...
  }
}
`,
    "/packages/workers/queue.ts": `export class Queue<T = unknown> {
  private items: T[] = [];
  async push(t: T) { this.items.push(t); }
  async pop(): Promise<T | undefined> { return this.items.shift(); }
}
`,
  };

  const WORKSPACE_CHANGES = {
    jarvis: [
      { path: "src/report.md",            kind: "M", additions: 24, deletions: 3 },
      { path: "public/career-report.html",kind: "M", additions: 18, deletions: 18 },
      { path: ".hervald/session.log",     kind: "M", additions: 2,  deletions: 0 },
    ],
    jake: [
      { path: "packages/workers/pulse.ts",      kind: "M", additions: 12, deletions: 34 },
      { path: "packages/workers/queue.ts",      kind: "A", additions: 18, deletions: 0  },
      { path: "packages/workers/pulse.test.ts", kind: "A", additions: 41, deletions: 0  },
    ],
    athena: [], einstein: [], zendude: [],
  };

  const WORKSPACE_GIT = {
    jarvis: [
      { sha: "a3f9c21", author: "jarvis", ts: "2m ago",  msg: "report: add Google baseline section"   },
      { sha: "84d2e08", author: "jarvis", ts: "18m ago", msg: "publish: bump career-report.html"      },
      { sha: "12bb7e9", author: "jarvis", ts: "1h ago",  msg: "reorder: push complication above role" },
      { sha: "ee04a53", author: "yu",     ts: "yesterday", msg: "init: scaffold report-site"         },
    ],
    jake: [
      { sha: "77c4102", author: "jake", ts: "4m ago",  msg: "workers: split queue out of pulse"   },
      { sha: "b91a0dd", author: "jake", ts: "22m ago", msg: "wip: carve heartbeat seam"           },
      { sha: "3a1f2cb", author: "yu",   ts: "3d ago",  msg: "apps/api: bump node to 22"           },
    ],
    athena: [], einstein: [], zendude: [],
  };

  // ---------- Shell navigation --------------------------------------------
  const NAV = [
    { id: "command",   label: "Command room", icon: "command" },
    { id: "fleet",     label: "Fleet",        icon: "fleet"   },
    { id: "quests",    label: "Quests",       icon: "quests"  },
    { id: "sentinels", label: "Sentinels",    icon: "sentinel"},
    { id: "telemetry", label: "Telemetry",    icon: "telemetry"},
    { id: "services",  label: "Services",     icon: "services"},
    { id: "policies",  label: "Action policies", icon: "policy"},
    { id: "settings",  label: "Settings",     icon: "settings"},
  ];

  // ========================================================================
  // Public API — every surface reads through this object.
  // Swap these for real implementations during product integration.
  // ========================================================================
  window.HervaldData = {

    // --- Shell ---
    getNav: () => NAV,

    // --- Commanders ---
    listCommanders: () => COMMANDERS,
    getCommander:   (id) => COMMANDERS.find(c => c.id === id) || null,

    // --- Command Room ---
    listMessages:   (commanderId) => MESSAGES[commanderId] || [],
    listWorkers:    (commanderId) => WORKERS[commanderId]  || [],
    listApprovals:  (commanderId) => APPROVALS[commanderId]|| [],
    sendMessage:    (commanderId, text) => {
      const msg = {
        id: "m" + Date.now(),
        role: "user", text,
        ts: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      (MESSAGES[commanderId] = MESSAGES[commanderId] || []).push(msg);
      return msg;
    },
    approve: (commanderId, approvalId) => {
      APPROVALS[commanderId] = (APPROVALS[commanderId] || []).filter(a => a.id !== approvalId);
    },
    deny: (commanderId, approvalId) => {
      APPROVALS[commanderId] = (APPROVALS[commanderId] || []).filter(a => a.id !== approvalId);
    },

    // --- Fleet ---
    getFleet: (windowMinutes = 30) => {
      return {
        windowMinutes,
        commanders: COMMANDERS.map(c => ({
          id: c.id, name: c.name, status: c.status, task: c.task,
          workers: (WORKERS[c.id] || []).length,
          cost: c.cost,
        })),
        spells: FLEET_SPELLS.filter(s => s.startMin >= -windowMinutes),
      };
    },

    // --- Workspace ---
    getWorkspaceTree:    (commanderId) => WORKSPACE_TREES[commanderId] || { name: "—", kind: "dir", path: "/", children: [] },
    getWorkspaceFile:    (path) => WORKSPACE_FILES[path] || null,
    getWorkspaceChanges: (commanderId) => WORKSPACE_CHANGES[commanderId] || [],
    getWorkspaceGitLog:  (commanderId) => WORKSPACE_GIT[commanderId] || [],
  };

})();
