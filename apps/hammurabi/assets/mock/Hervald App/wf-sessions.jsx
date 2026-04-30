// SESSIONS SWITCHER — how multiple agent sessions surface during an active chat
// Variants A..E (conventional → novel) + polished North Star.

const SESSIONS = [
  { name: "athena",  role: "cmd", status: "running", task: "drafting Q3 strategy", pending: 0, ago: "9h" },
  { name: "jarvis",  role: "cmd", status: "waiting", task: "awaiting baseline review", pending: 2, ago: "7h", active: true },
  { name: "jake",    role: "cmd", status: "running", task: "indexing repo changes", pending: 0, ago: "6h" },
  { name: "pm-920",  role: "sub", status: "idle",    task: "stale · no activity",   pending: 0, ago: "2d" },
  { name: "swe-mbp", role: "sub", status: "failed",  task: "tool error in bash run", pending: 1, ago: "2d" },
];

// ============================================================
// A · Left rail (conventional)
// ============================================================
function SessionsA() {
  return (
    <div>
      <VariantLabel letter="A" name="Left rail" tagline="Persistent column of session tiles next to the chat." />
      <SketchFrame style={{ minHeight: 340 }}>
        <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 0, minHeight: 320 }}>
          {/* Rail */}
          <div style={{ borderRight: "1.5px dashed var(--border-soft)", paddingRight: 10, filter: "url(#rough)" }}>
            <Whisper style={{ fontSize: 9 }}>sessions</Whisper>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {SESSIONS.slice(0,4).map(s => (
                <div key={s.name} style={{
                  padding: "8px 8px", borderRadius: "2px 8px 2px 8px",
                  background: s.active ? "rgba(28,28,28,0.06)" : "transparent",
                  borderLeft: s.active ? "2px solid var(--sumi-black)" : "2px solid transparent",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <StatusDot kind={s.status} size={6} />
                    <Scribble size={16}>{s.name}</Scribble>
                  </div>
                  <Whisper style={{ fontSize: 8, display: "block", marginTop: 2 }}>{s.ago} · {s.pending > 0 ? `${s.pending} pend` : "ok"}</Whisper>
                </div>
              ))}
            </div>
          </div>
          {/* Chat column */}
          <div style={{ padding: "10px 0 10px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Scribble size={20}>jarvis</Scribble>
              <Whisper>connected · $48.33</Whisper>
            </div>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {[40, 85, 60].map((w,i) => (
                <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(28,28,28,0.06)", borderRadius: 2 }}/>
              ))}
            </div>
            <div style={{ marginTop: 24, height: 40, border: "1.2px solid var(--border-soft)", borderRadius: "3px 10px 3px 10px", padding: "10px 12px" }}>
              <Scribble size={15} color="var(--diluted-ink)" italic>Send a message…</Scribble>
            </div>
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>
        Always visible. Familiar (Cursor, Slack). Eats ~14% horizontal space.
      </div>
    </div>
  );
}

// ============================================================
// B · Top tabs
// ============================================================
function SessionsB() {
  return (
    <div>
      <VariantLabel letter="B" name="Browser tabs" tagline="Horizontal tabs like a browser; close / reorder inline." />
      <SketchFrame style={{ minHeight: 340 }}>
        {/* tab strip */}
        <div style={{ display: "flex", gap: 2, borderBottom: "1.5px solid var(--border-soft)", marginBottom: 18 }}>
          {SESSIONS.slice(0,4).map((s, i) => (
            <div key={s.name} style={{
              padding: "7px 14px",
              background: s.active ? "rgba(28,28,28,0.05)" : "transparent",
              borderRadius: "3px 11px 0 0",
              borderTop: s.active ? "1.5px solid var(--sumi-black)" : "1.5px solid transparent",
              borderLeft: s.active ? "1px solid var(--border-soft)" : "none",
              borderRight: s.active ? "1px solid var(--border-soft)" : "none",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <StatusDot kind={s.status} size={6} />
              <Scribble size={15}>{s.name}</Scribble>
              {s.pending > 0 && <span style={{
                fontFamily: "var(--font-body)", fontSize: 9, color: "var(--vermillion-seal)",
                border: "1px solid var(--vermillion-seal)", borderRadius: 8, padding: "0 5px",
              }}>{s.pending}</span>}
            </div>
          ))}
          <div style={{ padding: "7px 12px", color: "var(--fg-subtle)" }}>
            <Scribble size={16} color="var(--fg-subtle)">+</Scribble>
          </div>
        </div>
        <div style={{ padding: "0 6px" }}>
          <Scribble size={20}>jarvis</Scribble>
          <Whisper style={{ marginLeft: 10 }}>connected · $48</Whisper>
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
            {[50, 90, 70, 45].map((w,i) => (
              <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(28,28,28,0.06)", borderRadius: 2 }}/>
            ))}
          </div>
          <div style={{ marginTop: 22, height: 40, border: "1.2px solid var(--border-soft)", borderRadius: "3px 10px 3px 10px", padding: "10px 12px" }}>
            <Scribble size={15} color="var(--diluted-ink)" italic>Send a message…</Scribble>
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>
        Dense. Scales to ~10 tabs. Feels like a dev tool.
      </div>
    </div>
  );
}

// ============================================================
// C · Right mini-dock (floating)
// ============================================================
function SessionsC() {
  return (
    <div>
      <VariantLabel letter="C" name="Floating dock" tagline="Small card in the corner; pops open to a full list on hover." />
      <SketchFrame style={{ minHeight: 340, position: "relative" }}>
        {/* Chat underneath */}
        <Scribble size={20}>jarvis</Scribble>
        <Whisper style={{ marginLeft: 10 }}>connected · $48</Whisper>
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          {[50, 90, 70, 45, 65].map((w,i) => (
            <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(28,28,28,0.06)", borderRadius: 2 }}/>
          ))}
        </div>
        {/* Floating dock */}
        <div style={{
          position: "absolute", right: 16, top: 60,
          border: "1.5px solid var(--sumi-black)", background: "var(--washi-white)",
          borderRadius: "3px 14px 3px 14px", padding: "12px 14px",
          boxShadow: "0 8px 24px rgba(28,28,28,0.08)",
          filter: "url(#rough)",
          width: 160,
        }}>
          <Whisper style={{ fontSize: 9 }}>4 running</Whisper>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
            {SESSIONS.slice(0,4).map(s => (
              <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <StatusDot kind={s.status} size={6} />
                  <Scribble size={14} style={{ fontWeight: s.active ? 700 : 400 }}>{s.name}</Scribble>
                </div>
                {s.pending > 0 && <Scribble size={12} color="var(--vermillion-seal)">{s.pending}</Scribble>}
              </div>
            ))}
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>
        Zero layout cost. Draggable. Good for focus mode.
      </div>
    </div>
  );
}

// ============================================================
// D · Ink-well vertical dock (novel metaphor)
// ============================================================
function SessionsD() {
  return (
    <div>
      <VariantLabel letter="D" name="Ink-well dock" tagline="Each session is an ink drop in the margin — scale by activity, color by status." />
      <SketchFrame style={{ minHeight: 340, position: "relative", overflow: "hidden" }}>
        {/* left inkwell */}
        <div style={{ position: "absolute", left: 14, top: 20, bottom: 20, width: 52, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          {SESSIONS.map((s, i) => {
            const activity = s.status === "running" ? 1 : s.status === "waiting" ? 0.85 : s.status === "failed" ? 0.7 : 0.45;
            const r = 14 + activity * 14;
            const bg = s.status === "failed" ? "var(--vermillion-seal)" :
                       s.status === "waiting" ? "var(--persimmon)" :
                       s.status === "running" ? "var(--sumi-black)" :
                       s.status === "idle" ? "var(--stone-gray)" : "var(--brushed-gray)";
            return (
              <div key={s.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div style={{
                  width: r, height: r, borderRadius: "50%",
                  background: bg, opacity: s.status === "idle" ? 0.4 : 1,
                  boxShadow: s.active ? "0 0 0 3px var(--washi-white), 0 0 0 4.5px var(--sumi-black)" : "none",
                  filter: "url(#rough)",
                }}/>
                <Scribble size={11} style={{ lineHeight: 1 }}>{s.name}</Scribble>
              </div>
            );
          })}
        </div>
        {/* chat */}
        <div style={{ marginLeft: 72 }}>
          <Scribble size={20}>jarvis</Scribble>
          <Whisper style={{ marginLeft: 10 }}>connected · $48</Whisper>
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
            {[50, 90, 70, 45, 65, 55].map((w,i) => (
              <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(28,28,28,0.06)", borderRadius: 2 }}/>
            ))}
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>
        Dot size = activity. Ink density = importance. Pure Hervald.
      </div>
    </div>
  );
}

// ============================================================
// E · Scroll / breath strip — bottom (novel)
// ============================================================
function SessionsE() {
  return (
    <div>
      <VariantLabel letter="E" name="Scroll strip" tagline="A horizontal scroll along the bottom — a timeline of your agent workforce." />
      <SketchFrame style={{ minHeight: 340, position: "relative" }}>
        <Scribble size={20}>jarvis</Scribble>
        <Whisper style={{ marginLeft: 10 }}>connected · $48</Whisper>
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          {[50, 90, 70, 45].map((w,i) => (
            <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(28,28,28,0.06)", borderRadius: 2 }}/>
          ))}
        </div>
        {/* bottom scroll */}
        <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, borderTop: "1.5px dashed var(--border-soft)", paddingTop: 10, filter: "url(#rough)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Whisper style={{ fontSize: 9 }}>workforce</Whisper>
            <div style={{ flex: 1, display: "flex", gap: 10, overflow: "hidden" }}>
              {SESSIONS.map(s => (
                <div key={s.name} style={{
                  flex: "0 0 auto", padding: "5px 10px",
                  border: `1.2px solid ${s.active ? "var(--sumi-black)" : "var(--border-soft)"}`,
                  borderRadius: "2px 9px 2px 9px",
                  display: "flex", alignItems: "center", gap: 6,
                  background: s.active ? "rgba(28,28,28,0.05)" : "transparent",
                }}>
                  <StatusDot kind={s.status} size={6} />
                  <Scribble size={13}>{s.name}</Scribble>
                  {s.pending > 0 && <Scribble size={11} color="var(--vermillion-seal)">·{s.pending}</Scribble>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>
        Non-intrusive. Time-ordered. Works identically on mobile.
      </div>
    </div>
  );
}

// ============================================================
// NORTH STAR — the polished pick: left rail with hierarchy
// ============================================================
function SessionsNorthStar() {
  return (
    <NorthStarFrame label="north star · sessions">
      <VariantLabel letter="★" name="Commanders + their teams" tagline="Rail grouped by commander; each commander expands to show their team. One live session is always foregrounded." />

      <div style={{
        display: "grid", gridTemplateColumns: "220px 1fr",
        gap: 0, minHeight: 420,
        background: "var(--washi-white)",
        border: "1px solid var(--border-hair)",
        borderRadius: "4px 16px 4px 16px", overflow: "hidden",
      }}>
        {/* LEFT: rail */}
        <div style={{ background: "var(--aged-paper)", padding: "20px 14px", borderRight: "1px solid var(--border-hair)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <span className="whisper" style={{ fontSize: 10 }}>sessions · 3</span>
            <span style={{ fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 18, color: "var(--fg-muted)" }}>+</span>
          </div>

          {/* Commander: athena */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: "2px 10px 2px 10px" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--moss-stone)", boxShadow: "0 0 0 3px rgba(107,123,94,0.15)" }}/>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg)" }}>athena</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", marginLeft: "auto" }}>3</span>
            </div>
            <div style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
              {["pm-920", "swe-01"].map(n => (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--stone-gray)" }}/>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-subtle)" }}>{n}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Commander: jarvis — active */}
          <div style={{ marginBottom: 12, background: "var(--washi-white)", borderRadius: "2px 12px 2px 12px", padding: "2px 0", boxShadow: "0 2px 6px rgba(28,28,28,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px", borderLeft: "2px solid var(--sumi-black)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--persimmon)", boxShadow: "0 0 0 3px rgba(212,118,58,0.18)" }}/>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg)" }}>jarvis</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--vermillion-seal)", marginLeft: "auto", letterSpacing: "0.08em", textTransform: "uppercase" }}>2 pend</span>
            </div>
            <div style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2, marginBottom: 6 }}>
              {[{n:"researcher", s:"running"}, {n:"writer", s:"waiting"}, {n:"critic", s:"idle"}].map(o => (
                <div key={o.n} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: o.s==="running"?"var(--moss-stone)":o.s==="waiting"?"var(--persimmon)":"var(--stone-gray)" }}/>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: o.s==="idle"?"var(--fg-subtle)":"var(--fg-muted)" }}>{o.n}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Commander: jake */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--moss-stone)" }}/>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg)" }}>jake</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", marginLeft: "auto" }}>—</span>
            </div>
          </div>

          <div style={{ marginTop: 28, paddingTop: 16, borderTop: "1px solid var(--border-hair)" }}>
            <span className="whisper" style={{ fontSize: 10 }}>stale · 2</span>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
              {["srsweworker", "mbp01"].map(n => (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px", opacity: 0.6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ink-mist)" }}/>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-subtle)" }}>{n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: chat preview */}
        <div style={{ padding: "18px 28px 0", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: 14, borderBottom: "1px solid var(--border-hair)" }}>
            <div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--fg)" }}>jarvis</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)", marginLeft: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                connected · $48.33 · 6h 02s
              </span>
            </div>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", letterSpacing: "0.12em", textTransform: "uppercase" }}>team · 3</span>
          </div>

          {/* fake transcript */}
          <div style={{ flex: 1, padding: "18px 0", display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>2 tool calls · done</div>
              <div style={{ background: "var(--aged-paper)", padding: "12px 16px", borderRadius: "3px 14px 3px 14px", maxWidth: 440 }}>
                <p style={{ margin: 0, fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.6 }}>Report republished at the same URL. The baseline section landed cleanly.</p>
              </div>
            </div>
            <div style={{ alignSelf: "flex-end", maxWidth: 360 }}>
              <div style={{ background: "var(--sumi-black)", color: "var(--washi-white)", padding: "12px 16px", borderRadius: "14px 3px 14px 3px" }}>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>Check quest board. Post progress, pick up the next.</p>
              </div>
            </div>
          </div>

          <div style={{ border: "1px solid var(--border-hair)", borderRadius: "3px 14px 3px 14px", padding: "14px 18px", marginBottom: 14, background: "var(--washi-white)" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--fg-subtle)", fontStyle: "italic" }}>Send a message…</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.7, maxWidth: 720 }}>
        The rail is grouped by <b style={{fontWeight:500}}>commander</b> — the person you actually chat with — and exposes each commander's team inline, so the org chart lives <i>in</i> the switcher, not beside it. Pending approvals bubble up from subs to the commander so you never miss a blocked session.
      </div>
    </NorthStarFrame>
  );
}

// ============================================================
// SURFACE WRAPPER
// ============================================================
function SessionsSurface() {
  return (
    <div>
      <SurfaceHeading
        count="01"
        title="Session switcher"
        subtitle='"While chatting with one agent, I should see I have multiple agents working." Five takes, one polished pick.'
      />
      <VariantGrid cols={2} gap={56}>
        <SessionsA />
        <SessionsB />
        <SessionsC />
        <SessionsD />
        <SessionsE />
      </VariantGrid>
      <div style={{ height: 80 }}/>
      <SessionsNorthStar />
    </div>
  );
}

Object.assign(window, { SessionsSurface });
