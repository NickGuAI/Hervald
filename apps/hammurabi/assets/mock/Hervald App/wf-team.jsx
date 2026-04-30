// TEAM / ORG CHART — the commander's sub-agents
// Variants A..E + polished North Star.

const TEAM = {
  commander: { name: "jarvis", role: "commander", status: "waiting", task: "Q3 baseline review" },
  children: [
    { name: "researcher", status: "running", task: "pulling comp data · bloomberg", pending: 0, parent: "jarvis" },
    { name: "writer",     status: "waiting", task: "drafting summary · needs approval", pending: 2, parent: "jarvis" },
    { name: "critic",     status: "idle",    task: "awaiting draft",          pending: 0, parent: "jarvis" },
    { name: "fetcher",    status: "running", task: "tool: bash · indexing",    pending: 0, parent: "researcher" },
    { name: "editor",     status: "failed",  task: "last tool call: error",    pending: 1, parent: "writer" },
  ],
};

// ============================================================
// A · Classic org tree
// ============================================================
function TeamA() {
  return (
    <div>
      <VariantLabel letter="A" name="Org tree" tagline="Boxes + lines. The literal reading." />
      <SketchFrame style={{ minHeight: 360, position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <div style={{ border: "1.5px solid var(--sumi-black)", borderRadius: "3px 12px 3px 12px", padding: "8px 16px", filter: "url(#rough)", background: "var(--washi-white)", textAlign: "center" }}>
            <Scribble size={17}>jarvis</Scribble>
            <Whisper style={{ fontSize: 8, display: "block" }}>commander</Whisper>
          </div>
        </div>
        {/* connectors (simple) */}
        <div style={{ display: "flex", justifyContent: "center", gap: 28, marginBottom: 14 }}>
          {["researcher","writer","critic"].map(n => {
            const c = TEAM.children.find(x=>x.name===n);
            return (
              <div key={n} style={{ border: "1.2px solid var(--sumi-black)", borderRadius: "2px 10px 2px 10px", padding: "6px 12px", filter: "url(#rough)", background: "var(--washi-white)", minWidth: 84, textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <StatusDot kind={c.status} size={6}/>
                  <Scribble size={14}>{n}</Scribble>
                </div>
                {c.pending > 0 && <Whisper style={{ fontSize: 8, color: "var(--vermillion-seal)" }}>{c.pending} pend</Whisper>}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 140 }}>
          <div style={{ border: "1.2px dashed var(--border-firm)", borderRadius: "2px 10px 2px 10px", padding: "5px 10px", filter: "url(#rough)" }}>
            <Scribble size={12}>fetcher</Scribble>
          </div>
          <div style={{ border: "1.2px solid var(--vermillion-seal)", borderRadius: "2px 10px 2px 10px", padding: "5px 10px", filter: "url(#rough)" }}>
            <Scribble size={12} color="var(--vermillion-seal)">editor</Scribble>
          </div>
        </div>
        <svg style={{ position: "absolute", inset: 0, pointerEvents: "none" }} width="100%" height="100%">
          <path d="M 50% 60 Q 30% 90 25% 130" stroke="var(--sumi-black)" strokeWidth="1.2" fill="none" filter="url(#rough-hard)" />
          <path d="M 50% 60 Q 50% 95 50% 130" stroke="var(--sumi-black)" strokeWidth="1.2" fill="none" filter="url(#rough-hard)" />
          <path d="M 50% 60 Q 70% 90 75% 130" stroke="var(--sumi-black)" strokeWidth="1.2" fill="none" filter="url(#rough-hard)" />
        </svg>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Instantly readable. Doesn't scale past 8 nodes.</div>
    </div>
  );
}

// ============================================================
// B · Indented tree (file-tree style)
// ============================================================
function TeamB() {
  const indent = (n) => n === "jarvis" ? 0 : ["researcher","writer","critic"].includes(n) ? 1 : 2;
  const rows = [
    { n: "jarvis", s: "waiting", task: "commander · Q3 baseline", pending: 2, isCmd: true },
    { n: "researcher", s: "running", task: "pulling comp data" },
    { n: "fetcher", s: "running", task: "bash · indexing", parent: "researcher" },
    { n: "writer", s: "waiting", task: "drafting summary", pending: 2 },
    { n: "editor", s: "failed", task: "tool error", pending: 1, parent: "writer" },
    { n: "critic", s: "idle", task: "awaiting draft" },
  ];
  return (
    <div>
      <VariantLabel letter="B" name="Indented list" tagline="File-tree metaphor. Dense; easy to scan pending counts." />
      <SketchFrame style={{ minHeight: 360 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map((r,i) => (
            <div key={r.n} style={{
              display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center",
              paddingLeft: indent(r.n) * 22,
              borderLeft: indent(r.n) > 0 ? "1px dashed var(--border-soft)" : "none",
              padding: "5px 6px 5px " + (indent(r.n) * 22 + 6) + "px",
              background: r.isCmd ? "rgba(28,28,28,0.04)" : "transparent",
              borderRadius: "2px 8px 2px 8px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <StatusDot kind={r.s} size={6} />
                <Scribble size={r.isCmd ? 16 : 14}>{r.n}</Scribble>
                <Scribble size={12} color="var(--diluted-ink)" italic style={{ marginLeft: 6 }}>— {r.task}</Scribble>
              </div>
              {r.pending > 0 && <Scribble size={12} color="var(--vermillion-seal)">{r.pending} pend</Scribble>}
            </div>
          ))}
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Scales well. Lowest visual noise. Lives nicely in a side panel.</div>
    </div>
  );
}

// ============================================================
// C · Constellation / radial (novel)
// ============================================================
function TeamC() {
  const nodes = [
    { n: "researcher", x: 0.22, y: 0.30, s: "running" },
    { n: "writer",     x: 0.78, y: 0.28, s: "waiting" },
    { n: "critic",     x: 0.84, y: 0.72, s: "idle" },
    { n: "fetcher",    x: 0.10, y: 0.70, s: "running", parent: "researcher" },
    { n: "editor",     x: 0.55, y: 0.82, s: "failed",  parent: "writer" },
  ];
  return (
    <div>
      <VariantLabel letter="C" name="Constellation" tagline="The commander is a sun; subs orbit. Lines = delegation." />
      <SketchFrame style={{ minHeight: 360, position: "relative" }}>
        <div style={{ position: "relative", width: "100%", height: 320 }}>
          <svg viewBox="0 0 400 320" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            {/* lines from commander */}
            {nodes.map((n,i) => {
              const isNested = !!n.parent;
              const parent = isNested ? nodes.find(x=>x.n===n.parent) : null;
              const fx = isNested ? parent.x * 400 : 200;
              const fy = isNested ? parent.y * 320 : 160;
              return (
                <path key={n.n}
                  d={`M ${fx} ${fy} Q ${(fx + n.x*400)/2 + (i%2?10:-10)} ${(fy + n.y*320)/2} ${n.x*400} ${n.y*320}`}
                  stroke={n.s === "failed" ? "var(--vermillion-seal)" : "var(--sumi-black)"}
                  strokeWidth="1.2"
                  strokeDasharray={isNested ? "3 4" : "none"}
                  fill="none" filter="url(#rough-hard)"
                />
              );
            })}
          </svg>
          {/* commander */}
          <div style={{
            position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
            width: 64, height: 64, borderRadius: "50%",
            border: "1.8px solid var(--sumi-black)", background: "var(--washi-white)",
            display: "flex", alignItems: "center", justifyContent: "center",
            filter: "url(#rough)",
          }}>
            <Scribble size={16}>jarvis</Scribble>
          </div>
          {nodes.map((n) => (
            <div key={n.n} style={{
              position: "absolute", left: `${n.x*100}%`, top: `${n.y*100}%`, transform: "translate(-50%,-50%)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                border: `1.5px solid ${n.s==="failed"?"var(--vermillion-seal)":"var(--sumi-black)"}`,
                background: n.s === "waiting" ? "rgba(212,118,58,0.12)" : "var(--washi-white)",
                display: "flex", alignItems: "center", justifyContent: "center",
                filter: "url(#rough)",
              }}>
                <StatusDot kind={n.s} size={7}/>
              </div>
              <Scribble size={12}>{n.n}</Scribble>
            </div>
          ))}
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Novel, brandy. Harder to compare details.</div>
    </div>
  );
}

// ============================================================
// D · Swimlanes (activity-first)
// ============================================================
function TeamD() {
  const lanes = [
    { n: "researcher", activity: [1,1,1,0,1,1,1,1,1], s: "running" },
    { n: "writer",     activity: [1,1,0,1,1,0,0,"W","W"], s: "waiting" },
    { n: "critic",     activity: [0,0,0,0,0,0,0,0,0], s: "idle" },
    { n: "fetcher",    activity: [1,1,1,1,0,1,1,1,1], s: "running", indent: 1 },
    { n: "editor",     activity: [1,1,0,"F",0,0,0,0,0], s: "failed", indent: 1 },
  ];
  return (
    <div>
      <VariantLabel letter="D" name="Swimlanes" tagline="One row per sub — activity timeline shows who's actually doing work." />
      <SketchFrame style={{ minHeight: 360 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lanes.map(l => (
            <div key={l.n} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 14, alignItems: "center" }}>
              <div style={{ paddingLeft: (l.indent||0) * 16, display: "flex", alignItems: "center", gap: 6 }}>
                <StatusDot kind={l.s} size={6} />
                <Scribble size={14}>{l.n}</Scribble>
              </div>
              <div style={{ display: "flex", gap: 3, height: 18 }}>
                {l.activity.map((a,i) => (
                  <div key={i} style={{
                    flex: 1, height: "100%",
                    background: a === "F" ? "var(--vermillion-seal)" :
                                a === "W" ? "var(--persimmon)" :
                                a === 1   ? "var(--sumi-black)" : "rgba(28,28,28,0.06)",
                    borderRadius: 1,
                    opacity: a === 0 ? 0.5 : 1,
                  }}/>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--border-soft)" }}>
          <Whisper>9m ago</Whisper>
          <Whisper>now</Whisper>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Shows "who's idle" at a glance. Hides parent/child structure.</div>
    </div>
  );
}

// ============================================================
// E · Ikebana stem (novel)
// ============================================================
function TeamE() {
  return (
    <div>
      <VariantLabel letter="E" name="Ikebana stem" tagline="Vertical stem; sub-agents branch like leaves. Brand-native." />
      <SketchFrame style={{ minHeight: 360, position: "relative" }}>
        <svg viewBox="0 0 400 340" style={{ width: "100%", height: 320 }}>
          {/* stem */}
          <path d="M 200 20 Q 196 140 202 260 Q 204 300 200 320" stroke="var(--sumi-black)" strokeWidth="2" fill="none" filter="url(#rough-hard)" strokeLinecap="round"/>
          {/* commander at top */}
          <circle cx="200" cy="20" r="14" fill="var(--washi-white)" stroke="var(--sumi-black)" strokeWidth="1.8" filter="url(#rough)"/>
          {/* branches */}
          <path d="M 200 90 Q 140 100 90 110" stroke="var(--sumi-black)" strokeWidth="1.4" fill="none" filter="url(#rough-hard)" strokeLinecap="round"/>
          <path d="M 200 160 Q 270 165 310 170" stroke="var(--sumi-black)" strokeWidth="1.4" fill="none" filter="url(#rough-hard)" strokeLinecap="round"/>
          <path d="M 200 230 Q 150 240 105 255" stroke="var(--sumi-black)" strokeWidth="1.4" fill="none" filter="url(#rough-hard)" strokeLinecap="round"/>
          {/* sub-branches */}
          <path d="M 90 110 Q 60 120 40 160" stroke="var(--diluted-ink)" strokeWidth="1.1" fill="none" strokeDasharray="3 3" filter="url(#rough-hard)"/>
          <path d="M 310 170 Q 340 180 360 210" stroke="var(--vermillion-seal)" strokeWidth="1.1" fill="none" strokeDasharray="3 3" filter="url(#rough-hard)"/>
        </svg>
        {/* labels placed absolutely */}
        <div style={{ position: "absolute", left: "50%", top: 8, transform: "translateX(-50%)", textAlign: "center" }}>
          <Scribble size={16}>jarvis</Scribble>
        </div>
        <div style={{ position: "absolute", left: 50, top: 95, textAlign: "right" }}>
          <Scribble size={13}>researcher</Scribble><br/>
          <Whisper style={{ fontSize: 8 }}>running</Whisper>
        </div>
        <div style={{ position: "absolute", right: 40, top: 155 }}>
          <Scribble size={13}>writer</Scribble><br/>
          <Whisper style={{ fontSize: 8, color: "var(--persimmon)" }}>2 pend</Whisper>
        </div>
        <div style={{ position: "absolute", left: 60, top: 240, textAlign: "right" }}>
          <Scribble size={13}>critic</Scribble><br/>
          <Whisper style={{ fontSize: 8 }}>idle</Whisper>
        </div>
        <div style={{ position: "absolute", left: 0, top: 150 }}>
          <Scribble size={11} color="var(--diluted-ink)">fetcher</Scribble>
        </div>
        <div style={{ position: "absolute", right: 0, top: 205 }}>
          <Scribble size={11} color="var(--vermillion-seal)">editor!</Scribble>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Poetic. Best for small teams (≤ 6).</div>
    </div>
  );
}

// ============================================================
// NORTH STAR — right panel, indented tree + task preview
// ============================================================
function TeamNorthStar() {
  const rows = [
    { n: "jarvis", s: "waiting", role: "commander", task: "Q3 baseline review", pending: 3, depth: 0, open: true },
    { n: "researcher", s: "running", role: "sub", task: "pulling comp data · bloomberg", depth: 1, tool: "web_fetch" },
    { n: "fetcher", s: "running", role: "sub", task: "indexing · 312/500 files", depth: 2, tool: "bash" },
    { n: "writer", s: "waiting", role: "sub", task: "drafting summary · review?", depth: 1, pending: 2, open: true },
    { n: "editor", s: "failed", role: "sub", task: "tool: apply_patch · exit 1", depth: 2, pending: 1 },
    { n: "critic", s: "idle", role: "sub", task: "awaiting draft", depth: 1 },
  ];
  return (
    <NorthStarFrame label="north star · team">
      <VariantLabel letter="★" name="The team lives beside the chat" tagline="A right-docked panel: indented team on top, the selected sub-agent's live task below. You can converse with any sub directly, or delegate from the commander." />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 0, minHeight: 480, background: "var(--washi-white)", border: "1px solid var(--border-hair)", borderRadius: "4px 16px 4px 16px", overflow: "hidden" }}>
        {/* Chat side (compressed) */}
        <div style={{ padding: "20px 28px", borderRight: "1px solid var(--border-hair)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, paddingBottom: 14, borderBottom: "1px solid var(--border-hair)" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}>jarvis</span>
            <span className="whisper" style={{ fontSize: 10 }}>commander · waiting on writer</span>
          </div>
          <div style={{ padding: "20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "var(--aged-paper)", padding: "12px 16px", borderRadius: "3px 14px 3px 14px", maxWidth: 420 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.65 }}>Delegating to <b style={{fontWeight:500}}>researcher</b> for comp data and <b style={{fontWeight:500}}>writer</b> for draft. Critic on hold until draft arrives.</p>
            </div>
            <div style={{ alignSelf: "flex-end", maxWidth: 340 }}>
              <div style={{ background: "var(--sumi-black)", color: "var(--washi-white)", padding: "12px 16px", borderRadius: "14px 3px 14px 3px", fontSize: 13, lineHeight: 1.65 }}>
                Also tell writer to keep it under 400 words.
              </div>
            </div>
            <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)", textAlign: "center", padding: "6px 0" }}>awaiting writer</div>
          </div>
        </div>

        {/* Team panel */}
        <div style={{ background: "var(--aged-paper)", padding: "20px 20px 16px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <span className="whisper" style={{ fontSize: 10 }}>team · 6</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--vermillion-seal)", letterSpacing: "0.08em", textTransform: "uppercase" }}>3 pend</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
            {rows.map(r => (
              <div key={r.n} style={{
                display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, alignItems: "center",
                padding: "7px 8px", paddingLeft: 8 + r.depth * 16,
                borderRadius: "2px 10px 2px 10px",
                background: r.n === "writer" ? "var(--washi-white)" : "transparent",
                borderLeft: r.n === "writer" ? "2px solid var(--sumi-black)" : "2px solid transparent",
                boxShadow: r.n === "writer" ? "0 1px 3px rgba(28,28,28,0.04)" : "none",
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: r.s === "running" ? "var(--moss-stone)" :
                              r.s === "waiting" ? "var(--persimmon)" :
                              r.s === "failed" ? "var(--vermillion-seal)" : "var(--stone-gray)",
                  boxShadow: r.s === "running" ? "0 0 0 3px rgba(107,123,94,0.15)" :
                             r.s === "waiting" ? "0 0 0 3px rgba(212,118,58,0.15)" : "none",
                }}/>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: r.role === "commander" ? "var(--fg)" : "var(--fg-muted)" }}>{r.n}</div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.task}</div>
                </div>
                {r.pending > 0 && (
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--vermillion-seal)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{r.pending}</span>
                )}
              </div>
            ))}
          </div>

          {/* selected sub panel */}
          <div style={{ marginTop: "auto", padding: "14px 14px", background: "var(--washi-white)", borderRadius: "3px 12px 3px 12px", border: "1px solid var(--border-hair)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <div>
                <span className="whisper" style={{ fontSize: 9 }}>selected</span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, marginTop: 2 }}>writer</div>
              </div>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--fg-faint)", letterSpacing: "0.10em", textTransform: "uppercase" }}>2 approvals</span>
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.5, marginBottom: 10 }}>
              "Draft v2 ready — review tone of Q3 section?"
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ fontFamily: "var(--font-body)", fontSize: 11, padding: "6px 10px", border: "1px solid var(--sumi-black)", background: "var(--sumi-black)", color: "var(--washi-white)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em", cursor: "pointer" }}>Open</button>
              <button style={{ fontFamily: "var(--font-body)", fontSize: 11, padding: "6px 10px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-muted)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em", cursor: "pointer" }}>Approve 2</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.7, maxWidth: 720 }}>
        Why an indented list over the constellation? In production, users need to <b style={{fontWeight:500}}>scan pending approvals fastest</b>. The tree preserves parent→child (who delegated what), and the selected-sub panel lets you act without leaving the commander's chat.
      </div>
    </NorthStarFrame>
  );
}

function TeamSurface() {
  return (
    <div>
      <SurfaceHeading
        count="02"
        title="Team view"
        subtitle={`"A commander has a team of agents working underneath." Five ways to represent the org chart of a single running session.`}
      />
      <VariantGrid cols={2} gap={56}>
        <TeamA /><TeamB /><TeamC /><TeamD /><TeamE />
      </VariantGrid>
      <div style={{ height: 80 }}/>
      <TeamNorthStar />
    </div>
  );
}

Object.assign(window, { TeamSurface });
