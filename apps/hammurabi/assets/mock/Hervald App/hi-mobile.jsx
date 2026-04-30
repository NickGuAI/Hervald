// HI-FI · MOBILE
// Interactive mobile prototype. Tap the bottom nav or the screen buttons to move
// through sessions → commander chat → team drawer → approval sheet → fleet → inbox.
// Mirrors the desktop Command Room + Fleet split; stays monitoring-first.

const { useState: useStateM, useEffect: useEffectM } = React;

// ------- shared tokens / helpers ----------
const statusColorM = (s) =>
  s === "running" ? "var(--moss-stone)" :
  s === "waiting" ? "var(--persimmon)" :
  s === "failed"  ? "var(--vermillion-seal)" :
  s === "done"    ? "var(--brushed-gray)" : "var(--stone-gray)";

const statusGlowM = (s) =>
  s === "running" ? "0 0 0 3px rgba(107,123,94,0.18)" :
  s === "waiting" ? "0 0 0 3px rgba(212,118,58,0.20)" :
  s === "failed"  ? "0 0 0 3px rgba(194,59,34,0.18)" : "none";

// ------- phone frame ----------------------
function PhoneFrame({ children, label, sub, width = 340, height = 700 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{
        width, height,
        border: "11px solid #0F0F0F",
        borderRadius: 48,
        background: "var(--washi-white)",
        overflow: "hidden",
        position: "relative",
        boxShadow: "0 30px 60px rgba(28,28,28,0.14), 0 8px 20px rgba(28,28,28,0.06)",
      }}>
        {/* Dynamic Island */}
        <div style={{
          position: "absolute", top: 10, left: "50%",
          transform: "translateX(-50%)", width: 110, height: 30,
          background: "#0F0F0F", borderRadius: 18, zIndex: 30,
        }}/>
        {/* Status bar */}
        <div style={{
          position: "absolute", top: 14, left: 0, right: 0,
          padding: "0 28px", display: "flex", justifyContent: "space-between",
          fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600,
          color: "var(--fg)", zIndex: 25,
        }}>
          <span>9:41</span>
          <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ fontSize: 10 }}>●●●●</span>
            <span style={{ width: 22, height: 10, border: "1px solid var(--fg)", borderRadius: 2, padding: 1, display: "inline-flex" }}>
              <span style={{ flex: 1, background: "var(--fg)", borderRadius: 1 }}/>
            </span>
          </span>
        </div>
        {/* Screen content */}
        <div style={{
          paddingTop: 50, height: "100%",
          fontFamily: "var(--font-body)",
          display: "flex", flexDirection: "column",
          position: "relative",
        }}>
          {children}
        </div>
      </div>
      {label && (
        <div style={{ textAlign: "center", maxWidth: width + 20 }}>
          <div style={{ fontFamily: "var(--font-primary)", fontSize: 20, fontWeight: 400, letterSpacing: "-0.01em", color: "var(--fg)" }}>{label}</div>
          {sub && <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 4, letterSpacing: "0.04em", lineHeight: 1.5 }}>{sub}</div>}
        </div>
      )}
    </div>
  );
}

// ------- data -----------------------------
const SESSIONS_M = [
  { n: "athena", s: "running", task: "drafting Q3 strategy",  team: 2, ago: "9h", p: 0, cost: "$12.40" },
  { n: "jarvis", s: "waiting", task: "Q3 baseline review",    team: 5, ago: "7h", p: 3, cost: "$48.33" },
  { n: "jake",   s: "running", task: "repo indexing",         team: 2, ago: "6h", p: 0, cost: "$3.10" },
  { n: "pm-920", s: "idle",    task: "last heard Tuesday",    team: 0, ago: "2d", p: 0, cost: "$0.80", stale: true },
];

const JARVIS_TEAM_M = [
  { n: "researcher", s: "running", t: "bloomberg · comp data", tool: "web_fetch" },
  { n: "fetcher",    s: "running", t: "indexing 312/500",      tool: "bash", depth: 1 },
  { n: "writer",     s: "waiting", t: "send_email → finance",  pending: 2, action: "send_email" },
  { n: "editor",     s: "failed",  t: "apply_patch exit 1",    pending: 1, depth: 1, action: "apply_patch" },
  { n: "critic",     s: "idle",    t: "awaiting draft" },
];

// ------- SCREEN · Sessions list -----------
function SessionsScreen({ goChat, goFleet }) {
  return (
    <>
      {/* Header */}
      <div style={{ padding: "10px 22px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>hervald</span>
            <h1 style={{ fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 32, margin: "3px 0 0", letterSpacing: "-0.02em", lineHeight: 1 }}>Sessions</h1>
          </div>
          <button style={{ fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 26, color: "var(--fg-muted)", background: "transparent", border: "none", padding: 0, lineHeight: 1, cursor: "pointer" }}>+</button>
        </div>
        {/* Summary chips */}
        <div style={{ display: "flex", gap: 10, marginTop: 14, fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase" }}>
          <span style={{ color: "var(--moss-stone)" }}>● 2 running</span>
          <span style={{ color: "var(--persimmon)" }}>● 1 waiting</span>
          <span style={{ color: "var(--vermillion-seal)", marginLeft: "auto" }}>3 pend</span>
        </div>
        {/* Filter pills */}
        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          {["All", "Active", "Stale"].map((t, i) => (
            <span key={t} style={{
              fontSize: 11, letterSpacing: "0.06em",
              padding: "5px 12px", borderRadius: "2px 10px 2px 10px",
              background: i === 0 ? "var(--sumi-black)" : "transparent",
              color: i === 0 ? "var(--washi-white)" : "var(--fg-muted)",
              border: i === 0 ? "none" : "1px solid var(--border-hair)",
            }}>{t}</span>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, padding: "4px 18px 12px", display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        {SESSIONS_M.map(r => {
          const highlight = r.n === "jarvis";
          return (
            <div key={r.n}
              onClick={() => r.n === "jarvis" && goChat()}
              style={{
                padding: "14px 15px",
                background: "var(--washi-white)",
                border: "1px solid var(--border-hair)",
                borderLeft: highlight ? "2px solid var(--sumi-black)" : "1px solid var(--border-hair)",
                borderRadius: "3px 16px 3px 16px",
                opacity: r.stale ? 0.6 : 1,
                boxShadow: highlight ? "0 4px 12px rgba(28,28,28,0.05)" : "none",
                cursor: r.stale ? "default" : "pointer",
              }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: statusColorM(r.s),
                    boxShadow: statusGlowM(r.s),
                  }}/>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--fg)" }}>{r.n}</span>
                </div>
                {r.p > 0 && (
                  <span style={{
                    fontSize: 9, color: "var(--vermillion-seal)",
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    background: "rgba(194,59,34,0.08)",
                    padding: "2px 7px", borderRadius: "2px 6px 2px 6px",
                  }}>{r.p} pend</span>
                )}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-muted)", fontStyle: "italic", marginTop: 5, lineHeight: 1.4 }}>{r.task}</div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 6, display: "flex", gap: 10 }}>
                <span>{r.ago} ago</span>
                {r.team > 0 && <span>· {r.team} sub</span>}
                <span style={{ marginLeft: "auto", color: "var(--fg-faint)" }}>{r.cost}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ------- SCREEN · Chat (with team peek) ---
function ChatScreen({ goBack, goTeam, goApproval }) {
  return (
    <>
      {/* Chat header */}
      <div style={{ padding: "4px 16px 10px", borderBottom: "1px solid var(--border-hair)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span onClick={goBack} style={{ fontSize: 20, color: "var(--fg-muted)", cursor: "pointer", width: 24 }}>‹</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--persimmon)", boxShadow: "0 0 0 3px rgba(212,118,58,0.2)" }}/>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 14 }}>jarvis</span>
              <span style={{
                fontFamily: "var(--font-body)", fontSize: 8,
                letterSpacing: "0.12em", textTransform: "uppercase",
                color: "var(--persimmon)",
                padding: "1px 6px",
                border: "1px solid var(--persimmon)",
                borderRadius: "2px 6px 2px 6px",
              }}>waiting</span>
            </div>
            <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 5 }}>
              {[0, 1, 2, 3].map(i => (
                <span key={i} style={{ width: i === 1 ? 14 : 4, height: 4, borderRadius: 3, background: i === 1 ? "var(--sumi-black)" : "var(--ink-mist)" }}/>
              ))}
            </div>
          </div>
          <span style={{ fontSize: 18, color: "var(--fg-subtle)", width: 24, textAlign: "right" }}>⋮</span>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 8, fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--fg-subtle)" }}>
          <span>$48.33</span>
          <span style={{ color: "var(--border-firm)" }}>·</span>
          <span>6h 02s</span>
          <span style={{ color: "var(--border-firm)" }}>·</span>
          <span>5 agents</span>
        </div>
      </div>

      {/* Collapsed team peek */}
      <div onClick={goTeam} style={{ padding: "10px 16px", background: "var(--aged-paper)", borderBottom: "1px solid var(--border-hair)", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>team · 5</span>
          <span style={{ fontSize: 9, color: "var(--fg-faint)", letterSpacing: "0.1em", textTransform: "uppercase" }}>pull to expand ⌄</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {JARVIS_TEAM_M.slice(0, 3).map(x => (
            <div key={x.n} style={{
              flex: 1, padding: "6px 6px", background: "var(--washi-white)",
              border: "1px solid var(--border-hair)",
              borderRadius: "2px 9px 2px 9px", textAlign: "center", position: "relative",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                display: "inline-block", background: statusColorM(x.s),
              }}/>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, marginTop: 3, color: x.s === "idle" ? "var(--fg-subtle)" : "var(--fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.n}</div>
              {x.pending > 0 && (
                <span style={{
                  position: "absolute", top: -5, right: -5,
                  background: "var(--vermillion-seal)", color: "var(--washi-white)",
                  fontSize: 9, width: 16, height: 16, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{x.pending}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Transcript */}
      <div style={{ flex: 1, padding: "14px 14px 8px", display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        {/* Delegation trace */}
        <div style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--fg-faint)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: -2 }}>
          delegated · 3 sub-agents
        </div>
        <div style={{ alignSelf: "flex-start", maxWidth: "87%", background: "var(--aged-paper)", padding: "10px 13px", borderRadius: "3px 14px 3px 14px" }}>
          <p style={{ margin: 0, fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.6 }}>Researcher is on Bloomberg. Writer is drafting v2. Critic is holding for the draft.</p>
        </div>
        <div style={{ alignSelf: "flex-end", maxWidth: "87%", background: "var(--sumi-black)", color: "var(--washi-white)", padding: "10px 13px", borderRadius: "14px 3px 14px 3px" }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>Keep Q3 under 400 words.</p>
        </div>

        {/* Inline action-approval card */}
        <div style={{ marginTop: 4 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--fg-faint)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 5, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--persimmon)" }}/>
            writer · action · needs approval
          </div>
          <div style={{
            padding: "11px 12px",
            border: "1px solid var(--persimmon)",
            borderLeft: "3px solid var(--persimmon)",
            borderRadius: "3px 12px 3px 12px",
            background: "rgba(212,118,58,0.04)",
          }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--persimmon)" }}>send_email → finance@hervald.co</div>
            <p style={{ margin: "5px 0 8px", fontSize: 11, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.5 }}>Send Q3 baseline draft for comment by Friday?</p>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={goApproval} style={{ flex: 1, fontSize: 11, padding: "6px 10px", border: "none", background: "var(--sumi-black)", color: "var(--washi-white)", borderRadius: "2px 9px 2px 9px", letterSpacing: "0.04em", cursor: "pointer", fontFamily: "var(--font-body)" }}>Review</button>
              <button style={{ fontSize: 11, padding: "6px 12px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-muted)", borderRadius: "2px 9px 2px 9px", fontFamily: "var(--font-body)" }}>Deny</button>
            </div>
          </div>
        </div>
      </div>

      {/* Composer */}
      <div style={{ padding: "10px 14px 14px", borderTop: "1px solid var(--border-hair)" }}>
        <div style={{ padding: "10px 12px", border: "1px solid var(--border-hair)", borderRadius: "3px 14px 3px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic" }}>Send to jarvis…</span>
          <span style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em" }}>@  ↑</span>
        </div>
      </div>
    </>
  );
}

// ------- SCREEN · Team drawer -------------
function TeamScreen({ goBack }) {
  return (
    <>
      <div style={{ padding: "6px 16px 10px", borderBottom: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span onClick={goBack} style={{ fontSize: 20, color: "var(--fg-muted)", cursor: "pointer" }}>‹</span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>jarvis' team · 5</span>
        <span style={{ fontSize: 14, color: "var(--fg-subtle)" }}>⌃</span>
      </div>

      <div style={{ padding: "16px 14px 14px", background: "var(--aged-paper)", flex: 1, overflow: "auto" }}>
        <div style={{ fontFamily: "var(--font-primary)", fontStyle: "italic", fontWeight: 400, fontSize: 20, marginBottom: 3, color: "var(--fg)" }}>jarvis</div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)", fontStyle: "italic", marginBottom: 14 }}>Q3 baseline review · 7h</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {JARVIS_TEAM_M.map(t => (
            <div key={t.n} style={{
              display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10,
              padding: "11px 12px", paddingLeft: 12 + (t.depth || 0) * 18,
              background: "var(--washi-white)",
              border: "1px solid var(--border-hair)",
              borderLeft: t.s === "failed" ? "2px solid var(--vermillion-seal)" :
                          t.s === "waiting" ? "2px solid var(--persimmon)" : "1px solid var(--border-hair)",
              borderRadius: "2px 12px 2px 12px",
              alignItems: "center",
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: statusColorM(t.s),
                boxShadow: statusGlowM(t.s),
              }}/>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: t.s === "idle" ? "var(--fg-subtle)" : "var(--fg)" }}>
                  {t.n}
                  {t.depth > 0 && <span style={{ color: "var(--fg-faint)", marginLeft: 6, fontSize: 9 }}>↳</span>}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.t}</div>
              </div>
              {t.pending > 0 && (
                <span style={{
                  fontSize: 9, color: "var(--vermillion-seal)",
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  background: "rgba(194,59,34,0.08)",
                  padding: "2px 6px", borderRadius: "2px 6px 2px 6px",
                }}>{t.pending}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", background: "var(--washi-white)" }}>
        {[
          { label: "pending", value: 3, color: "var(--vermillion-seal)" },
          { label: "running", value: 2, color: "var(--moss-stone)" },
          { label: "cost",    value: "$48", color: "var(--fg)" },
        ].map(m => (
          <div key={m.label}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>{m.label}</div>
            <div style={{ fontFamily: "var(--font-primary)", fontSize: 24, fontWeight: 300, color: m.color, lineHeight: 1, marginTop: 3 }}>{m.value}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ------- SCREEN · Fleet (mobile swim) -----
function FleetScreenM() {
  const lanes = [
    { g: "athena", s: "running", rows: [
      { n: "planner", s: "running", t: "outline v3",  act: [1,1,0,1,1,1,1,1,1,1,1,1] },
      { n: "analyst", s: "idle",    t: "awaiting plan", act: [0,0,0,0,0,0,0,0,0,0,0,0] },
    ] },
    { g: "jarvis", s: "waiting", pend: 3, rows: [
      { n: "researcher", s: "running", t: "bloomberg", act: [1,1,1,0,1,1,1,1,1,1,1,1] },
      { n: "writer",     s: "waiting", t: "draft v2",  act: [1,1,1,0,0,"W","W","W","W","W","W","W"], pending: 2 },
      { n: "editor",     s: "failed",  t: "exit 1",    act: [1,1,"F",0,0,0,0,0,0,0,0,0], pending: 1 },
    ] },
    { g: "jake", s: "running", rows: [
      { n: "lexer",  s: "running", t: "parsing", act: [1,1,1,1,1,1,1,0,1,1,1,1] },
      { n: "tagger", s: "running", t: "embedding", act: [1,0,1,1,1,1,1,1,1,1,1,1] },
    ] },
  ];
  const tick = (a) =>
    a === "F" ? "var(--vermillion-seal)" :
    a === "W" ? "var(--persimmon)" :
    a === 1   ? "var(--sumi-black)" : "rgba(28,28,28,0.06)";

  return (
    <>
      <div style={{ padding: "10px 22px 12px" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>hervald</span>
        <h1 style={{ fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 32, margin: "3px 0 0", letterSpacing: "-0.02em", lineHeight: 1 }}>Fleet</h1>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 4 }}>every commander · last 30 min</div>
      </div>

      {/* Metric trio */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: "1px solid var(--border-hair)", borderBottom: "1px solid var(--border-hair)" }}>
        {[
          { label: "running", value: 5, color: "var(--moss-stone)" },
          { label: "pending", value: 3, color: "var(--vermillion-seal)" },
          { label: "cost 24h", value: "$142", color: "var(--fg)" },
        ].map((m, i) => (
          <div key={m.label} style={{ padding: "12px 14px", borderRight: i < 2 ? "1px solid var(--border-hair)" : "none" }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>{m.label}</div>
            <div style={{ fontFamily: "var(--font-primary)", fontSize: 26, fontWeight: 300, color: m.color, lineHeight: 1, marginTop: 4, letterSpacing: "-0.02em" }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ padding: "12px 18px 6px", display: "flex", gap: 6, overflowX: "auto" }}>
        {["all", "running", "waiting", "failed"].map((t, i) => (
          <span key={t} style={{
            fontSize: 10, letterSpacing: "0.06em", flexShrink: 0,
            padding: "4px 10px", borderRadius: "2px 9px 2px 9px",
            background: i === 0 ? "var(--sumi-black)" : "transparent",
            color: i === 0 ? "var(--washi-white)" : "var(--fg-muted)",
            border: i === 0 ? "none" : "1px solid var(--border-hair)",
          }}>{t}</span>
        ))}
      </div>

      {/* Axis */}
      <div style={{ padding: "6px 18px 0", display: "flex", justifyContent: "space-between", fontFamily: "var(--font-body)", fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--fg-faint)" }}>
        <span>30m</span>
        <span>15m</span>
        <span>now</span>
      </div>

      {/* Lanes */}
      <div style={{ flex: 1, overflow: "auto", padding: "6px 0 10px" }}>
        {lanes.map(g => (
          <div key={g.g}>
            <div style={{
              padding: "8px 18px", background: "var(--aged-paper)",
              borderTop: "1px solid var(--border-hair)", borderBottom: "1px solid var(--border-hair)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColorM(g.s), boxShadow: statusGlowM(g.s) }}/>
              <span style={{ fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 16, color: "var(--fg)" }}>{g.g}</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--fg-subtle)" }}>· {g.rows.length} sub</span>
              <span style={{ flex: 1 }}/>
              {g.pend > 0 && (
                <span style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--vermillion-seal)", letterSpacing: "0.10em", textTransform: "uppercase" }}>{g.pend} pend</span>
              )}
            </div>
            {g.rows.map(r => (
              <div key={r.n} style={{
                padding: "8px 18px",
                borderBottom: "1px solid var(--border-hair)",
                display: "grid", gridTemplateColumns: "75px 1fr auto", gap: 8, alignItems: "center",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColorM(r.s) }}/>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: r.s === "idle" ? "var(--fg-subtle)" : "var(--fg-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.n}</span>
                </div>
                <div style={{ display: "flex", gap: 1.5, height: 16 }}>
                  {r.act.map((a, i) => (
                    <div key={i} style={{ flex: 1, background: tick(a), borderRadius: 1, opacity: a === 0 ? 0.6 : 1 }}/>
                  ))}
                </div>
                <div style={{ textAlign: "right" }}>
                  {r.pending > 0 ? (
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 8, color: "var(--vermillion-seal)", letterSpacing: "0.10em", textTransform: "uppercase", background: "rgba(194,59,34,0.08)", padding: "2px 6px", borderRadius: "2px 6px 2px 6px" }}>{r.pending}</span>
                  ) : (
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase", color: statusColorM(r.s) }}>{r.s}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// ------- SCREEN · Inbox (approvals) -------
function InboxScreenM({ goApproval }) {
  const items = [
    { from: "writer",  parent: "jarvis",     msg: "Send Q3 baseline draft → finance@hervald.co", kind: "action", icon: "send_email", ago: "3m" },
    { from: "editor",  parent: "jarvis",     msg: "apply_patch exited with code 1 — retry with adjusted diff?", kind: "failed", icon: "apply_patch", ago: "11m" },
    { from: "fetcher", parent: "researcher", msg: "Run shell: curl bloomberg.com/quotes/SPY", kind: "permission", icon: "bash", ago: "22m" },
  ];
  return (
    <>
      <div style={{ padding: "10px 22px 12px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>hervald</span>
          <h1 style={{ fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 32, margin: "3px 0 0", letterSpacing: "-0.02em", lineHeight: 1 }}>Inbox</h1>
        </div>
        <span style={{ fontSize: 10, color: "var(--vermillion-seal)", letterSpacing: "0.12em", textTransform: "uppercase" }}>3 pend</span>
      </div>

      <div style={{ padding: "4px 18px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        {items.map((r, i) => {
          const accent = r.kind === "failed" ? "var(--vermillion-seal)" :
                         r.kind === "permission" ? "var(--persimmon)" : "var(--sumi-black)";
          return (
            <div key={i} onClick={r.kind === "action" ? goApproval : undefined} style={{
              padding: "13px 14px",
              border: `1px solid ${r.kind === "failed" ? "var(--vermillion-seal)" : "var(--border-hair)"}`,
              borderLeft: `3px solid ${accent}`,
              borderRadius: "2px 14px 2px 14px",
              background: "var(--washi-white)",
              cursor: r.kind === "action" ? "pointer" : "default",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg)" }}>{r.from}</span>
                  <span style={{ fontSize: 9, color: "var(--fg-faint)", fontStyle: "italic" }}>↳ {r.parent}</span>
                </div>
                <span style={{ fontSize: 9, color: "var(--fg-subtle)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{r.ago}</span>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: accent, marginBottom: 5 }}>
                {r.kind} · {r.icon}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.5 }}>{r.msg}</p>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button style={{ fontSize: 11, padding: "5px 12px", border: "none", background: "var(--sumi-black)", color: "var(--washi-white)", borderRadius: "2px 9px 2px 9px", letterSpacing: "0.04em", fontFamily: "var(--font-body)", cursor: "pointer" }}>Approve</button>
                <button style={{ fontSize: 11, padding: "5px 12px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-muted)", borderRadius: "2px 9px 2px 9px", fontFamily: "var(--font-body)" }}>Open</button>
                <button style={{ fontSize: 11, padding: "5px 12px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-subtle)", borderRadius: "2px 9px 2px 9px", fontFamily: "var(--font-body)", marginLeft: "auto" }}>Deny</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ------- Approval sheet overlay -----------
function ApprovalSheet({ onClose }) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 40,
      background: "rgba(28,28,28,0.25)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "flex-end",
    }}>
      <div style={{
        width: "100%",
        background: "var(--washi-white)",
        borderRadius: "20px 20px 0 0",
        padding: "10px 18px 20px",
        boxShadow: "0 -8px 24px rgba(28,28,28,0.12)",
      }}>
        {/* grabber */}
        <div style={{ width: 38, height: 4, background: "var(--border-firm)", borderRadius: 2, margin: "0 auto 14px" }}/>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--persimmon)" }}>action · needs approval</span>
            <div style={{ fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 22, letterSpacing: "-0.01em", marginTop: 3 }}>Send email</div>
          </div>
          <span onClick={onClose} style={{ fontSize: 22, color: "var(--fg-muted)", cursor: "pointer", lineHeight: 1 }}>×</span>
        </div>

        <div style={{ padding: "12px 14px", background: "var(--aged-paper)", border: "1px solid var(--border-hair)", borderRadius: "3px 14px 3px 14px", marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "64px 1fr", rowGap: 7, fontSize: 11, alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)" }}>from</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>writer <span style={{ color: "var(--fg-faint)", fontStyle: "italic", fontFamily: "var(--font-body)" }}>· jarvis</span></span>

            <span style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)" }}>tool</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>send_email</span>

            <span style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)" }}>to</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>finance@hervald.co</span>

            <span style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)" }}>subject</span>
            <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic" }}>"Q3 baseline — review by Fri"</span>

            <span style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)" }}>attach</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>q3-baseline.pdf · 184kb</span>
          </div>
        </div>

        <div style={{ padding: "11px 13px", background: "var(--washi-white)", border: "1px dashed var(--border-soft)", borderRadius: "3px 12px 3px 12px", marginBottom: 16 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)", marginBottom: 5 }}>body · preview</div>
          <p style={{ margin: 0, fontSize: 11, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.55 }}>
            Attached is the Q3 baseline draft. Please review tone and flag any concerns by end of day Friday…
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ flex: 1, fontSize: 13, padding: "12px 14px", border: "none", background: "var(--sumi-black)", color: "var(--washi-white)", borderRadius: "3px 14px 3px 14px", letterSpacing: "0.04em", fontFamily: "var(--font-body)", cursor: "pointer" }}>Approve & send</button>
          <button onClick={onClose} style={{ fontSize: 13, padding: "12px 16px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-muted)", borderRadius: "3px 14px 3px 14px", fontFamily: "var(--font-body)" }}>Deny</button>
        </div>

        <div style={{ textAlign: "center", marginTop: 12, fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>
          always ask · once · always allow
        </div>
      </div>
    </div>
  );
}

// ------- Bottom tab bar -------------------
function BottomTabs({ tab, setTab }) {
  const tabs = [
    { id: "sessions", label: "Sessions" },
    { id: "fleet",    label: "Fleet" },
    { id: "inbox",    label: "Inbox", badge: 3 },
  ];
  return (
    <div style={{
      padding: "10px 20px 22px", borderTop: "1px solid var(--border-hair)",
      display: "flex", justifyContent: "space-around",
      background: "var(--washi-white)",
    }}>
      {tabs.map(x => {
        const active = tab === x.id;
        return (
          <div key={x.id} onClick={() => setTab(x.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, position: "relative", cursor: "pointer", padding: "0 4px" }}>
            <span style={{ width: 18, height: 2, background: active ? "var(--sumi-black)" : "transparent", marginBottom: 2 }}/>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", color: active ? "var(--sumi-black)" : "var(--fg-subtle)" }}>{x.label}</span>
            {x.badge && <span style={{ position: "absolute", top: -4, right: -10, width: 14, height: 14, borderRadius: "50%", background: "var(--vermillion-seal)", color: "var(--washi-white)", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>{x.badge}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ------- Interactive phone (primary) ------
function InteractivePhone() {
  // tab = sessions | fleet | inbox ; view drills into chat/team
  const [tab, setTab] = useStateM(() => localStorage.getItem("hv-m-tab") || "sessions");
  const [view, setView] = useStateM(() => localStorage.getItem("hv-m-view") || "list"); // list | chat | team
  const [sheet, setSheet] = useStateM(false);

  useEffectM(() => { localStorage.setItem("hv-m-tab", tab); }, [tab]);
  useEffectM(() => { localStorage.setItem("hv-m-view", view); }, [view]);

  // switching tab resets drill view
  const setTabReset = (t) => { setTab(t); setView("list"); };

  return (
    <PhoneFrame label="Live prototype" sub="tap the bottom nav · tap jarvis · tap review">
      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {tab === "sessions" && view === "list" && (
          <SessionsScreen goChat={() => setView("chat")} />
        )}
        {tab === "sessions" && view === "chat" && (
          <ChatScreen goBack={() => setView("list")} goTeam={() => setView("team")} goApproval={() => setSheet(true)} />
        )}
        {tab === "sessions" && view === "team" && (
          <TeamScreen goBack={() => setView("chat")} />
        )}
        {tab === "fleet" && <FleetScreenM />}
        {tab === "inbox" && <InboxScreenM goApproval={() => setSheet(true)} />}

        {sheet && <ApprovalSheet onClose={() => setSheet(false)} />}
      </div>

      <BottomTabs tab={tab} setTab={setTabReset} />
    </PhoneFrame>
  );
}

// ------- Static state phones --------------
function StatePhoneTeam() {
  return (
    <PhoneFrame label="Team drawer" sub="pulled-down full view · tap a sub-agent to open workspace" width={300} height={620}>
      <TeamScreen goBack={() => {}} />
    </PhoneFrame>
  );
}

function StatePhoneApproval() {
  return (
    <PhoneFrame label="Approval sheet" sub="one-tap governance · full tool payload, pre-flight" width={300} height={620}>
      <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
        {/* peek of chat underneath */}
        <div style={{ flex: 1, padding: "14px 14px", opacity: 0.55, pointerEvents: "none", overflow: "hidden" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ alignSelf: "flex-start", maxWidth: "85%", background: "var(--aged-paper)", padding: "10px 13px", borderRadius: "3px 14px 3px 14px" }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.6 }}>Researcher is on Bloomberg. Writer drafting v2.</p>
            </div>
            <div style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--sumi-black)", color: "var(--washi-white)", padding: "10px 13px", borderRadius: "14px 3px 14px 3px" }}>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>Keep Q3 under 400 words.</p>
            </div>
          </div>
        </div>
        <ApprovalSheet onClose={() => {}} />
      </div>
    </PhoneFrame>
  );
}

function StatePhoneFleet() {
  return (
    <PhoneFrame label="Fleet · on the go" sub="every commander · every sub-agent · 30-min swimlane" width={300} height={620}>
      <FleetScreenM />
    </PhoneFrame>
  );
}

// ------- Surface --------------------------
function MobileSurface() {
  return (
    <div>
      <SurfaceHeading
        count="03"
        title="Mobile"
        subtitle="The same three-panel story on a phone. Bottom tabs match the desktop split — Sessions (command room), Fleet, Inbox for approvals. Tap through the live prototype; the static phones show key monitoring states."
      />

      {/* Primary interactive phone */}
      <div style={{
        background: "linear-gradient(170deg, #F7F3EC 0%, #EEE7DC 100%)",
        padding: "80px 24px 72px",
        borderRadius: "4px 20px 4px 20px",
        border: "1px solid var(--border-hair)",
        position: "relative",
      }}>
        {/* corner tag */}
        <div style={{
          position: "absolute", top: 20, left: 28,
          fontFamily: "var(--font-body)", fontSize: 10,
          letterSpacing: "0.16em", textTransform: "uppercase",
          color: "var(--fg-faint)",
        }}>live prototype · tap to explore</div>
        <div style={{
          position: "absolute", top: 20, right: 28,
          fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 14,
          color: "var(--fg-subtle)",
        }}>iphone 15 · 393 × 852</div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <InteractivePhone />
        </div>
      </div>

      {/* Static state phones */}
      <div style={{ marginTop: 64 }}>
        <div style={{ marginBottom: 24, display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg-faint)" }}>03a · states</span>
          <span style={{ fontFamily: "var(--font-primary)", fontSize: 22, fontWeight: 300, letterSpacing: "-0.01em" }}>Key monitoring moments</span>
        </div>
        <div style={{
          background: "var(--aged-paper)",
          padding: "60px 20px 52px",
          borderRadius: "4px 20px 4px 20px",
          border: "1px solid var(--border-hair)",
        }}>
          <div style={{ display: "flex", gap: 36, justifyContent: "center", flexWrap: "wrap" }}>
            <StatePhoneTeam />
            <StatePhoneApproval />
            <StatePhoneFleet />
          </div>
        </div>
      </div>

      {/* Design notes */}
      <div style={{ marginTop: 48, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 32, maxWidth: 1100, marginLeft: "auto", marginRight: "auto" }}>
        {[
          { h: "Three-tab architecture", b: "Sessions · Fleet · Inbox. Sessions is the daily driver — list drills into commander chat, which drills into the team drawer. Fleet and Inbox are monitoring surfaces for when you're away from desk." },
          { h: "Approvals are the point", b: "Mobile is governance-first. Action requests surface inline in chat, as an Inbox card, and as a pre-flight sheet with the full tool payload — from, to, attachment, body preview — before you approve." },
          { h: "Team peek, not team page", b: "A three-chip team strip sits above every commander transcript. Tap to expand the full hierarchy; sub-agent nesting, fail + waiting borders, and a pending · running · cost summary all stay one tap away." },
          { h: "Parity with desktop", b: "Same status ladder, same hanko-red pend badges, same asymmetric corners, same type. The phone is the command room compressed — not a different product." },
        ].map(c => (
          <div key={c.h}>
            <div style={{ fontFamily: "var(--font-primary)", fontSize: 18, fontWeight: 400, marginBottom: 8, color: "var(--fg)" }}>{c.h}</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.7, fontStyle: "italic" }}>{c.b}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { MobileSurface });
