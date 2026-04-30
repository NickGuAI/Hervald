// HI-FI · COMMAND ROOM
// Combined Sessions + Commander + Team — the unified north star.

function CenterTabs({ active, onChange, commander }) {
  const tabs = [
    { id: "chat",      label: "Chat",      hint: "live conversation" },
    { id: "quests",    label: "Quests",    hint: "backlog · this commander" },
    { id: "sentinels", label: "Sentinels", hint: "scheduled + memory" },
    { id: "cron",      label: "Cron",      hint: "stateless schedule" },
    { id: "identity",  label: "Identity",  hint: "config · Commander.md" },
  ];
  return (
    <div style={{
      display: "flex", alignItems: "stretch",
      borderBottom: "1px solid var(--border-hair)",
      background: "var(--washi-white)",
      paddingLeft: 20,
    }}>
      {tabs.map(t => {
        const on = t.id === active;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            appearance: "none", background: "transparent", border: "none",
            padding: "14px 18px 12px", cursor: "pointer",
            fontFamily: "var(--font-body)", fontSize: 12,
            letterSpacing: "0.08em", textTransform: "uppercase",
            color: on ? "var(--sumi-black)" : "var(--fg-subtle)",
            borderBottom: on ? "2px solid var(--sumi-black)" : "2px solid transparent",
            marginBottom: -1,
            position: "relative",
          }}>
            {t.label}
          </button>
        );
      })}
      <div style={{ flex: 1 }}/>
      <div style={{ padding: "14px 20px 12px", fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.10em", textTransform: "uppercase", alignSelf: "center" }}>
        {commander.id} · {tabs.find(x => x.id === active).hint}
      </div>
    </div>
  );
}

function CommandRoom() {
  const [activeSession, setActiveSession] = React.useState("jarvis");
  const [selectedSub, setSelectedSub] = React.useState("writer");
  const [centerTab, setCenterTab] = React.useState("chat"); // chat · quests · sentinels · cron · identity

  const commanders = [
    {
      id: "athena", shortHash: "d66a5217", status: "running", pending: 0, ago: "9h",
      task: "drafting Q3 strategy",
      team: [
        { n: "planner", s: "running", t: "structuring outline" },
        { n: "analyst", s: "idle",    t: "awaiting plan" },
      ],
    },
    {
      id: "jarvis", shortHash: "8b1c0f43", status: "waiting", pending: 2, ago: "7h",
      task: "Q3 baseline review",
      team: [
        { n: "researcher", s: "running", t: "pulling comp data · bloomberg", tool: "web_fetch" },
        { n: "fetcher",    s: "running", t: "indexing · 312/500 files",       tool: "bash", parent: "researcher" },
        { n: "writer",     s: "waiting", t: "send_email → finance team",      pending: 1, action: "send_email" },
        { n: "publisher",  s: "waiting", t: "publish q3-baseline.pdf",        pending: 1, parent: "writer", action: "publish" },
        { n: "critic",     s: "idle",    t: "awaiting draft" },
      ],
    },
    {
      id: "jake", shortHash: "2f9ea1b0", status: "running", pending: 0, ago: "6h",
      task: "repo indexing",
      team: [
        { n: "lexer",  s: "running", t: "parsing src/*" },
        { n: "tagger", s: "running", t: "embedding chunks" },
      ],
    },
  ];

  const stale = [
    { id: "pm-920",      status: "idle", ago: "2d" },
    { id: "srsweworker", status: "idle", ago: "2d" },
    { id: "mbp01",       status: "done", ago: "1d" },
  ];

  const active = commanders.find(c => c.id === activeSession);
  const subInfo = active?.team.find(x => x.n === selectedSub);

  const statusColor = (s) => s === "running" ? "var(--moss-stone)" :
    s === "waiting" ? "var(--persimmon)" : s === "failed" ? "var(--vermillion-seal)" :
    s === "done" ? "var(--brushed-gray)" : "var(--stone-gray)";

  const statusGlow = (s) => s === "running" ? "0 0 0 3px rgba(107,123,94,0.18)" :
    s === "waiting" ? "0 0 0 3px rgba(212,118,58,0.20)" :
    s === "failed" ? "0 0 0 3px rgba(194,59,34,0.18)" : "none";

  return (
    <div style={{
      background: "var(--washi-white)",
      border: "1px solid var(--border-hair)",
      borderRadius: "4px 20px 4px 20px",
      overflow: "hidden",
      boxShadow: "0 4px 20px rgba(28,28,28,0.04), 0 40px 80px rgba(28,28,28,0.06)",
    }}>
      {/* Top chrome bar */}
      <div style={{
        background: "#0F0F0F", color: "var(--washi-white)",
        padding: "10px 20px", display: "flex", alignItems: "center", gap: 14,
        fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase",
      }}>
        <span style={{ color: "var(--vermillion-seal)", fontSize: 14, letterSpacing: 0 }}>●</span>
        <span style={{ fontFamily: "var(--font-primary)", fontSize: 15, textTransform: "none", letterSpacing: "-0.01em" }}>Hervald</span>
        <span style={{ opacity: 0.4, marginLeft: 4 }}>/</span>
        <span style={{ opacity: 0.7 }}>command room</span>
        <span style={{ flex: 1 }}/>
        <span style={{ opacity: 0.5 }}>3 running · 3 stale · 3 pending</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: centerTab === "chat" ? "240px 1fr 340px" : "240px 1fr", minHeight: 720 }}>
        {/* ============ SESSIONS RAIL ============ */}
        <aside style={{ background: "var(--aged-paper)", padding: "22px 16px 20px", borderRight: "1px solid var(--border-hair)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
            <span className="whisper" style={{ fontSize: 10 }}>sessions · {commanders.length}</span>
            <button style={{
              fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 20,
              color: "var(--fg-muted)", background: "transparent", border: "none",
              cursor: "pointer", padding: 0, lineHeight: 1,
            }}>+</button>
          </div>

          {/* Commander cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {commanders.map(c => {
              const isActive = c.id === activeSession;
              return (
                <div key={c.id}
                  onClick={() => { setActiveSession(c.id); setSelectedSub(c.team[0]?.n); }}
                  style={{
                    background: isActive ? "var(--washi-white)" : "transparent",
                    borderRadius: "3px 14px 3px 14px",
                    borderLeft: isActive ? "2px solid var(--sumi-black)" : "2px solid transparent",
                    boxShadow: isActive ? "0 2px 6px rgba(28,28,28,0.04)" : "none",
                    cursor: "pointer",
                    overflow: "hidden",
                  }}>
                  <div style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: statusColor(c.status),
                        boxShadow: statusGlow(c.status),
                      }}/>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg)" }}>{c.id}</span>
                      {c.pending > 0 && (
                        <span style={{
                          marginLeft: "auto",
                          fontFamily: "var(--font-body)", fontSize: 9,
                          color: "var(--vermillion-seal)",
                          letterSpacing: "0.10em", textTransform: "uppercase",
                          background: "rgba(194,59,34,0.08)",
                          padding: "2px 6px",
                          borderRadius: "2px 6px 2px 6px",
                        }}>{c.pending} pend</span>
                      )}
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 4, lineHeight: 1.4 }}>
                      {c.task}
                    </div>
                  </div>
                  {/* sub team condensed */}
                  {isActive && (
                    <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
                      {c.team.map(t => (
                        <div key={t.n} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px", paddingLeft: t.parent ? 18 : 8 }}>
                          <span style={{
                            width: 5, height: 5, borderRadius: "50%",
                            background: statusColor(t.s),
                          }}/>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: t.s === "idle" ? "var(--fg-subtle)" : "var(--fg-muted)" }}>{t.n}</span>
                          {t.pending > 0 && (
                            <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--vermillion-seal)" }}>·{t.pending}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Stale */}
          <div style={{ marginTop: 28, paddingTop: 16, borderTop: "1px solid var(--border-hair)" }}>
            <span className="whisper" style={{ fontSize: 10 }}>stale · {stale.length}</span>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
              {stale.map(s => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 6px", opacity: 0.55 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ink-mist)" }}/>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-subtle)" }}>{s.id}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--fg-faint)" }}>{s.ago}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: "auto", paddingTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="whisper" style={{ fontSize: 9 }}>live · auto-refresh</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-faint)" }}>phase 2</span>
          </div>
        </aside>

        {/* ============ CENTER · tabbed ============ */}
        <main style={{ padding: "0", display: "flex", flexDirection: "column", background: "var(--washi-white)", minWidth: 0 }}>
          {/* Center tab strip */}
          <CenterTabs active={centerTab} onChange={setCenterTab} commander={active} />

          {centerTab === "chat" && (
          <>
          {/* Chat header */}
          <div style={{ padding: "18px 28px", borderBottom: "1px solid var(--border-hair)", display: "flex", alignItems: "center", gap: 14 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--fg)" }}>{active.id}</span>
                <span style={{
                  fontFamily: "var(--font-body)", fontSize: 9,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: statusColor(active.status),
                  padding: "2px 8px",
                  border: `1px solid ${statusColor(active.status)}`,
                  borderRadius: "2px 8px 2px 8px",
                }}>{active.status}</span>
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 2 }}>
                commander · {active.task}
              </div>
            </div>
            <div style={{ flex: 1 }}/>
            <div style={{ display: "flex", gap: 10, fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--fg-subtle)" }}>
              <span>$48.33</span>
              <span style={{ color: "var(--border-firm)" }}>·</span>
              <span>6h 02s</span>
              <span style={{ color: "var(--border-firm)" }}>·</span>
              <span>{active.team.length} agents</span>
            </div>
            <button style={{
              marginLeft: 10,
              fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: "0.04em",
              padding: "6px 14px", color: "var(--fg-muted)",
              background: "transparent", border: "1px solid var(--border-firm)",
              borderRadius: "2px 10px 2px 10px", cursor: "pointer",
            }}>Workspace</button>
          </div>

          {/* Transcript */}
          <div style={{ flex: 1, padding: "28px 32px 12px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto" }}>
            {/* Delegation trace */}
            <div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
                delegated · 3 sub-agents
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {active.team.filter(t => !t.parent).map(t => (
                  <span key={t.n} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "var(--aged-paper)", padding: "5px 12px",
                    borderRadius: "2px 10px 2px 10px",
                    fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)",
                    border: "1px solid var(--border-hair)",
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor(t.s) }}/>
                    {t.n}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ background: "var(--aged-paper)", padding: "14px 18px", borderRadius: "3px 16px 3px 16px", maxWidth: 540 }}>
              <p style={{ margin: 0, fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.7 }}>
                I've dispatched researcher and fetcher to pull comparative data — they should land within the hour. Writer is drafting from the existing outline. Critic is holding for the draft before reviewing tone.
              </p>
            </div>

            <div style={{ alignSelf: "flex-end", maxWidth: 420 }}>
              <div style={{ background: "var(--sumi-black)", color: "var(--washi-white)", padding: "14px 18px", borderRadius: "16px 3px 16px 3px", fontSize: 14, lineHeight: 1.7 }}>
                Keep the Q3 section under 400 words and leave room for Miko's chart.
              </div>
            </div>

            {/* Sub-agent action request (approval gate) */}
            <div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--persimmon)" }}/>
                writer · action · needs approval
              </div>
              <div style={{ background: "var(--washi-white)", padding: "14px 18px", borderRadius: "3px 16px 3px 16px", maxWidth: 540, border: "1px solid var(--persimmon)", borderLeft: "3px solid var(--persimmon)" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--persimmon)", marginBottom: 6 }}>
                  send_email — finance@hervald.co
                </div>
                <p style={{ margin: 0, fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.7 }}>
                  Ready to send Q3 baseline draft to the finance team for comment. Subject: <i>"Q3 baseline — review by Fri"</i>. Attachment: <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>q3-baseline.pdf</span>.
                </p>
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <button style={{ fontFamily: "var(--font-body)", fontSize: 12, padding: "6px 14px", border: "none", background: "var(--sumi-black)", color: "var(--washi-white)", borderRadius: "2px 10px 2px 10px", letterSpacing: "0.04em", cursor: "pointer" }}>Approve & send</button>
                  <button style={{ fontFamily: "var(--font-body)", fontSize: 12, padding: "6px 14px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-muted)", borderRadius: "2px 10px 2px 10px", letterSpacing: "0.04em", cursor: "pointer" }}>Preview</button>
                  <button style={{ fontFamily: "var(--font-body)", fontSize: 12, padding: "6px 14px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-subtle)", borderRadius: "2px 10px 2px 10px", letterSpacing: "0.04em", cursor: "pointer" }}>Deny</button>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)", textAlign: "center", padding: "4px 0" }}>action awaiting approval</div>
          </div>

          {/* Composer */}
          <div style={{ padding: "14px 28px 20px", borderTop: "1px solid var(--border-hair)" }}>
            <div style={{ border: "1px solid var(--border-hair)", borderRadius: "4px 16px 4px 16px", padding: "14px 18px", background: "var(--washi-white)", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--fg-subtle)", fontStyle: "italic", flex: 1 }}>
                Send a message to {active.id}… use @writer to address a sub-agent directly
              </span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.12em", textTransform: "uppercase" }}>enter · send</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.12em", textTransform: "uppercase" }}>tab · queue</span>
            </div>
          </div>
          </>
          )}

          {centerTab === "quests"    && <QuestsPanel    commander={active} />}
          {centerTab === "sentinels" && <SentinelsPanel commander={active} />}
          {centerTab === "cron"      && <CronPanel      commander={active} />}
          {centerTab === "identity"  && <IdentityPanel  commander={active} />}
        </main>

        {/* ============ TEAM PANEL · chat-only ============ */}
        {centerTab === "chat" && (
        <aside style={{ background: "var(--aged-paper)", padding: "22px 20px 20px", borderLeft: "1px solid var(--border-hair)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span className="whisper" style={{ fontSize: 10 }}>team · {active.team.length}</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--vermillion-seal)", letterSpacing: "0.10em", textTransform: "uppercase" }}>
              {active.pending} pend
            </span>
          </div>
          <div style={{ fontFamily: "var(--font-primary)", fontSize: 20, fontWeight: 300, lineHeight: 1.2, marginBottom: 16, color: "var(--fg)" }}>
            {active.id}'s team
          </div>

          {/* Team list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 18 }}>
            {active.team.map(t => {
              const isSel = t.n === selectedSub;
              return (
                <div key={t.n}
                  onClick={() => setSelectedSub(t.n)}
                  style={{
                    display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center",
                    padding: "9px 10px", paddingLeft: t.parent ? 22 : 10,
                    borderRadius: "2px 12px 2px 12px",
                    background: isSel ? "var(--washi-white)" : "transparent",
                    borderLeft: isSel ? "2px solid var(--sumi-black)" : "2px solid transparent",
                    boxShadow: isSel ? "0 2px 6px rgba(28,28,28,0.04)" : "none",
                    cursor: "pointer",
                    transition: "all 0.2s var(--ease-gentle)",
                  }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: statusColor(t.s),
                    boxShadow: statusGlow(t.s),
                  }}/>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: t.s === "idle" ? "var(--fg-subtle)" : "var(--fg)" }}>
                      {t.n}
                      {t.parent && <span style={{ color: "var(--fg-faint)", marginLeft: 6, fontSize: 10 }}>↳ {t.parent}</span>}
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{t.t}</div>
                  </div>
                  {t.pending > 0 && (
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--vermillion-seal)", letterSpacing: "0.10em", textTransform: "uppercase" }}>{t.pending}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Selected sub detail */}
          {subInfo && (
            <div style={{ marginTop: "auto", padding: 16, background: "var(--washi-white)", borderRadius: "3px 14px 3px 14px", border: "1px solid var(--border-hair)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <div>
                  <span className="whisper" style={{ fontSize: 9 }}>selected</span>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, marginTop: 2, color: "var(--fg)" }}>{subInfo.n}</div>
                </div>
                <span style={{
                  fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.10em",
                  textTransform: "uppercase", padding: "2px 8px",
                  color: statusColor(subInfo.s),
                  border: `1px solid ${statusColor(subInfo.s)}`,
                  borderRadius: "2px 8px 2px 8px",
                }}>{subInfo.s}</span>
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.6, marginBottom: 12 }}>
                {subInfo.t}
              </div>
              {(subInfo.tool || subInfo.action) && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: subInfo.action ? "var(--persimmon)" : "var(--fg-subtle)", marginBottom: 12, paddingBottom: 10, borderBottom: "1px dashed var(--border-soft)" }}>
                  {subInfo.action ? `action · ${subInfo.action}` : `tool · ${subInfo.tool}`}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={{ fontFamily: "var(--font-body)", fontSize: 11, padding: "6px 12px", border: "1px solid var(--sumi-black)", background: "var(--sumi-black)", color: "var(--washi-white)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em", cursor: "pointer" }}>Open</button>
                {subInfo.pending > 0 && (
                  <button style={{ fontFamily: "var(--font-body)", fontSize: 11, padding: "6px 12px", border: "1px solid var(--persimmon)", background: "transparent", color: "var(--persimmon)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em", cursor: "pointer" }}>Approve action</button>
                )}
                <button style={{ fontFamily: "var(--font-body)", fontSize: 11, padding: "6px 12px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-muted)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em", cursor: "pointer" }}>Workspace</button>
              </div>
            </div>
          )}
        </aside>
        )}
      </div>
    </div>
  );
}

function CommandRoomSurface() {
  return (
    <div>
      <SurfaceHeading
        count="01"
        title="Command room"
        subtitle="Sessions on the left, the active commander's chat in the center, their team on the right. One room, every agent visible."
      />
      <CommandRoom />
      <div style={{ marginTop: 28, maxWidth: 720, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.7 }}>
        The three panels operate in lockstep: clicking a commander in the rail swaps both the center chat and the right-hand team. Approvals are reserved for agent <b style={{fontWeight:500}}>actions</b> with real-world consequence — sending email, publishing, running shell. File edits flow through without gating; you see the resulting content, not a diff to approve.
      </div>
    </div>
  );
}

Object.assign(window, { CommandRoomSurface });
