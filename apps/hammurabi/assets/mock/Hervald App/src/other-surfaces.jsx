// ============================================================
// Hervald — Placeholder surfaces for the other nav items.
// Kept minimal & on-brand so the prototype "feels" whole.
// Agent can replace each with the real screen.
// ============================================================

function Placeholder({ title, note, children }) {
  return (
    <div style={{
      flex: 1, padding: "40px 48px",
      overflow: "auto", background: "var(--bg)",
    }}>
      <div style={{
        maxWidth: 880,
        padding: "40px 48px",
        background: "var(--washi-white)",
        border: "1px solid var(--border-hair)",
        borderRadius: "4px 24px 4px 24px",
      }}>
        <div style={{
          fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "var(--fg-subtle)", marginBottom: 12,
        }}>Placeholder · wire to real data</div>
        <h1 className="display" style={{ margin: 0 }}>{title}</h1>
        <p style={{ margin: "14px 0 0", color: "var(--fg-muted)", maxWidth: 560 }}>{note}</p>
        {children && <div style={{ marginTop: 32 }}>{children}</div>}
      </div>
    </div>
  );
}

function SessionsSurface() {
  return (
    <Placeholder title="Sessions"
      note="Every past and current session, searchable. From the North Star: Command room is the live view; this is the archive.">
      <div style={{ display: "grid", gap: 8 }}>
        {window.HV_DATA.commanders.map(c => (
          <div key={c.id} style={{
            padding: "14px 16px",
            display: "flex", alignItems: "center", gap: 14,
            background: "var(--bg)",
            border: "1px solid var(--border-hair)",
            borderRadius: "2px 12px 2px 12px",
          }}>
            <AgentAvatar commander={c} size={28}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, color: "var(--fg)" }}>
                {c.name} <span style={{ color: "var(--fg-faint)" }}>· {c.activeSession || "no active session"}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--fg-subtle)", marginTop: 2 }}>{c.description}</div>
            </div>
            <StatusDot state={c.status} pulse={c.status==="connected"}/>
          </div>
        ))}
      </div>
    </Placeholder>
  );
}

function QuestsSurface() {
  return <Placeholder title="Quests" note="Pending · active · done · failed. Quests are durable tasks a commander owns; they survive restarts."/>;
}

function SentinelsSurface() {
  return <Placeholder title="Sentinels" note="Background watchers. Each sentinel triggers a commander on a condition: file changed, inbox label, webhook, timer."/>;
}

function CronSurface() {
  return <Placeholder title="Cron" note="Time-based triggers. The 6am digest, the Monday standup, the end-of-quarter rollup."/>;
}

function IdentitySurface() {
  return <Placeholder title="Identity" note="Runtime config · API keys · secrets · per-commander env. Scoped per workspace."/>;
}

function SettingsSurface() {
  return <Placeholder title="Settings" note="Preferences — theme, density, notifications, keyboard shortcuts, and experimental flags."/>;
}

Object.assign(window, {
  SessionsSurface, QuestsSurface, SentinelsSurface,
  CronSurface, IdentitySurface, SettingsSurface,
});
