// ============================================================
// Hervald — Mobile surface (hi-fi prototype, v2)
// Reads window.HV_DATA. Same visual vocabulary as desktop.
// Bottom nav: Sessions · Automations · Inbox · Settings.
// Chat is immersive (no bottom nav), dark theme, desktop parity.
// ============================================================

const { useState: useStateMo, useEffect: useEffectMo, useRef: useRefMo } = React;

// ---------- theme factory — light matches desktop, dark is immersive ----
// Chat uses this palette. Other surfaces use design-system vars directly.
function getTheme(mode) {
  if (mode === "light") return {
    mode: "light",
    bg:        "#FAF8F5",               // washi-white
    bgSoft:    "#F0EBE3",               // aged-paper
    bgCard:    "#FAF8F5",
    bgRow:     "#F5F1E9",
    line:      "rgba(28,28,28,0.06)",   // border-hair
    lineSoft:  "rgba(28,28,28,0.04)",
    lineFirm:  "rgba(28,28,28,0.20)",
    fg:        "#1C1C1C",               // sumi-black
    fgMuted:   "#4A4A4A",               // brushed-gray
    fgFaint:   "#A8A19A",               // stone-gray
    accent:    "#D4763A",               // persimmon
    accentDim: "#8a4f28",
    accentWash:"rgba(212,118,58,0.10)",
    danger:    "#C23B22",               // vermillion-seal
    dangerWash:"rgba(194,59,34,0.08)",
    success:   "#6B7B5E",               // moss-stone
    shield:    "rgba(212,118,58,0.08)",
    btnText:   "#FAF8F5",
    btnBg:     "#1C1C1C",
    thinking:  "#6e6e98",
    thinkingBorder: "#9797be",
  };
  return {
    mode: "dark",
    bg:        "#17171a",
    bgSoft:    "#1d1d21",
    bgCard:    "#1f1f24",
    bgRow:     "#202024",
    line:      "rgba(255,255,255,0.07)",
    lineSoft:  "rgba(255,255,255,0.05)",
    lineFirm:  "rgba(255,255,255,0.16)",
    fg:        "#e8e6e1",
    fgMuted:   "#a4a09a",
    fgFaint:   "#6f6c67",
    accent:    "#d4763a",
    accentDim: "#8a4f28",
    accentWash:"rgba(212,118,58,0.12)",
    danger:    "#c23b22",
    dangerWash:"rgba(194,59,34,0.10)",
    success:   "#86917a",
    shield:    "rgba(212,118,58,0.08)",
    btnText:   "#1c1c1c",
    btnBg:     "#e8e6e1",
    thinking:  "#8a8ab3",
    thinkingBorder: "#6e6ea3",
  };
}

// ---------- live theme handle — reads from localStorage, re-renders via event
let __moMode = (typeof localStorage !== "undefined" && localStorage.getItem("hv-mo-theme")) || "dark";
function __setMoMode(m) {
  __moMode = m;
  try { localStorage.setItem("hv-mo-theme", m); } catch (e) {}
  window.dispatchEvent(new CustomEvent("hv-mo-theme-change", { detail: m }));
}
function useMoMode() {
  const [m, setM] = useStateMo(__moMode);
  useEffectMo(() => {
    const onChange = (e) => setM(e.detail);
    window.addEventListener("hv-mo-theme-change", onChange);
    return () => window.removeEventListener("hv-mo-theme-change", onChange);
  }, []);
  return m;
}
// DK is a live Proxy — reads from the current theme every access, so legacy
// DK.bg / DK.fg / etc. continue to work and automatically switch when mode changes.
const DK = new Proxy({}, {
  get(_, key) { return getTheme(__moMode)[key]; },
  has(_, key) { return key in getTheme(__moMode); },
  ownKeys()   { return Reflect.ownKeys(getTheme(__moMode)); },
  getOwnPropertyDescriptor(_, key) { return { enumerable: true, configurable: true, value: getTheme(__moMode)[key] }; },
});

const moStateColor = (s) =>
  s === "active"    ? "#86917a" :
  s === "connected" ? "#86917a" :
  s === "paused"    ? "#d4763a" :
  s === "blocked"   ? "#c23b22" :
  s === "queued"    ? "#a4a09a" :
  s === "done"      ? "#6f6c67" :
                      "#8b8b8b";

function formatAgoShort(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.round(diff)}m`;
  if (diff < 1440) return `${Math.round(diff / 60)}h`;
  return `${Math.round(diff / 1440)}d`;
}

// =========================================================
// PHONE CHROME
// =========================================================
function MoPhoneFrame({ children, width = 390, height = 820 }) {
  return (
    <div style={{
      width, height,
      border: "11px solid #0F0F0F",
      borderRadius: 54,
      background: "var(--washi-white)",
      overflow: "hidden",
      position: "relative",
      boxShadow: "0 30px 60px rgba(28,28,28,0.22), 0 8px 20px rgba(28,28,28,0.10)",
      flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", top: 10, left: "50%",
        transform: "translateX(-50%)", width: 118, height: 32,
        background: "#0F0F0F", borderRadius: 20, zIndex: 30,
      }}/>
      <MoStatusBar/>
      <div style={{
        paddingTop: 50, height: "100%",
        fontFamily: "var(--font-body)",
        display: "flex", flexDirection: "column",
        position: "relative",
        background: "var(--washi-white)",
      }}>
        {children}
      </div>
    </div>
  );
}

function MoStatusBar({ dark = false }) {
  const color = dark ? "#e8e6e1" : "var(--fg)";
  return (
    <div style={{
      position: "absolute", top: 16, left: 0, right: 0,
      padding: "0 30px", display: "flex", justifyContent: "space-between",
      fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600,
      color, zIndex: 25, pointerEvents: "none",
    }}>
      <span>9:41</span>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, letterSpacing: 1 }}>●●●●</span>
        <span style={{ width: 24, height: 11, border: `1.2px solid ${color}`, borderRadius: 3, padding: 1.2, display: "inline-flex" }}>
          <span style={{ flex: 1, background: color, borderRadius: 1 }}/>
        </span>
      </span>
    </div>
  );
}

// =========================================================
// SCREEN · SESSIONS
// =========================================================
function MoSessionsScreen({ goChat, onSelect }) {
  const { commanders, approvals } = window.HV_DATA;
  const [filter, setFilter] = useStateMo("all");

  const running = commanders.filter(c => c.status === "connected").length;
  const waiting = commanders.filter(c => c.status === "paused").length;
  const pendTot = approvals.length;

  const visible = commanders.filter(c => {
    if (filter === "all") return true;
    if (filter === "active") return c.status === "connected" || c.status === "paused";
    if (filter === "waiting") return c.status === "paused";
    return true;
  });

  return (
    <>
      <div style={{ padding: "10px 22px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <span className="whisper" style={{ fontSize: 10 }}>hervald</span>
            <h1 style={{ fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 34, margin: "3px 0 0", letterSpacing: "-0.02em", lineHeight: 1 }}>Sessions</h1>
          </div>
          <button style={{
            fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 30,
            color: "var(--fg-muted)", background: "transparent", border: "none",
            padding: 0, lineHeight: 1, cursor: "pointer",
          }}>+</button>
        </div>
        <div style={{
          display: "flex", gap: 14, marginTop: 14,
          fontFamily: "var(--font-body)", fontSize: 10.5,
          letterSpacing: "0.12em", textTransform: "uppercase",
        }}>
          <span style={{ color: "var(--moss-stone)", display: "flex", alignItems: "center", gap: 5 }}>
            <StatusDot state="active" size={6} pulse/>{running} running
          </span>
          {waiting > 0 && (
            <span style={{ color: "var(--persimmon)", display: "flex", alignItems: "center", gap: 5 }}>
              <StatusDot state="paused" size={6}/>{waiting} waiting
            </span>
          )}
          <span style={{ color: "var(--vermillion-seal)", marginLeft: "auto" }}>{pendTot} pend</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          {["all", "active", "waiting"].map(t => (
            <button key={t} onClick={() => setFilter(t)} style={{
              fontFamily: "var(--font-body)", fontSize: 11,
              letterSpacing: "0.08em", textTransform: "uppercase",
              padding: "5px 12px", borderRadius: "2px 10px 2px 10px",
              background: filter === t ? "var(--sumi-black)" : "transparent",
              color:      filter === t ? "var(--washi-white)" : "var(--fg-muted)",
              border:     filter === t ? "none" : "1px solid var(--border-hair)",
              cursor: "pointer",
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div className="hv-scroll" style={{
        flex: 1, padding: "4px 18px 14px",
        display: "flex", flexDirection: "column", gap: 10, overflowY: "auto",
      }}>
        {visible.map(c => {
          const pend = approvals.filter(a => a.commanderId === c.id).length;
          const isWaiting = c.status === "paused";
          const highlight = pend > 0;
          const statusKey = c.status === "connected" ? "active"
                          : c.status === "paused"    ? "blocked"
                          :                            "idle";
          return (
            <div key={c.id} onClick={() => { onSelect(c.id); goChat(); }} style={{
              padding: "14px 16px",
              background: "var(--washi-white)",
              border: "1px solid var(--border-hair)",
              borderLeft: highlight ? "2px solid var(--vermillion-seal)"
                        : isWaiting ? "2px solid var(--persimmon)"
                        :             "1px solid var(--border-hair)",
              borderRadius: "3px 16px 3px 16px",
              boxShadow: highlight ? "0 4px 12px rgba(28,28,28,0.05)" : "none",
              cursor: "pointer",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <AgentAvatar commander={c} size={28} active/>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--fg)" }}>{c.name}</span>
                      <StatusDot state={statusKey} size={6} pulse={statusKey === "active"}/>
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 1 }}>
                      {c.title.toLowerCase()}
                    </div>
                  </div>
                </div>
                {pend > 0 && (
                  <span style={{
                    fontSize: 9.5, color: "var(--vermillion-seal)",
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    background: "rgba(194,59,34,0.08)",
                    padding: "2px 8px", borderRadius: "2px 6px 2px 6px", fontWeight: 500,
                  }}>{pend} pend</span>
                )}
              </div>
              <div style={{
                fontFamily: "var(--font-body)", fontSize: 12,
                color: "var(--fg-muted)", fontStyle: "italic",
                marginTop: 9, lineHeight: 1.5,
                overflow: "hidden", textOverflow: "ellipsis",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              }}>{c.description}</div>
              <div style={{
                fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)",
                letterSpacing: "0.1em", textTransform: "uppercase",
                marginTop: 9, display: "flex", gap: 10,
              }}>
                <span>uptime {c.uptime}</span>
                <span style={{ marginLeft: "auto", color: "var(--fg-faint)" }}>
                  {c.idle === "0m 0s" ? "now" : `idle ${c.idle}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// =========================================================
// CHAT · dark theme, desktop parity
// =========================================================

// ---- tool-call divider row (mono label, ~top spacing)
function MoToolCallRow({ count, label = "done" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "4px 0 2px 36px",
      fontFamily: "var(--font-mono)", fontSize: 10.5,
      color: DK.fgFaint, letterSpacing: "0.02em",
    }}>
      <span style={{ fontSize: 11, color: DK.fgFaint }}>↻</span>
      <span style={{ color: DK.fgMuted }}>{count} tool calls</span>
      <span style={{ color: DK.success, marginLeft: 4 }}>✓</span>
      <span style={{ color: DK.fgMuted }}>{label}</span>
    </div>
  );
}

// ---- bash command row (small inline card)
function MoBashRow({ cmd }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "8px 12px 8px 36px",
      position: "relative",
    }}>
      <div style={{
        position: "absolute", left: 10, top: 10,
        width: 18, height: 18, borderRadius: 4,
        border: `1px solid ${DK.accentDim}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: DK.accent, fontFamily: "var(--font-mono)", fontSize: 9.5,
      }}>›_</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: DK.fgMuted, marginBottom: 2,
        }}>Bash</div>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: DK.fgFaint,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{cmd}</div>
      </div>
    </div>
  );
}

// ---- "thinking" label with blinking dots
function MoThinkingRow() {
  return (
    <div style={{ paddingLeft: 36 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 7,
        fontFamily: "var(--font-mono)", fontSize: 10.5,
        letterSpacing: "0.16em", textTransform: "uppercase",
        color: "#8a8ab3", marginBottom: 6,
      }}>
        <span style={{
          width: 12, height: 12, borderRadius: "50%",
          border: "1px solid #6e6ea3",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 8, color: "#8a8ab3",
        }}>i</span>
        thinking
      </div>
      <div style={{
        paddingLeft: 0,
        display: "flex", gap: 4, alignItems: "center",
        color: DK.fgFaint, fontSize: 14, lineHeight: 1,
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 4, height: 4, borderRadius: "50%",
            background: DK.fgFaint,
            animation: `moBlink 1.4s ${i * 0.18}s infinite ease-in-out`,
          }}/>
        ))}
      </div>
    </div>
  );
}

// ---- Assistant message bubble — shield avatar gutter + left-border card
function MoAssistantMessage({ children, avatarIcon = "shield" }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "2px 0" }}>
      <div style={{
        width: 24, height: 24, flexShrink: 0,
        borderRadius: 5,
        border: `1px solid ${DK.accentDim}`,
        background: "rgba(212,118,58,0.08)",
        color: DK.accent,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon name={avatarIcon} size={12}/>
      </div>
      <div style={{
        flex: 1, minWidth: 0,
        padding: "10px 14px",
        background: DK.bgCard,
        borderLeft: `2px solid ${DK.accent}`,
        borderRadius: "2px 10px 2px 10px",
        fontFamily: "var(--font-body)", fontSize: 12.5,
        color: DK.fg, lineHeight: 1.65,
      }}>{children}</div>
    </div>
  );
}

// ---- user message (right-aligned)
function MoUserMessage({ children }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", padding: "2px 0" }}>
      <div style={{
        maxWidth: "82%",
        padding: "10px 13px",
        background: DK.bgSoft,
        border: `1px solid ${DK.line}`,
        borderRadius: "10px 2px 10px 2px",
        fontFamily: "var(--font-body)", fontSize: 12.5,
        color: DK.fg, lineHeight: 1.6,
      }}>{children}</div>
    </div>
  );
}

// inline code pill — orange-tinted, matches screenshot
function MoCode({ children }) {
  return (
    <code style={{
      fontFamily: "var(--font-mono)", fontSize: 11,
      padding: "1px 6px",
      background: "rgba(212,118,58,0.12)",
      color: DK.accent,
      borderRadius: 3,
      whiteSpace: "nowrap",
    }}>`{children}`</code>
  );
}

// =========================================================
// SCREEN · CHAT (IMMERSIVE · DARK)
// =========================================================
function MoChatScreen({
  commanderId, setCommanderId, goBack,
  onOpenApproval, onOpenWorkspace, onOpenTeam, onOpenSwitcher,
  onKill,
}) {
  useMoMode(); // subscribe to theme changes
  const { commanders, approvals } = window.HV_DATA;
  const commander = commanders.find(c => c.id === commanderId) || commanders[0];
  const myApprovals = approvals.filter(a => a.commanderId === commander.id);
  const activeApproval = myApprovals[myApprovals.length - 1] || null;
  const statusKey = commander.status === "connected" ? "active"
                  : commander.status === "paused"    ? "blocked"
                  :                                     "idle";

  const [menuOpen, setMenuOpen] = useStateMo(false);

  const idx = commanders.findIndex(c => c.id === commander.id);
  const prev = () => setCommanderId(commanders[(idx - 1 + commanders.length) % commanders.length].id);
  const next = () => setCommanderId(commanders[(idx + 1) % commanders.length].id);

  useEffectMo(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div style={{
      position: "absolute", inset: 0,
      background: DK.bg, color: DK.fg,
      display: "flex", flexDirection: "column",
      zIndex: 10,
    }}>
      <MoStatusBar dark/>

      {/* Top bar — compact. Back · chevron commander switcher · kebab */}
      <div style={{
        marginTop: 50,
        padding: "4px 4px 8px",
        display: "flex", alignItems: "center", gap: 2,
        borderBottom: `1px solid ${DK.line}`,
      }}>
        <button onClick={goBack} style={btnIconDk}>
          <Icon name="chevronL" size={18}/>
        </button>

        <button onClick={prev} style={{ ...btnIconDk, padding: "8px 2px", color: DK.fgFaint }}
                title="Previous commander">
          <Icon name="chevronL" size={13}/>
        </button>

        <button onClick={onOpenSwitcher} style={{
          flex: 1, minWidth: 0, background: "transparent", border: "none", cursor: "pointer",
          padding: "4px 4px",
          display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
          color: DK.fg,
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            background: "rgba(212,118,58,0.14)",
            border: `1.5px solid ${DK.accent}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-primary)", fontStyle: "italic",
            fontSize: 13, color: DK.accent,
            flexShrink: 0,
          }}>{commander.avatar}</div>
          <div style={{ textAlign: "left", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: DK.fg }}>{commander.name}</span>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: statusKey === "active" ? DK.success : statusKey === "blocked" ? DK.accent : DK.fgFaint,
                boxShadow: statusKey === "active" ? `0 0 0 3px rgba(134,145,122,0.12)` : "none",
              }}/>
              <Icon name="chevronD" size={10} style={{ color: DK.fgFaint }}/>
            </div>
            <div style={{
              fontFamily: "var(--font-body)", fontSize: 10,
              color: DK.fgFaint, fontStyle: "italic", letterSpacing: "0.04em",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{commander.title.toLowerCase()}</div>
          </div>
        </button>

        <button onClick={next} style={{ ...btnIconDk, padding: "8px 2px", color: DK.fgFaint }}
                title="Next commander">
          <Icon name="chevronR" size={13}/>
        </button>

        <button
          onClick={() => __setMoMode(__moMode === "dark" ? "light" : "dark")}
          style={{ ...btnIconDk, color: DK.fgFaint }}
          title={`Switch to ${__moMode === "dark" ? "light" : "dark"} mode`}>
          <Icon name={__moMode === "dark" ? "eye" : "dot"} size={14}/>
        </button>
        <button style={{ ...btnIconDk, color: DK.fgFaint }} title="Session safe">
          <Icon name="shield" size={14}/>
        </button>
        <button onClick={() => setMenuOpen(v => !v)} style={{
          ...btnIconDk, color: DK.fg,
          background: menuOpen ? (__moMode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(28,28,28,0.05)") : "transparent",
          border: menuOpen ? `1px solid ${DK.accent}` : "1px solid transparent",
          borderRadius: 4,
        }} title="Menu">
          <Icon name="more" size={16} style={{ transform: "rotate(90deg)" }}/>
        </button>
      </div>

      {/* Kebab menu — drop-down from top right */}
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{
            position: "absolute", inset: 0, zIndex: 40,
          }}/>
          <div style={{
            position: "absolute", top: 94, right: 10, zIndex: 41,
            minWidth: 188,
            background: __moMode === "dark" ? "#242428" : "#FAF8F5",
            border: `1px solid ${__moMode === "dark" ? DK.line : "rgba(28,28,28,0.12)"}`,
            borderRadius: "3px 10px 3px 10px",
            boxShadow: __moMode === "dark"
              ? "0 14px 40px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.2)"
              : "0 12px 36px rgba(28,28,28,0.12), 0 2px 8px rgba(28,28,28,0.06)",
            padding: "6px 4px",
            animation: "hvFadeIn 0.15s var(--ease-gentle) both",
          }}>
            <MenuItem icon="fleet" label="Workers"   onClick={() => { onOpenTeam(); setMenuOpen(false); }}/>
            <MenuItem icon="workspace" label="Workspace" kbd="⌘K" onClick={() => { onOpenWorkspace(); setMenuOpen(false); }}/>
            <div style={{ height: 1, background: DK.line, margin: "4px 6px" }}/>
            <MenuItem icon="power" label="Kill Session" danger onClick={() => { onKill(); setMenuOpen(false); }}/>
            <div style={{ height: 1, background: DK.line, margin: "4px 6px" }}/>
            <MenuItem icon="chevronL" label="Back to Sessions" onClick={() => { setMenuOpen(false); goBack(); }}/>
          </div>
        </>
      )}

      {/* Chat transcript — flex:1, scrollable */}
      <div className="hv-scroll" style={{
        flex: 1, overflowY: "auto",
        padding: "14px 12px 6px",
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        <MoAssistantMessage>
          The unit slice is clean. I'm waiting on the production build now, then I'll rerun
          the browser smoke on the commander workspace/chat flows with a fresh console capture.
        </MoAssistantMessage>

        <MoBashRow cmd="/bin/zsh -lc 'pnpm --filter hammurabi run build'"/>

        <MoAssistantMessage>
          Using the <MoCode>playwright</MoCode> skill for the live Hervald parity pass because this needs
          a real browser, console capture, and end-to-end UI flows rather than unit coverage.
        </MoAssistantMessage>

        <MoToolCallRow count={4}/>

        <MoAssistantMessage>
          I've got the app and API up already. Next is a fresh headed browser session on the
          bug-scrub branch so I can verify the real acceptance flows, not cached state from an
          earlier run.
        </MoAssistantMessage>

        <MoToolCallRow count={4}/>

        <MoAssistantMessage>
          The live smoke still has one console error left, but it's narrower now:{" "}
          <MoCode>/api/services/list</MoCode> is racing a 401 during initial sign-in. I'm tracing
          which mount path fires that call first.
        </MoAssistantMessage>

        <MoToolCallRow count={8}/>

        <MoAssistantMessage>
          I found the auth shape mismatch. The API-key login path validates with{" "}
          <MoCode>X-Hammurabi-Api-Key</MoCode>, but the shared client injects the stored key as{" "}
          <MoCode>Authorization: Bearer …</MoCode> — then I'll patch the client to send managed
          API keys on the correct header.
        </MoAssistantMessage>

        <MoToolCallRow count={3}/>

        <MoThinkingRow/>

        {/* spacer so last item isn't glued to composer */}
        <div style={{ height: 6 }}/>

        {activeApproval && (
          <div style={{ paddingLeft: 36, paddingTop: 2 }}>
            <div style={{
              padding: "10px 12px",
              background: "rgba(194,59,34,0.08)",
              border: `1px solid ${DK.danger}`,
              borderLeft: `2px solid ${DK.danger}`,
              borderRadius: "2px 10px 2px 10px",
            }}>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 10,
                color: DK.danger, letterSpacing: "0.14em", textTransform: "uppercase",
                marginBottom: 5, display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: DK.danger }}/>
                {activeApproval.kind} · needs approval
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: DK.fg, marginBottom: 4 }}>
                {activeApproval.title}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: DK.fgMuted, fontStyle: "italic", marginBottom: 10, lineHeight: 1.55 }}>
                {activeApproval.detail}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onOpenApproval(activeApproval.id)} style={{
                  flex: 1, fontSize: 11.5, padding: "7px 10px", border: "none",
                  background: DK.fg, color: DK.bg,
                  borderRadius: "2px 8px 2px 8px",
                  letterSpacing: "0.04em", cursor: "pointer", fontFamily: "var(--font-body)",
                  fontWeight: 500,
                }}>Review</button>
                <button style={{
                  fontSize: 11.5, padding: "7px 14px",
                  border: `1px solid ${DK.line}`,
                  background: "transparent", color: DK.fgMuted,
                  borderRadius: "2px 8px 2px 8px", fontFamily: "var(--font-body)", cursor: "pointer",
                }}>Deny</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Composer — dark */}
      <div style={{
        flexShrink: 0, padding: "8px 12px 14px",
        borderTop: `1px solid ${DK.line}`,
        background: DK.bgSoft,
      }}>
        <div style={{
          padding: "9px 12px",
          border: `1px solid ${DK.line}`,
          background: DK.bgCard,
          borderRadius: "3px 12px 3px 12px",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <button onClick={onOpenWorkspace} style={{ ...btnIconDk, padding: 0 }}>
            <Icon name="paperclip" size={15}/>
          </button>
          <span style={{ flex: 1, fontSize: 12.5, color: DK.fgFaint, fontStyle: "italic" }}>
            Send to {commander.name}…
          </span>
          <button style={{
            background: DK.accent, border: "none", cursor: "pointer",
            color: "#1c1c1c", padding: "5px 8px", display: "flex",
            borderRadius: "2px 7px 2px 7px",
          }}><Icon name="send" size={13}/></button>
        </div>
      </div>
    </div>
  );
}

const btnIconDk = {
  background: "transparent", border: "1px solid transparent",
  cursor: "pointer", color: "#e8e6e1",
  padding: 8, display: "flex", flexShrink: 0, alignItems: "center",
};

function MenuItem({ icon, label, kbd, danger, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px",
      background: "transparent", border: "none",
      borderRadius: "2px 6px 2px 6px",
      color: danger ? DK.danger : DK.fg,
      fontFamily: "var(--font-body)", fontSize: 13,
      cursor: "pointer", textAlign: "left",
    }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <Icon name={icon} size={14} style={{ color: danger ? DK.danger : DK.fgMuted }}/>
      <span style={{ flex: 1 }}>{label}</span>
      {kbd && (
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10.5, color: DK.fgFaint,
          letterSpacing: "0.04em",
        }}>{kbd}</span>
      )}
    </button>
  );
}

// =========================================================
// SHEET · COMMANDER SWITCHER (top-down from chat header)
// =========================================================
function MoCommanderSwitcherSheet({ currentId, onSelect, onClose, dark = false }) {
  const { commanders, approvals } = window.HV_DATA;
  const bg   = dark ? "#202024" : "var(--washi-white)";
  const fg   = dark ? DK.fg     : "var(--fg)";
  const line = dark ? DK.line   : "var(--border-hair)";
  const hi   = dark ? "rgba(255,255,255,0.05)" : "var(--aged-paper)";
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "flex-start",
      animation: "hvFadeIn 0.2s var(--ease-gentle) both",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", marginTop: 86,
        background: bg, color: fg,
        borderRadius: "0 0 18px 18px",
        padding: "8px 14px 18px",
        boxShadow: "0 12px 36px rgba(0,0,0,0.35)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{
            fontFamily: "var(--font-body)", fontSize: 10,
            letterSpacing: "0.18em", textTransform: "uppercase",
            color: dark ? DK.fgFaint : "var(--fg-faint)",
            fontWeight: 500, paddingLeft: 4,
          }}>switch commander · {commanders.length}</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: dark ? DK.fgMuted : "var(--fg-muted)", padding: 6, display: "flex",
          }}><Icon name="close" size={14}/></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {commanders.map(c => {
            const pend = approvals.filter(a => a.commanderId === c.id).length;
            const isCur = c.id === currentId;
            const statusKey = c.status === "connected" ? "active"
                            : c.status === "paused"    ? "blocked"
                            :                            "idle";
            return (
              <button key={c.id} onClick={() => { onSelect(c.id); onClose(); }} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 10px", width: "100%",
                background: isCur ? hi : "transparent",
                border: "none", borderRadius: "2px 10px 2px 10px",
                cursor: "pointer", textAlign: "left",
                color: fg,
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%",
                  background: dark ? "rgba(212,118,58,0.12)" : "var(--aged-paper)",
                  border: `1.5px solid ${c.accent || DK.accent}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-primary)", fontStyle: "italic",
                  fontSize: 13, color: c.accent || DK.accent, flexShrink: 0,
                }}>{c.avatar}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{c.name}</span>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: statusKey === "active" ? DK.success
                               : statusKey === "blocked" ? DK.accent
                               : dark ? DK.fgFaint : "var(--fg-faint)",
                    }}/>
                    {isCur && (
                      <span style={{
                        fontSize: 8.5, color: dark ? DK.fgFaint : "var(--fg-faint)",
                        letterSpacing: "0.14em", textTransform: "uppercase",
                      }}>current</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10.5, color: dark ? DK.fgFaint : "var(--fg-subtle)",
                    fontStyle: "italic", marginTop: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{c.title.toLowerCase()}</div>
                </div>
                {pend > 0 && (
                  <span style={{
                    fontSize: 9, color: DK.danger,
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    background: "rgba(194,59,34,0.10)",
                    padding: "2px 7px", borderRadius: "2px 6px 2px 6px",
                  }}>{pend}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =========================================================
// SHEET · TEAM
// =========================================================
function MoTeamSheet({ commanderId, onClose, onOpenApproval }) {
  const { commanders, workers, approvals } = window.HV_DATA;
  const commander = commanders.find(c => c.id === commanderId) || commanders[0];
  const myWorkers = workers.filter(w => w.commanderId === commander.id);
  const myApprovals = approvals.filter(a => a.commanderId === commander.id);

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 45,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "flex-end",
      animation: "hvFadeIn 0.25s var(--ease-gentle) both",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxHeight: "80%",
        background: "#1d1d21", color: DK.fg,
        borderRadius: "22px 22px 0 0",
        padding: "10px 0 22px",
        display: "flex", flexDirection: "column",
        boxShadow: "0 -12px 36px rgba(0,0,0,0.45)",
      }}>
        <div style={{ width: 42, height: 4, background: "rgba(255,255,255,0.16)", borderRadius: 2, margin: "0 auto 14px" }}/>
        <div style={{
          padding: "0 18px 14px",
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          borderBottom: `1px solid ${DK.line}`,
        }}>
          <div>
            <span style={{
              fontFamily: "var(--font-body)", fontSize: 9.5,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: DK.fgFaint, fontWeight: 500,
            }}>{commander.name}'s team</span>
            <div style={{
              fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 22,
              letterSpacing: "-0.01em", marginTop: 3, lineHeight: 1.1, color: DK.fg,
            }}>{myWorkers.length} workers · {myApprovals.length} pend</div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: DK.fgMuted, padding: 4,
          }}><Icon name="close" size={18}/></button>
        </div>
        <div className="hv-scroll" style={{
          flex: 1, overflowY: "auto", padding: "10px 14px 8px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          {myWorkers.map(w => {
            const workerApprovals = myApprovals.filter(a => a.workerId === w.id);
            const pend = workerApprovals.length;
            const workerApproval = workerApprovals[workerApprovals.length - 1] || null;
            const col = moStateColor(w.state);
            return (
              <div key={w.id}
                onClick={workerApproval ? () => onOpenApproval(workerApproval.id) : undefined}
                style={{
                  display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10,
                  padding: "10px 12px",
                  background: DK.bgCard,
                  border: `1px solid ${DK.line}`,
                  borderLeft: `2px solid ${col}`,
                  borderRadius: "2px 11px 2px 11px",
                  alignItems: "center",
                  cursor: pend > 0 ? "pointer" : "default",
                }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", background: col,
                }}/>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: 12.5,
                      color: w.state === "queued" ? DK.fgFaint : DK.fg,
                    }}>{w.name}</span>
                    {w.kind === "tool" && (
                      <span style={{
                        fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase",
                        color: DK.fgFaint, padding: "1px 5px",
                        border: `1px solid ${DK.line}`, borderRadius: "2px 4px 2px 4px",
                      }}>tool</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10.5, color: DK.fgMuted, fontStyle: "italic",
                    marginTop: 2,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{w.label}</div>
                </div>
                {pend > 0 ? (
                  <span style={{
                    fontSize: 9.5, color: DK.danger,
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    background: "rgba(194,59,34,0.10)",
                    padding: "2px 7px", borderRadius: "2px 6px 2px 6px", fontWeight: 500,
                  }}>{pend} pend</span>
                ) : (
                  <span style={{
                    fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: col, fontWeight: 500,
                  }}>{w.state}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =========================================================
// SCREEN · AUTOMATIONS (Cron · Sentinels · Quests)
// =========================================================
function MoAutomationsScreen() {
  const [tab, setTab] = useStateMo(() => localStorage.getItem("hv-mo-auto") || "cron");
  const [cmdFilter, setCmdFilter] = useStateMo("all");
  useEffectMo(() => { localStorage.setItem("hv-mo-auto", tab); }, [tab]);

  const { commanders } = window.HV_DATA;

  return (
    <>
      <div style={{ padding: "10px 22px 10px" }}>
        <span className="whisper" style={{ fontSize: 10 }}>hervald</span>
        <h1 style={{
          fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 34,
          margin: "3px 0 0", letterSpacing: "-0.02em", lineHeight: 1,
        }}>Automations</h1>
        <div style={{
          fontFamily: "var(--font-body)", fontSize: 11.5,
          color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 4,
        }}>how commanders wake up on their own</div>
      </div>

      <div style={{
        display: "flex", gap: 4,
        padding: "2px 18px 10px",
        borderBottom: "1px solid var(--border-hair)",
      }}>
        {[["cron","Cron"],["sentinels","Sentinels"],["quests","Quests"]].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 6px",
            background: tab === k ? "var(--sumi-black)" : "transparent",
            color:      tab === k ? "var(--washi-white)" : "var(--fg-muted)",
            border:     tab === k ? "none" : "1px solid var(--border-hair)",
            borderRadius: "2px 10px 2px 10px",
            fontFamily: "var(--font-body)", fontSize: 11,
            letterSpacing: "0.08em", textTransform: "uppercase",
            cursor: "pointer",
          }}>{l}</button>
        ))}
      </div>

      {/* Commander filter chips */}
      <div className="hv-scroll" style={{
        display: "flex", gap: 6, padding: "10px 16px 2px",
        overflowX: "auto", overflowY: "hidden", flexShrink: 0,
      }}>
        <button onClick={() => setCmdFilter("all")} style={chipStyle(cmdFilter === "all")}>all</button>
        {commanders.map(c => (
          <button key={c.id} onClick={() => setCmdFilter(c.id)} style={chipStyle(cmdFilter === c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      {tab === "cron"      && <MoCronList cmdFilter={cmdFilter}/>}
      {tab === "sentinels" && <MoSentinelsList cmdFilter={cmdFilter}/>}
      {tab === "quests"    && <MoQuestsList cmdFilter={cmdFilter}/>}
    </>
  );
}

function chipStyle(active) {
  return {
    fontSize: 11, letterSpacing: "0.06em",
    padding: "4px 11px", borderRadius: "999px",
    background: active ? "var(--sumi-black)" : "transparent",
    color:      active ? "var(--washi-white)" : "var(--fg-muted)",
    border:     active ? "1px solid var(--sumi-black)" : "1px solid var(--border-hair)",
    cursor: "pointer", fontFamily: "var(--font-mono)",
    flexShrink: 0, whiteSpace: "nowrap",
  };
}

function MoCronList({ cmdFilter }) {
  const items = [
    { id: "cr1", expr: "0 6 * * *",    name: "morning digest",     commander: "jarvis",   nextIn: "8h 14m", last: "today 6:00", state: "on"  },
    { id: "cr2", expr: "0 9 * * 1",    name: "weekly rollup",      commander: "jarvis",   nextIn: "2d 12h", last: "mon 9:00",   state: "on"  },
    { id: "cr3", expr: "*/15 * * * *", name: "market pulse",       commander: "athena",   nextIn: "11m",    last: "just now",   state: "on"  },
    { id: "cr4", expr: "0 17 * * 5",   name: "weekend brief",      commander: "einstein", nextIn: "3d 7h",  last: "fri 17:00",  state: "paused" },
    { id: "cr5", expr: "30 22 * * *",  name: "wine cellar log",    commander: "sommelier",nextIn: "12h 44m",last: "yesterday",  state: "on"  },
    { id: "cr6", expr: "0 */4 * * *",  name: "inbox sweep",        commander: "courier",  nextIn: "1h 8m",  last: "2h ago",     state: "on"  },
  ].filter(x => cmdFilter === "all" || x.commander === cmdFilter);

  return (
    <div className="hv-scroll" style={{
      flex: 1, padding: "12px 16px 16px", overflowY: "auto",
      display: "flex", flexDirection: "column", gap: 9,
    }}>
      {items.length === 0 && <EmptyHint>No cron tasks for this commander.</EmptyHint>}
      {items.map(c => (
        <div key={c.id} style={{
          padding: "12px 13px",
          background: "var(--washi-white)",
          border: "1px solid var(--border-hair)",
          borderLeft: c.state === "paused" ? "2px solid var(--persimmon)" : "1px solid var(--border-hair)",
          borderRadius: "2px 13px 2px 13px",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg)" }}>{c.expr}</span>
            <span style={{
              fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
              color: c.state === "on" ? "var(--moss-stone)" : "var(--persimmon)", fontWeight: 500,
            }}>{c.state}</span>
          </div>
          <div style={{
            fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--fg)", fontWeight: 500,
            marginBottom: 4,
          }}>{c.name}</div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-subtle)", marginBottom: 6,
          }}>{c.commander}</div>
          <div style={{
            fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)",
            letterSpacing: "0.08em", textTransform: "uppercase",
            display: "flex", gap: 10,
          }}>
            <span>next · {c.nextIn}</span>
            <span style={{ marginLeft: "auto" }}>last {c.last}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MoSentinelsList({ cmdFilter }) {
  const items = [
    { id: "s1", name: "price drop · LVMH",            commander: "courier",  trigger: "yahoo-finance", state: "armed",  fires: "7d · 0" },
    { id: "s2", name: "label:for-jarvis in inbox",    commander: "jarvis",   trigger: "gmail webhook", state: "armed",  fires: "7d · 14" },
    { id: "s3", name: ".hammurabi/cron.yaml changed", commander: "einstein", trigger: "fs-watcher",    state: "armed",  fires: "7d · 2"  },
    { id: "s4", name: "new PR on hammurabi/core",     commander: "jarvis",   trigger: "github webhook",state: "firing", fires: "now" },
    { id: "s5", name: "calendar · new meeting",       commander: "courier",  trigger: "google-cal",    state: "paused", fires: "7d · 5"  },
    { id: "s6", name: "storage > 90%",                commander: "einstein", trigger: "metrics",       state: "armed",  fires: "7d · 0"  },
  ].filter(x => cmdFilter === "all" || x.commander === cmdFilter);

  return (
    <div className="hv-scroll" style={{
      flex: 1, padding: "12px 16px 16px", overflowY: "auto",
      display: "flex", flexDirection: "column", gap: 9,
    }}>
      {items.length === 0 && <EmptyHint>No sentinels for this commander.</EmptyHint>}
      {items.map(s => {
        const col = s.state === "firing" ? "var(--vermillion-seal)"
                  : s.state === "paused" ? "var(--persimmon)"
                  :                         "var(--moss-stone)";
        return (
          <div key={s.id} style={{
            padding: "12px 13px",
            background: "var(--washi-white)",
            border: "1px solid var(--border-hair)",
            borderLeft: `2px solid ${col}`,
            borderRadius: "2px 13px 2px 13px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <StatusDot state={s.state === "firing" ? "blocked" : s.state === "paused" ? "paused" : "active"} size={6} pulse={s.state === "firing"}/>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--fg)", fontWeight: 500 }}>{s.name}</span>
              </div>
              <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: col, fontWeight: 500 }}>{s.state}</span>
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 10.5,
              color: "var(--fg-subtle)", marginBottom: 6,
            }}>{s.trigger} → <span style={{ color: "var(--fg-muted)" }}>{s.commander}</span></div>
            <div style={{
              fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)",
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>fired · {s.fires}</div>
          </div>
        );
      })}
    </div>
  );
}

function MoQuestsList({ cmdFilter }) {
  const items = [
    { id: "q1", title: "hire ops lead",                 commander: "jarvis",   state: "active",  age: "3d",  progress: "4/7 steps" },
    { id: "q2", title: "Q3 board packet",               commander: "jarvis",   state: "active",  age: "5d",  progress: "2/5 steps" },
    { id: "q3", title: "GLP-1 deep research",           commander: "einstein", state: "pending", age: "1h",  progress: "queued" },
    { id: "q4", title: "daily wine log",                commander: "sommelier",state: "active",  age: "14d", progress: "running" },
    { id: "q5", title: "market pulse rollup",           commander: "athena",   state: "done",    age: "2d",  progress: "complete" },
    { id: "q6", title: "cron.yaml audit",               commander: "einstein", state: "failed",  age: "6h",  progress: "1 error" },
    { id: "q7", title: "Q3 finance digest draft",       commander: "jarvis",   state: "active",  age: "2h",  progress: "3/6 steps" },
    { id: "q8", title: "inbox triage",                  commander: "courier",  state: "pending", age: "22m", progress: "queued" },
  ].filter(x => cmdFilter === "all" || x.commander === cmdFilter);

  return (
    <div className="hv-scroll" style={{
      flex: 1, padding: "12px 16px 16px", overflowY: "auto",
      display: "flex", flexDirection: "column", gap: 9,
    }}>
      {items.length === 0 && <EmptyHint>No quests for this commander.</EmptyHint>}
      {items.map(q => {
        const col = q.state === "active"  ? "var(--moss-stone)"
                  : q.state === "pending" ? "var(--stone-gray)"
                  : q.state === "failed"  ? "var(--vermillion-seal)"
                  :                          "var(--brushed-gray)";
        return (
          <div key={q.id} style={{
            padding: "12px 13px",
            background: "var(--washi-white)",
            border: "1px solid var(--border-hair)",
            borderLeft: `2px solid ${col}`,
            borderRadius: "2px 13px 2px 13px",
            opacity: q.state === "done" ? 0.68 : 1,
          }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg)", fontWeight: 500 }}>{q.title}</span>
              <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: col, fontWeight: 500 }}>{q.state}</span>
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 10.5,
              color: "var(--fg-subtle)", display: "flex", gap: 10,
            }}>
              <span>{q.commander}</span>
              <span style={{ color: "var(--fg-faint)" }}>·</span>
              <span>{q.progress}</span>
              <span style={{ marginLeft: "auto", color: "var(--fg-faint)" }}>{q.age}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyHint({ children }) {
  return (
    <div style={{
      padding: "40px 14px", textAlign: "center",
      fontFamily: "var(--font-body)", fontSize: 12, fontStyle: "italic",
      color: "var(--fg-subtle)",
    }}>{children}</div>
  );
}

// =========================================================
// SCREEN · INBOX
// =========================================================
function MoInboxScreen({ onOpenApproval }) {
  const { approvals, commanders, workers } = window.HV_DATA;
  const [filter, setFilter] = useStateMo("all");
  const filtered = approvals.filter(a => filter === "all" || (filter === "high" && a.risk === "high"));

  return (
    <>
      <div style={{
        padding: "10px 22px 12px",
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
      }}>
        <div>
          <span className="whisper" style={{ fontSize: 10 }}>hervald</span>
          <h1 style={{
            fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 34,
            margin: "3px 0 0", letterSpacing: "-0.02em", lineHeight: 1,
          }}>Inbox</h1>
        </div>
        <span style={{
          fontSize: 10.5, color: "var(--vermillion-seal)",
          letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 500,
        }}>{approvals.length} pend</span>
      </div>
      <div style={{ padding: "0 22px 10px", display: "flex", gap: 6 }}>
        {[["all","all"],["high","high risk"]].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            fontSize: 11, letterSpacing: "0.06em",
            padding: "5px 12px", borderRadius: "2px 9px 2px 9px",
            background: filter === k ? "var(--sumi-black)" : "transparent",
            color:      filter === k ? "var(--washi-white)" : "var(--fg-muted)",
            border:     filter === k ? "none" : "1px solid var(--border-hair)",
            cursor: "pointer", fontFamily: "var(--font-body)",
          }}>{l}</button>
        ))}
      </div>
      <div className="hv-scroll" style={{
        padding: "2px 18px 14px", flex: 1,
        display: "flex", flexDirection: "column", gap: 10, overflowY: "auto",
      }}>
        {filtered.map(r => {
          const commander = commanders.find(c => c.id === r.commanderId);
          const worker = workers.find(w => w.id === r.workerId);
          const from = worker?.name || commander?.name;
          const riskColor = r.risk === "high" ? "var(--vermillion-seal)"
                          : r.risk === "medium" ? "var(--persimmon)"
                          : "var(--sumi-black)";
          return (
            <div key={r.id} onClick={() => onOpenApproval(r.id)} style={{
              padding: "14px 14px",
              border: "1px solid var(--border-hair)",
              borderLeft: `3px solid ${riskColor}`,
              borderRadius: "2px 14px 2px 14px",
              background: "var(--washi-white)", cursor: "pointer",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg)" }}>{from}</span>
                  {commander && worker && <span style={{ fontSize: 9.5, color: "var(--fg-faint)", fontStyle: "italic" }}>↳ {commander.name}</span>}
                </div>
                <span style={{ fontSize: 9, color: "var(--fg-subtle)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {formatAgoShort(r.requestedAt)}
                </span>
              </div>
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 10.5,
                color: riskColor, marginBottom: 6, letterSpacing: "0.02em",
              }}>{r.kind} · <span style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>{r.risk}</span></div>
              <div style={{
                fontFamily: "var(--font-body)", fontSize: 12.5,
                color: "var(--fg)", marginBottom: 4, fontWeight: 500,
              }}>{r.title}</div>
              <p style={{
                margin: 0, fontFamily: "var(--font-mono)", fontSize: 11,
                color: "var(--fg-muted)", lineHeight: 1.5,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{r.detail}</p>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button onClick={e => e.stopPropagation()} style={{
                  fontSize: 11, padding: "6px 13px", border: "none",
                  background: "var(--sumi-black)", color: "var(--washi-white)",
                  borderRadius: "2px 9px 2px 9px", letterSpacing: "0.04em",
                  fontFamily: "var(--font-body)", cursor: "pointer",
                }}>Approve</button>
                <button onClick={e => e.stopPropagation()} style={{
                  fontSize: 11, padding: "6px 13px",
                  border: "1px solid var(--border-firm)",
                  background: "transparent", color: "var(--fg-subtle)",
                  borderRadius: "2px 9px 2px 9px", fontFamily: "var(--font-body)",
                  cursor: "pointer", marginLeft: "auto",
                }}>Deny</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// =========================================================
// SHEET · APPROVAL
// =========================================================
function MoApprovalSheet({ approvalId, onClose }) {
  const { approvals, workers, commanders } = window.HV_DATA;
  const ap = approvals.find(a => a.id === approvalId) ?? approvals[0];
  if (!ap) return null;
  const commander = commanders.find(c => c.id === ap.commanderId);
  const worker = workers.find(w => w.id === ap.workerId);

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 48,
      background: "rgba(28,28,28,0.45)",
      display: "flex", alignItems: "flex-end",
      animation: "hvFadeIn 0.25s var(--ease-gentle) both",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", background: "var(--washi-white)",
        borderRadius: "22px 22px 0 0",
        padding: "10px 20px 22px",
        boxShadow: "0 -12px 36px rgba(28,28,28,0.18)",
      }}>
        <div style={{ width: 42, height: 4, background: "var(--border-firm)", borderRadius: 2, margin: "0 auto 14px" }}/>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <span style={{
              fontFamily: "var(--font-body)", fontSize: 9.5,
              letterSpacing: "0.14em", textTransform: "uppercase",
              color: ap.risk === "high" ? "var(--vermillion-seal)" : "var(--persimmon)",
              fontWeight: 500,
            }}>{ap.kind} · {ap.risk} risk · needs approval</span>
            <div style={{
              fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 24,
              letterSpacing: "-0.01em", marginTop: 3, lineHeight: 1.1,
            }}>{ap.title}</div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", cursor: "pointer",
            padding: 4, color: "var(--fg-muted)",
          }}><Icon name="close" size={20}/></button>
        </div>
        <div style={{
          padding: "13px 15px", background: "var(--aged-paper)",
          border: "1px solid var(--border-hair)", borderRadius: "3px 14px 3px 14px",
          marginBottom: 14,
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "64px 1fr",
            rowGap: 8, fontSize: 11.5, alignItems: "baseline",
          }}>
            <span style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)", fontWeight: 500 }}>from</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg)" }}>
              {worker?.name || commander?.name}
              {worker && <span style={{ color: "var(--fg-faint)", fontStyle: "italic", fontFamily: "var(--font-body)" }}> · {commander?.name}</span>}
            </span>
            <span style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)", fontWeight: 500 }}>tool</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg)" }}>{ap.kind}</span>
            <span style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)", fontWeight: 500 }}>detail</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg)", fontSize: 11, wordBreak: "break-word" }}>{ap.detail}</span>
            <span style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-faint)", fontWeight: 500 }}>requested</span>
            <span style={{ color: "var(--fg-muted)", fontStyle: "italic" }}>{formatAgoShort(ap.requestedAt)} ago</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{
            flex: 1, fontSize: 13.5, padding: "13px 14px",
            border: "none", background: "var(--sumi-black)", color: "var(--washi-white)",
            borderRadius: "3px 14px 3px 14px", letterSpacing: "0.04em",
            fontFamily: "var(--font-body)", cursor: "pointer", fontWeight: 500,
          }}>Approve</button>
          <button onClick={onClose} style={{
            fontSize: 13.5, padding: "13px 18px",
            border: "1px solid var(--border-firm)",
            background: "transparent", color: "var(--fg-muted)",
            borderRadius: "3px 14px 3px 14px", fontFamily: "var(--font-body)", cursor: "pointer",
          }}>Deny</button>
        </div>
        <div style={{
          textAlign: "center", marginTop: 12,
          fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "var(--fg-faint)",
        }}>always ask · once · always allow</div>
      </div>
    </div>
  );
}

// =========================================================
// SHEET · WORKSPACE
// =========================================================
function MoWorkspaceSheet({ onClose }) {
  const { workspace } = window.HV_DATA;
  const [tab, setTab] = useStateMo("changes");
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 48,
      background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "flex-end",
      animation: "hvFadeIn 0.25s var(--ease-gentle) both",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", height: "92%",
        background: "#18181b", color: "#e8e6e1",
        borderRadius: "22px 22px 0 0",
        boxShadow: "0 -12px 36px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ width: 42, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "10px auto 12px" }}/>
        <div style={{ padding: "0 18px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Icon name="workspace" size={14} style={{ color: "#a09d96" }}/>
            <span style={{ fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 17, color: "#e8e6e1" }}>Workspace</span>
            <span style={{ flex: 1 }}/>
            <button onClick={onClose} style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "#a09d96", padding: 4, display: "flex",
            }}><Icon name="close" size={16}/></button>
          </div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 11, color: "#a09d96",
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          }}>
            <span>{workspace.repo}</span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 7px", background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: "2px 6px 2px 6px",
            }}><Icon name="branch" size={10}/>{workspace.branch}</span>
          </div>
        </div>
        <div style={{
          display: "flex", gap: 4, padding: "8px 14px 0",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          {[["changes","Changes",workspace.changes.length],["log","Git log",workspace.log.length]].map(([k,l,n]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: "8px 12px", background: "transparent", border: "none",
              color: tab === k ? "#e8e6e1" : "#6f6c67",
              borderBottom: tab === k ? "2px solid #e8e6e1" : "2px solid transparent",
              cursor: "pointer", fontFamily: "var(--font-body)",
              fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase",
              display: "flex", alignItems: "center", gap: 7,
            }}>
              {l}
              <span style={{
                fontSize: 9.5, padding: "1px 6px",
                background: "rgba(255,255,255,0.08)", borderRadius: 6,
                color: "#a09d96",
              }}>{n}</span>
            </button>
          ))}
        </div>
        <div className="hv-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 0 12px" }}>
          {tab === "changes" && workspace.changes.map(c => (
            <div key={c.path} style={{
              padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}>
              <span style={{
                width: 20, height: 20, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 3, fontSize: 10.5,
                fontFamily: "var(--font-mono)", fontWeight: 500,
                background: c.status === "A" ? "rgba(107,123,94,0.15)" : "rgba(212,118,58,0.15)",
                color:      c.status === "A" ? "var(--moss-stone)" : "var(--persimmon)",
              }}>{c.status}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#e8e6e1",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{c.path}</div>
                <div style={{ fontSize: 10, marginTop: 2, display: "flex", gap: 8 }}>
                  <span style={{ color: "var(--moss-stone)" }}>+{c.additions}</span>
                  <span style={{ color: "var(--vermillion-seal)" }}>−{c.deletions}</span>
                </div>
              </div>
            </div>
          ))}
          {tab === "log" && workspace.log.map(c => (
            <div key={c.sha} style={{
              padding: "10px 16px", display: "flex", gap: 11, alignItems: "flex-start",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}>
              <Icon name="commit" size={12} style={{ color: "#6f6c67", marginTop: 3, flexShrink: 0 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "#e8e6e1", lineHeight: 1.45 }}>{c.message}</div>
                <div style={{
                  marginTop: 4, fontSize: 10,
                  color: "#6f6c67", display: "flex", gap: 8, flexWrap: "wrap",
                }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--persimmon)" }}>{c.sha}</span>
                  <span>· {c.author}</span>
                  <span>· {formatAgoShort(c.at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =========================================================
// SCREEN · SETTINGS
// =========================================================
function MoSettingsScreen() {
  const [section, setSection] = useStateMo("account");
  const sections = [
    { k: "account",    l: "Account",    i: "identity" },
    { k: "telemetry",  l: "Telemetry",  i: "spark"    },
    { k: "notify",     l: "Notifications", i: "queue" },
    { k: "runtime",    l: "Runtime",    i: "bolt"     },
    { k: "appearance", l: "Appearance", i: "eye"      },
    { k: "about",      l: "About",      i: "shield"   },
  ];

  return (
    <>
      <div style={{ padding: "10px 22px 10px" }}>
        <span className="whisper" style={{ fontSize: 10 }}>hervald</span>
        <h1 style={{
          fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 34,
          margin: "3px 0 0", letterSpacing: "-0.02em", lineHeight: 1,
        }}>Settings</h1>
      </div>

      <div className="hv-scroll" style={{ flex: 1, overflowY: "auto", padding: "6px 0 14px" }}>
        {/* Profile card */}
        <div style={{
          margin: "6px 18px 14px", padding: "14px 16px",
          background: "var(--washi-white)",
          border: "1px solid var(--border-hair)",
          borderRadius: "3px 14px 3px 14px",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "var(--sumi-black)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--washi-white)", fontFamily: "var(--font-primary)",
            fontStyle: "italic", fontSize: 20,
          }}>h</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 13.5, color: "var(--fg)", fontWeight: 500 }}>hana · operator</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-subtle)", marginTop: 2 }}>hana@hervald.co</div>
          </div>
          <span style={{
            fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "var(--moss-stone)", fontWeight: 500,
          }}>active</span>
        </div>

        {/* Sectioned list */}
        <div style={{ padding: "0 14px" }}>
          {sections.map(s => (
            <button key={s.k} onClick={() => setSection(s.k)} style={{
              display: "flex", alignItems: "center", gap: 12,
              width: "100%", padding: "12px 14px",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--border-hair)",
              fontFamily: "var(--font-body)", fontSize: 13.5,
              color: "var(--fg)", textAlign: "left", cursor: "pointer",
            }}>
              <Icon name={s.i} size={15} style={{ color: "var(--fg-subtle)" }}/>
              <span style={{ flex: 1 }}>{s.l}</span>
              <Icon name="chevronR" size={13} style={{ color: "var(--fg-faint)" }}/>
            </button>
          ))}
        </div>

        {/* Preview of a section (telemetry feels nice on mobile) */}
        <div style={{ padding: "18px 18px 10px" }}>
          <div style={{
            fontFamily: "var(--font-body)", fontSize: 10,
            letterSpacing: "0.18em", textTransform: "uppercase",
            color: "var(--fg-subtle)", marginBottom: 10, fontWeight: 500,
          }}>telemetry · last 24h</div>
          <div style={{
            padding: "14px 16px",
            background: "var(--washi-white)",
            border: "1px solid var(--border-hair)",
            borderRadius: "3px 14px 3px 14px",
          }}>
            {[
              ["tool calls",      "1,284"],
              ["avg latency",     "420ms"],
              ["approvals shown", "27"],
              ["sentinels fired", "14"],
              ["cron runs",       "48"],
              ["errors",          "3"],
            ].map(([k, v]) => (
              <div key={k} style={{
                display: "flex", justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: "1px solid var(--border-hair)",
                fontSize: 12,
              }}>
                <span style={{ color: "var(--fg-subtle)", fontFamily: "var(--font-body)", letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10.5 }}>{k}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg)" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          padding: "14px 26px 18px", textAlign: "center",
          fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "var(--fg-faint)",
        }}>hervald · v0.3.1 · build 2048</div>
      </div>
    </>
  );
}

// =========================================================
// BOTTOM TAB BAR
// =========================================================
function MoBottomTabs({ tab, setTab, pendingCount }) {
  const tabs = [
    { id: "sessions",    label: "Sessions",    icon: "sessions" },
    { id: "automations", label: "Automations", icon: "cron"     },
    { id: "inbox",       label: "Inbox",       icon: "queue",   badge: pendingCount },
    { id: "settings",    label: "Settings",    icon: "settings" },
  ];
  return (
    <div style={{
      padding: "10px 14px 22px",
      borderTop: "1px solid var(--border-hair)",
      display: "flex", justifyContent: "space-around",
      background: "var(--washi-white)",
      flexShrink: 0,
    }}>
      {tabs.map(x => {
        const active = tab === x.id;
        return (
          <button key={x.id} onClick={() => setTab(x.id)} style={{
            background: "transparent", border: "none", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            position: "relative", padding: "4px 8px",
            color: active ? "var(--sumi-black)" : "var(--fg-subtle)",
          }}>
            <Icon name={x.icon} size={18}/>
            <span style={{
              fontFamily: "var(--font-body)", fontSize: 10,
              letterSpacing: "0.04em",
              fontWeight: active ? 500 : 400,
            }}>{x.label}</span>
            {active && (
              <span style={{
                position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                width: 22, height: 2, background: "var(--sumi-black)",
              }}/>
            )}
            {x.badge > 0 && (
              <span style={{
                position: "absolute", top: 0, right: 2,
                width: 15, height: 15, borderRadius: "50%",
                background: "var(--vermillion-seal)", color: "var(--washi-white)",
                fontSize: 9, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{x.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// =========================================================
// PHONE · orchestrator
// =========================================================
function MobilePhoneContent({ onExternalWorkspace }) {
  const [tab, setTab]   = useStateMo(() => localStorage.getItem("hv-mo-tab")  || "sessions");
  const [view, setView] = useStateMo(() => localStorage.getItem("hv-mo-view") || "list");
  const [selectedCommander, setSelectedCommander] = useStateMo(() =>
    localStorage.getItem("hv-mo-cmd") || "jarvis");
  const [sheet, setSheet] = useStateMo(null);
  const [selectedApprovalId, setSelectedApprovalId] = useStateMo(null);

  useEffectMo(() => { localStorage.setItem("hv-mo-tab",  tab);  }, [tab]);
  useEffectMo(() => { localStorage.setItem("hv-mo-view", view); }, [view]);
  useEffectMo(() => { localStorage.setItem("hv-mo-cmd",  selectedCommander); }, [selectedCommander]);

  const { approvals } = window.HV_DATA;
  const currentCommanderApproval = approvals
    .filter(a => a.commanderId === selectedCommander)
    .sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt))
    .at(-1) || null;

  const closeSheet = () => {
    setSheet(null);
    setSelectedApprovalId(null);
  };
  const openSheet = (kind) => {
    setSheet(kind);
    if (kind !== "approval") setSelectedApprovalId(null);
  };
  const openApproval = (approvalId) => {
    setSelectedApprovalId(approvalId ?? null);
    setSheet("approval");
  };
  const setTabReset = (t) => {
    setTab(t);
    setView("list");
    closeSheet();
  };

  const inChat = tab === "sessions" && view === "chat";

  return (
    <>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {tab === "sessions" && view === "list" && (
          <MoSessionsScreen
            goChat={() => setView("chat")}
            onSelect={setSelectedCommander}
          />
        )}
        {tab === "sessions" && view === "chat" && (
          <MoChatScreen
            commanderId={selectedCommander}
            setCommanderId={setSelectedCommander}
            goBack={() => setView("list")}
            onOpenApproval={(approvalId) => openApproval(approvalId ?? currentCommanderApproval?.id ?? null)}
            onOpenWorkspace={() => openSheet("workspace")}
            onOpenTeam={() => openSheet("team")}
            onOpenSwitcher={() => openSheet("switcher")}
            onKill={() => { setView("list"); closeSheet(); }}
          />
        )}
        {tab === "automations" && <MoAutomationsScreen/>}
        {tab === "inbox"       && <MoInboxScreen onOpenApproval={openApproval}/>}
        {tab === "settings"    && <MoSettingsScreen/>}

        {sheet === "switcher" && (
          <MoCommanderSwitcherSheet
            currentId={selectedCommander}
            onSelect={setSelectedCommander}
            onClose={closeSheet}
            dark={inChat}
          />
        )}
        {sheet === "team" && (
          <MoTeamSheet
            commanderId={selectedCommander}
            onClose={closeSheet}
            onOpenApproval={openApproval}
          />
        )}
        {sheet === "approval"  && <MoApprovalSheet approvalId={selectedApprovalId} onClose={closeSheet}/>}
        {sheet === "workspace" && <MoWorkspaceSheet onClose={closeSheet}/>}
      </div>
      {!inChat && <MoBottomTabs tab={tab} setTab={setTabReset} pendingCount={approvals.length}/>}
    </>
  );
}

// =========================================================
// MobileSurface — wraps MobilePhoneContent. Wide screen → stage.
// =========================================================
function MobileSurface({ onOpenWorkspace }) {
  const [isNarrow, setIsNarrow] = useStateMo(() => window.innerWidth <= 500);
  useEffectMo(() => {
    const onResize = () => setIsNarrow(window.innerWidth <= 500);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffectMo(() => {
    if (document.getElementById("mo-keyframes")) return;
    const s = document.createElement("style");
    s.id = "mo-keyframes";
    s.textContent = `
      @keyframes moBlink {
        0%, 80%, 100% { opacity: 0.25; }
        40%           { opacity: 1; }
      }
    `;
    document.head.appendChild(s);
  }, []);

  if (isNarrow) {
    return (
      <div style={{
        flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
        background: "var(--washi-white)", overflow: "hidden",
      }}>
        <MobilePhoneContent/>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, minWidth: 0, overflow: "auto", background: "var(--bg)",
    }} className="hv-scroll">
      <div style={{
        minHeight: "100%",
        background: "linear-gradient(170deg, #F5F0E6 0%, #E8E1D3 100%)",
        padding: "40px 24px 60px",
      }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto",
          display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 32,
          alignItems: "center",
        }}>
          <div>
            <div style={{
              fontFamily: "var(--font-body)", fontSize: 10.5,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: "var(--fg-faint)", marginBottom: 10,
            }}>iphone 15 pro · 390 × 820</div>
            <h1 style={{
              fontFamily: "var(--font-primary)", fontWeight: 300,
              fontSize: 48, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.05,
            }}>
              Mobile <em style={{ fontStyle: "italic", color: "var(--vermillion-seal)" }}>prototype</em>
            </h1>
            <p style={{
              fontFamily: "var(--font-body)", fontSize: 13.5,
              color: "var(--fg-muted)", lineHeight: 1.7, marginTop: 14, maxWidth: 360,
            }}>
              Four tabs — Sessions, Automations, Inbox, Settings. Tap a session to open
              the chat, which goes immersive (dark, full-height, no bottom nav). The top-right
              menu holds Workers, Workspace, Kill Session, and Back to Sessions.
            </p>
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border-hair)" }}>
              <div style={{
                fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase",
                color: "var(--fg-subtle)", marginBottom: 12, fontWeight: 500,
              }}>try</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  ["Tap a session",          "open immersive dark chat"],
                  ["Kebab menu (top right)", "Workers · Workspace · Kill"],
                  ["◂ / ▸ or tap name",      "switch commander inline"],
                  ["Automations",            "Cron · Sentinels · Quests, filterable by commander"],
                  ["Inbox → card",           "approval sheet with payload"],
                  ["Settings",               "account, telemetry, runtime…"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 10, fontSize: 12, lineHeight: 1.55 }}>
                    <span style={{
                      fontFamily: "var(--font-mono)", color: "var(--fg)",
                      width: 170, flexShrink: 0,
                    }}>{k}</span>
                    <span style={{ color: "var(--fg-subtle)", fontStyle: "italic" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center" }}>
            <MoPhoneFrame width={390} height={820}>
              <MobilePhoneContent/>
            </MoPhoneFrame>
          </div>

          <div>
            <div style={{
              fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase",
              color: "var(--fg-subtle)", marginBottom: 14, fontWeight: 500,
            }}>design notes</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {[
                { h: "Chat is immersive",
                  b: "The moment you open a session, we go dark and reclaim the bottom nav. Transcript matches the desktop command-room — gutter avatar, left-accent card, mono tool-call rows, thinking label." },
                { h: "Menu lives in the kebab",
                  b: "Workers, Workspace, Kill Session, Back to Sessions — a top-right drop-down, same pattern as desktop. No team strip stealing real estate from the chat." },
                { h: "Automations filterable",
                  b: "Cron · Sentinels · Quests share a segmented control; a commander chip row filters all three. 'What has jarvis scheduled?' takes two taps." },
                { h: "Settings is a first-class tab",
                  b: "Account, Telemetry, Notifications, Runtime, Appearance, About. Telemetry rendered inline as a list of counters — it's a glance, not a dashboard." },
              ].map(c => (
                <div key={c.h}>
                  <div style={{
                    fontFamily: "var(--font-primary)", fontWeight: 400,
                    fontSize: 17, color: "var(--fg)", marginBottom: 5,
                    letterSpacing: "-0.01em",
                  }}>{c.h}</div>
                  <div style={{
                    fontFamily: "var(--font-body)", fontSize: 12.5,
                    color: "var(--fg-muted)", lineHeight: 1.7, fontStyle: "italic",
                  }}>{c.b}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MobileSurface });
