// HI-FI · FLEET DASHBOARD
// Swimlane view across ALL commanders + their sub-agents.

function FleetDashboard() {
  const lanes = [
    { g: "athena", rows: [
      { n: "athena",  s: "running", role: "cmd", activity: [1,1,1,0,1,1,1,1,1,1,1,0,1,1,1,1,1,1], t: "drafting Q3" },
      { n: "planner", s: "running", activity: [1,1,0,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1], t: "outline v3", depth: 1 },
      { n: "analyst", s: "idle",    activity: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], t: "awaiting plan", depth: 1 },
    ]},
    { g: "jarvis", rows: [
      { n: "jarvis",     s: "waiting", role: "cmd", activity: [1,1,1,1,0,1,1,1,1,"W","W","W","W","W",0,0,0,0], t: "Q3 baseline", pending: 3 },
      { n: "researcher", s: "running", activity: [1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1], t: "bloomberg · comp data", depth: 1 },
      { n: "fetcher",    s: "running", activity: [0,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1], t: "indexing 312/500", depth: 2 },
      { n: "writer",     s: "waiting", activity: [1,1,1,1,1,1,0,0,"W","W","W","W","W","W","W","W","W","W"], t: "draft v2 · review?", depth: 1, pending: 2 },
      { n: "editor",     s: "failed",  activity: [1,1,1,0,1,1,"F",0,0,0,0,0,0,0,0,0,0,0], t: "apply_patch exit 1", depth: 2, pending: 1 },
      { n: "critic",     s: "idle",    activity: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], t: "awaiting draft", depth: 1 },
    ]},
    { g: "jake", rows: [
      { n: "jake",   s: "running", role: "cmd", activity: [1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1,1], t: "repo indexing" },
      { n: "lexer",  s: "running", activity: [1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1], t: "parsing src/*", depth: 1 },
      { n: "tagger", s: "running", activity: [1,1,1,0,1,1,1,1,1,1,1,1,0,1,1,1,1,1], t: "embedding", depth: 1 },
    ]},
  ];

  const tickColor = (a) =>
    a === "F" ? "var(--vermillion-seal)" :
    a === "W" ? "var(--persimmon)" :
    a === 1   ? "var(--sumi-black)" : "rgba(28,28,28,0.05)";

  const statusColor = (s) => s === "running" ? "var(--moss-stone)" :
    s === "waiting" ? "var(--persimmon)" : s === "failed" ? "var(--vermillion-seal)" :
    s === "done" ? "var(--brushed-gray)" : "var(--stone-gray)";

  const totalAgents = lanes.reduce((a, g) => a + g.rows.length, 0);
  const running = lanes.flatMap(g => g.rows).filter(r => r.s === "running").length;
  const pending = lanes.flatMap(g => g.rows).reduce((a, r) => a + (r.pending || 0), 0);

  return (
    <div style={{
      background: "var(--washi-white)",
      border: "1px solid var(--border-hair)",
      borderRadius: "4px 20px 4px 20px",
      overflow: "hidden",
      boxShadow: "0 4px 20px rgba(28,28,28,0.04), 0 40px 80px rgba(28,28,28,0.06)",
    }}>
      {/* Top bar */}
      <div style={{
        background: "#0F0F0F", color: "var(--washi-white)",
        padding: "10px 20px", display: "flex", alignItems: "center", gap: 14,
        fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase",
      }}>
        <span style={{ color: "var(--vermillion-seal)", fontSize: 14, letterSpacing: 0 }}>●</span>
        <span style={{ fontFamily: "var(--font-primary)", fontSize: 15, textTransform: "none", letterSpacing: "-0.01em" }}>Hervald</span>
        <span style={{ opacity: 0.4, marginLeft: 4 }}>/</span>
        <span style={{ opacity: 0.7 }}>fleet</span>
        <span style={{ flex: 1 }}/>
        <span style={{ opacity: 0.5 }}>last 30 min · live</span>
      </div>

      {/* Metric strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid var(--border-hair)" }}>
        {[
          { label: "agents", value: totalAgents, sub: `${lanes.length} commanders` },
          { label: "running", value: running, sub: "active now", accent: "var(--moss-stone)" },
          { label: "pending", value: pending, sub: "awaiting input", accent: "var(--vermillion-seal)" },
          { label: "cost · 24h", value: "$142", sub: "↓ 12% w/w" },
        ].map(m => (
          <div key={m.label} style={{ padding: "20px 24px", borderRight: "1px solid var(--border-hair)" }}>
            <div className="whisper" style={{ fontSize: 10 }}>{m.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
              <span style={{ fontFamily: "var(--font-primary)", fontSize: 38, fontWeight: 300, color: m.accent || "var(--fg)", letterSpacing: "-0.02em", lineHeight: 1 }}>{m.value}</span>
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 6 }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ padding: "14px 24px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid var(--border-hair)" }}>
        <span className="whisper" style={{ fontSize: 10 }}>filter</span>
        {["all", "running", "waiting", "failed", "idle"].map((t,i) => (
          <button key={t} style={{
            fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: "0.04em",
            padding: "5px 12px",
            background: i===0 ? "var(--sumi-black)" : "transparent",
            color: i===0 ? "var(--washi-white)" : "var(--fg-muted)",
            border: i===0 ? "none" : "1px solid var(--border-hair)",
            borderRadius: "2px 10px 2px 10px", cursor: "pointer",
          }}>{t}</button>
        ))}
        <span style={{ flex: 1 }}/>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", letterSpacing: "0.10em", textTransform: "uppercase" }}>group · commander</span>
      </div>

      {/* Swimlane body */}
      <div style={{ padding: "24px 0 12px" }}>
        {/* Time axis */}
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 110px", padding: "0 24px", marginBottom: 10, alignItems: "baseline" }}>
          <span className="whisper" style={{ fontSize: 10 }}>agent</span>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.10em", textTransform: "uppercase", padding: "0 4px" }}>
            <span>30m ago</span>
            <span>20m</span>
            <span>10m</span>
            <span>now</span>
          </div>
          <span className="whisper" style={{ fontSize: 10, textAlign: "right" }}>status</span>
        </div>

        {lanes.map((group, gi) => (
          <div key={group.g} style={{ marginBottom: gi < lanes.length - 1 ? 22 : 0 }}>
            {/* Commander group header */}
            <div style={{
              padding: "8px 24px", background: "var(--aged-paper)",
              borderTop: "1px solid var(--border-hair)", borderBottom: "1px solid var(--border-hair)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor(group.rows[0].s) }}/>
              <span style={{ fontFamily: "var(--font-primary)", fontSize: 18, fontWeight: 400, color: "var(--fg)", fontStyle: "italic" }}>{group.g}</span>
              <span className="whisper" style={{ fontSize: 9 }}>· {group.rows.length - 1} sub</span>
              <span style={{ flex: 1 }}/>
              {group.rows.some(r => r.pending) && (
                <span style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--vermillion-seal)", letterSpacing: "0.10em", textTransform: "uppercase" }}>
                  {group.rows.reduce((a,r) => a + (r.pending || 0), 0)} pend
                </span>
              )}
            </div>

            {/* Rows */}
            {group.rows.map(r => (
              <div key={r.n} style={{
                display: "grid", gridTemplateColumns: "220px 1fr 110px",
                padding: "10px 24px", alignItems: "center",
                borderBottom: "1px solid var(--border-hair)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, paddingLeft: (r.depth || 0) * 18 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: statusColor(r.s),
                    boxShadow: r.s === "running" ? "0 0 0 3px rgba(107,123,94,0.15)" :
                               r.s === "waiting" ? "0 0 0 3px rgba(212,118,58,0.15)" :
                               r.s === "failed"  ? "0 0 0 3px rgba(194,59,34,0.15)" : "none",
                  }}/>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: r.role === "cmd" ? "var(--fg)" : "var(--fg-muted)" }}>
                      {r.n}
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{r.t}</div>
                  </div>
                </div>

                {/* Activity */}
                <div style={{ display: "flex", gap: 2, height: 22, alignItems: "stretch" }}>
                  {r.activity.map((a, i) => (
                    <div key={i} style={{
                      flex: 1, background: tickColor(a),
                      borderRadius: 1,
                      opacity: a === 0 ? 0.6 : 1,
                    }}/>
                  ))}
                </div>

                {/* Status */}
                <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
                  {r.pending > 0 && (
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--vermillion-seal)", letterSpacing: "0.10em", textTransform: "uppercase", background: "rgba(194,59,34,0.08)", padding: "2px 7px", borderRadius: "2px 6px 2px 6px" }}>
                      {r.pending}
                    </span>
                  )}
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: statusColor(r.s) }}>{r.s}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ padding: "16px 24px", background: "var(--aged-paper)", borderTop: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="whisper" style={{ fontSize: 9 }}>⬛ active  ⬛ waiting  ⬛ failed  ⬜ idle</span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", letterSpacing: "0.10em", textTransform: "uppercase" }}>ticks · 100s each · click row to open session</span>
      </div>
    </div>
  );
}

function FleetSurface() {
  return (
    <div>
      <SurfaceHeading
        count="02"
        title="Fleet"
        subtitle="A dashboard across the whole workforce — every commander and every sub-agent, grouped, with a 30-minute activity timeline."
      />
      <FleetDashboard />
      <div style={{ marginTop: 28, maxWidth: 720, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.7 }}>
        The swimlane answers one question: <b style={{fontWeight:500}}>where is work actually happening?</b> Idle rows are quiet paper; running rows pulse black; waiting and failed slots shout in vermillion and persimmon. Click any row to jump into that session's command room.
      </div>
    </div>
  );
}

Object.assign(window, { FleetSurface });
