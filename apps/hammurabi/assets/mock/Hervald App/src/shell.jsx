// ============================================================
// Hervald — Shell: dark top bar (Hervald · COMMAND ROOM · status)
// No left nav at the shell level — the page occupies full width;
// inner surfaces carry their own navigation.
// ============================================================

function Shell({ active, setActive, children, onOpenWorkspace, theme, setTheme, density, setDensity }) {
  const { commanders, workers, approvals } = window.HV_DATA;
  const running = workers.filter(w => w.state === "active").length;
  const stale   = 3;
  const pending = approvals.length;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100vh", width: "100vw",
      background: "var(--bg)", overflow: "hidden",
    }}>
      <TopBar active={active} setActive={setActive}
              running={running} stale={stale} pending={pending}/>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {children}
      </div>
    </div>
  );
}

function TopBar({ active, setActive, running, stale, pending }) {
  const crumb = {
    command:   "COMMAND ROOM",
    fleet:     "FLEET",
    sessions:  "SESSIONS",
    quests:    "QUESTS",
    sentinels: "SENTINELS",
    cron:      "CRON",
    identity:  "IDENTITY",
    settings:  "SETTINGS",
  }[active] || "";

  return (
    <header style={{
      height: 48, flexShrink: 0,
      padding: "0 22px",
      background: "#0e0e10",
      color: "var(--washi-white)",
      display: "flex", alignItems: "center", gap: 16,
      borderBottom: "1px solid #000",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{
          width: 9, height: 9, borderRadius: "50%",
          background: "var(--vermillion-seal)",
          display: "inline-block",
        }}/>
        <span style={{
          fontFamily: "var(--font-primary)", fontStyle: "italic",
          fontSize: 15, color: "var(--washi-white)",
        }}>Hervald</span>
      </div>

      <span style={{ color: "#3a3a3d", margin: "0 4px" }}>/</span>

      <button onClick={() => setActive("command")} style={{
        background: "transparent", border: "none", cursor: "pointer",
        color: active === "command" ? "var(--washi-white)" : "#a09d96",
        fontFamily: "var(--font-body)", fontSize: 11,
        letterSpacing: "0.18em", textTransform: "uppercase",
        padding: "4px 2px",
      }}>{crumb || "COMMAND ROOM"}</button>

      {/* Hidden quick nav — keep Fleet + other tabs reachable */}
      <span style={{ flex: 1 }}/>
      <nav style={{ display: "flex", gap: 4, marginRight: 16 }}>
        {[
          { id: "command", label: "Command" },
          { id: "fleet",   label: "Fleet" },
          { id: "mobile",  label: "Mobile" },
          { id: "settings",label: "Settings" },
        ].map(t => (
          <button key={t.id} onClick={() => setActive(t.id)} style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: active === t.id ? "var(--washi-white)" : "#6f6c67",
            padding: "4px 10px",
            fontFamily: "var(--font-body)", fontSize: 10.5,
            letterSpacing: "0.14em", textTransform: "uppercase",
            borderBottom: active === t.id ? "1px solid var(--washi-white)" : "1px solid transparent",
          }}>{t.label}</button>
        ))}
      </nav>

      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase",
        color: "#a09d96",
      }}>
        <span><b style={{ color: "var(--washi-white)", fontWeight: 500 }}>{running}</b> running</span>
        <span style={{ color: "#3a3a3d" }}>·</span>
        <span><b style={{ color: "var(--washi-white)", fontWeight: 500 }}>{stale}</b> stale</span>
        <span style={{ color: "#3a3a3d" }}>·</span>
        <span style={{ color: "var(--vermillion-seal)" }}><b style={{ fontWeight: 500 }}>{pending}</b> pending</span>
      </div>
    </header>
  );
}

Object.assign(window, { Shell });
