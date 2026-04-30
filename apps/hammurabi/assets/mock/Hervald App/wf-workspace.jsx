// WORKSPACE — local file system inside a session
// Variants A..E + polished North Star.

// ============================================================
// A · Modal (today's pattern)
// ============================================================
function WorkspaceA() {
  return (
    <div>
      <VariantLabel letter="A" name="Modal" tagline="Today's pattern — opens over the chat." />
      <SketchFrame style={{ minHeight: 340, position: "relative" }}>
        {/* chat behind */}
        <div style={{ opacity: 0.3 }}>
          <Scribble size={18}>jarvis</Scribble>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {[60, 80, 50].map((w,i) => <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(28,28,28,0.06)" }}/>)}
          </div>
        </div>
        {/* modal */}
        <div style={{ position: "absolute", left: "8%", right: "8%", top: 30, bottom: 30, border: "1.5px solid var(--sumi-black)", background: "var(--washi-white)", borderRadius: "3px 14px 3px 14px", padding: 14, filter: "url(#rough)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <Scribble size={16}>workspace</Scribble>
            <Scribble size={14} color="var(--fg-subtle)">×</Scribble>
          </div>
          <div style={{ border: "1.2px dashed var(--border-soft)", padding: "6px 10px", marginBottom: 10, borderRadius: "2px 8px 2px 8px" }}>
            <Scribble size={12} color="var(--diluted-ink)" italic>search files…</Scribble>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            {["files","changes","git"].map((t,i) => (
              <Scribble key={t} size={13} style={{ textDecoration: i===0?"underline":"none", color: i===0?"var(--sumi-black)":"var(--diluted-ink)" }}>{t}</Scribble>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {[".harmonic",".config","src","package.json","readme.md"].map(f => (
              <div key={f} style={{ display: "flex", justifyContent: "space-between", padding: "2px 4px" }}>
                <Scribble size={13}>{f}</Scribble>
                <Scribble size={11} color="var(--diluted-ink)">+ add</Scribble>
              </div>
            ))}
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Blocks the chat. Okay for quick add; bad for review.</div>
    </div>
  );
}

// ============================================================
// B · Right docked panel (pinnable)
// ============================================================
function WorkspaceB() {
  return (
    <div>
      <VariantLabel letter="B" name="Docked panel" tagline="Slides from the right; pin to keep it open during chat." />
      <SketchFrame style={{ minHeight: 340 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10, minHeight: 320 }}>
          <div>
            <Scribble size={18}>jarvis</Scribble>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {[60,80,50,70].map((w,i) => <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(28,28,28,0.06)" }}/>)}
            </div>
          </div>
          <div style={{ borderLeft: "1.5px dashed var(--border-soft)", paddingLeft: 10, filter: "url(#rough)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Whisper>files</Whisper>
              <Scribble size={12} color="var(--diluted-ink)">📌</Scribble>
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
              {["src/","components/","App.tsx","theme.css","package.json"].map(f => (
                <Scribble key={f} size={12}>{f.endsWith("/")?"▸ ":"  "}{f}</Scribble>
              ))}
            </div>
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--border-soft)" }}>
              <Whisper style={{ fontSize: 8 }}>in context · 2</Whisper>
              <div style={{ marginTop: 4 }}>
                <Scribble size={11}>• App.tsx</Scribble><br/>
                <Scribble size={11}>• theme.css</Scribble>
              </div>
            </div>
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Chat + files side-by-side. Standard IDE pattern.</div>
    </div>
  );
}

// ============================================================
// C · Inline file chips in conversation (novel)
// ============================================================
function WorkspaceC() {
  return (
    <div>
      <VariantLabel letter="C" name="Inline chips" tagline="Files are referenced as chips in the chat itself. Hover expands." />
      <SketchFrame style={{ minHeight: 340 }}>
        <Scribble size={18}>jarvis</Scribble>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <Scribble size={13} color="var(--fg-muted)">read</Scribble>
            <span style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
              {["App.tsx","theme.css"].map(f => (
                <span key={f} style={{ border: "1.2px solid var(--sumi-black)", padding: "2px 8px", borderRadius: "2px 8px 2px 8px", filter: "url(#rough)" }}>
                  <Scribble size={12}>📄 {f}</Scribble>
                </span>
              ))}
            </span>
          </div>
          <Scribble size={13} color="var(--fg-muted)" italic>→ Reviewed; the theme split looks clean. Edit theme.css?</Scribble>
          <div>
            <Scribble size={13} color="var(--fg-muted)">edit</Scribble>
            <span style={{ border: "1.2px solid var(--persimmon)", padding: "2px 8px", borderRadius: "2px 8px 2px 8px", filter: "url(#rough)", marginLeft: 8 }}>
              <Scribble size={12} color="var(--persimmon)">✎ theme.css  +12 −4</Scribble>
            </span>
          </div>
          <div style={{ marginTop: 20, border: "1.2px dashed var(--border-soft)", padding: "8px 10px", borderRadius: "2px 8px 2px 8px" }}>
            <Scribble size={12} color="var(--diluted-ink)" italic>@ to add a file · type / for commands</Scribble>
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Keeps focus in chat. Diff lives beside the edit that caused it.</div>
    </div>
  );
}

// ============================================================
// D · Scroll stack (novel metaphor)
// ============================================================
function WorkspaceD() {
  const files = ["App.tsx", "theme.css", "package.json"];
  return (
    <div>
      <VariantLabel letter="D" name="Scroll stack" tagline="Each opened file becomes a vertical scroll on the right; pin to keep." />
      <SketchFrame style={{ minHeight: 340 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 14, minHeight: 320 }}>
          <div>
            <Scribble size={18}>jarvis</Scribble>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {[60,80,50].map((w,i) => <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(28,28,28,0.06)" }}/>)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            {files.map((f,i) => (
              <div key={f} style={{
                width: "100%", padding: "14px 6px",
                writingMode: "vertical-rl",
                textOrientation: "mixed",
                border: "1.2px solid var(--sumi-black)",
                borderRadius: "2px 8px 2px 8px",
                filter: "url(#rough)",
                background: i===0?"rgba(28,28,28,0.04)":"transparent",
                textAlign: "center",
              }}>
                <Scribble size={13}>{f}</Scribble>
              </div>
            ))}
            <Scribble size={11} color="var(--diluted-ink)">+</Scribble>
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Literal scrolls. Click to expand inline.</div>
    </div>
  );
}

// ============================================================
// E · Split-pane (diff-first)
// ============================================================
function WorkspaceE() {
  return (
    <div>
      <VariantLabel letter="E" name="Split · diff-first" tagline="Chat left, agent-made changes right. Every edit is reviewable in place." />
      <SketchFrame style={{ minHeight: 340 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <Scribble size={18}>jarvis</Scribble>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {[60,80,50,40].map((w,i) => <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(28,28,28,0.06)" }}/>)}
            </div>
          </div>
          <div style={{ borderLeft: "1.5px dashed var(--border-soft)", paddingLeft: 10, filter: "url(#rough)" }}>
            <Whisper>changes · 3</Whisper>
            <div style={{ marginTop: 8 }}>
              <Scribble size={13}>theme.css</Scribble>
              <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 10, lineHeight: 1.5 }}>
                <div style={{ background: "rgba(194,59,34,0.10)", padding: "1px 4px" }}>- --primary: #3B82F6;</div>
                <div style={{ background: "rgba(107,123,94,0.12)", padding: "1px 4px" }}>+ --primary: #1C1C1C;</div>
                <div style={{ background: "rgba(107,123,94,0.12)", padding: "1px 4px" }}>+ --accent: #C23B22;</div>
              </div>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
              <span style={{ border: "1px solid var(--sumi-black)", padding: "2px 8px", borderRadius: "2px 6px 2px 6px", filter: "url(#rough)" }}>
                <Scribble size={11}>accept</Scribble>
              </span>
              <span style={{ border: "1px solid var(--vermillion-seal)", padding: "2px 8px", borderRadius: "2px 6px 2px 6px", filter: "url(#rough)" }}>
                <Scribble size={11} color="var(--vermillion-seal)">revert</Scribble>
              </span>
            </div>
          </div>
        </div>
      </SketchFrame>
      <div style={{ marginTop: 10, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", lineHeight: 1.6 }}>Review-first. Best for governance-heavy teams.</div>
    </div>
  );
}

// ============================================================
// NORTH STAR — hybrid: inline chips + collapsible panel
// ============================================================
function WorkspaceNorthStar() {
  return (
    <NorthStarFrame label="north star · workspace">
      <VariantLabel letter="★" name="Chips inline, scroll on demand" tagline="Files appear as first-class chips within the transcript; a right panel opens only when you want to browse, pin, or review diffs." />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 0, minHeight: 480, background: "var(--washi-white)", border: "1px solid var(--border-hair)", borderRadius: "4px 16px 4px 16px", overflow: "hidden" }}>
        {/* Chat */}
        <div style={{ padding: "20px 28px", borderRight: "1px solid var(--border-hair)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, paddingBottom: 14, borderBottom: "1px solid var(--border-hair)" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}>jarvis</span>
            <span className="whisper" style={{ fontSize: 10 }}>~/projects/hervald</span>
          </div>

          <div style={{ flex: 1, padding: "20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* User msg with file mention */}
            <div style={{ alignSelf: "flex-end", maxWidth: 420 }}>
              <div style={{ background: "var(--sumi-black)", color: "var(--washi-white)", padding: "12px 16px", borderRadius: "14px 3px 14px 3px", fontSize: 13, lineHeight: 1.65 }}>
                Re-theme <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.15)", padding: "1px 8px", borderRadius: "2px 8px 2px 8px", fontFamily: "var(--font-mono)", fontSize: 12 }}>theme.css</span> to match the Hervald palette.
              </div>
            </div>

            {/* Agent reads */}
            <div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>read · 2 files</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {["theme.css", "tokens/colors.ts"].map(f => (
                  <span key={f} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "var(--aged-paper)", padding: "4px 10px",
                    borderRadius: "2px 8px 2px 8px",
                    fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)",
                    border: "1px solid var(--border-hair)",
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--moss-stone)" }}/>
                    {f}
                  </span>
                ))}
              </div>
            </div>

            {/* Agent reply */}
            <div style={{ background: "var(--aged-paper)", padding: "12px 16px", borderRadius: "3px 14px 3px 14px", maxWidth: 480 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.65 }}>
                Swapped primary to sumi black, accent to vermillion, and removed the blue pair. One diff pending review.
              </p>
            </div>

            {/* Agent writes — diff chip */}
            <div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>edit · pending approval</div>
              <div style={{ border: "1px solid var(--persimmon)", borderRadius: "3px 12px 3px 12px", padding: "10px 14px", maxWidth: 480, background: "var(--washi-white)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg)" }}>theme.css</span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--persimmon)", letterSpacing: "0.08em", textTransform: "uppercase" }}>+12 −4</span>
                </div>
                <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.6, background: "transparent" }}>
<span style={{ background: "rgba(194,59,34,0.08)", color: "var(--vermillion-seal)", display: "block", padding: "0 4px" }}>- --primary: #3B82F6;</span>
<span style={{ background: "rgba(107,123,94,0.12)", color: "var(--moss-stone)", display: "block", padding: "0 4px" }}>+ --primary: #1C1C1C;</span>
<span style={{ background: "rgba(107,123,94,0.12)", color: "var(--moss-stone)", display: "block", padding: "0 4px" }}>+ --accent:  #C23B22;</span>
                </pre>
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <button style={{ fontFamily: "var(--font-body)", fontSize: 11, padding: "5px 12px", border: "1px solid var(--sumi-black)", background: "var(--sumi-black)", color: "var(--washi-white)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em", cursor: "pointer" }}>Accept</button>
                  <button style={{ fontFamily: "var(--font-body)", fontSize: 11, padding: "5px 12px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-muted)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em", cursor: "pointer" }}>Open diff</button>
                  <button style={{ fontFamily: "var(--font-body)", fontSize: 11, padding: "5px 12px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--vermillion-seal)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em", cursor: "pointer" }}>Reject</button>
                </div>
              </div>
            </div>
          </div>

          {/* composer */}
          <div style={{ border: "1px solid var(--border-hair)", borderRadius: "3px 14px 3px 14px", padding: "12px 16px", marginBottom: 4, background: "var(--washi-white)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-subtle)", fontStyle: "italic" }}>Send a message… type @ to add a file</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.12em", textTransform: "uppercase" }}>2 in ctx</span>
          </div>
        </div>

        {/* Collapsible file panel */}
        <div style={{ background: "var(--aged-paper)", padding: "20px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="whisper" style={{ fontSize: 10 }}>workspace</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", letterSpacing: "0.12em", textTransform: "uppercase" }}>files · changes · git</span>
          </div>

          <div style={{ border: "1px solid var(--border-hair)", borderRadius: "3px 10px 3px 10px", padding: "8px 12px", background: "var(--washi-white)" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic" }}>Search files…</span>
          </div>

          {/* Pinned */}
          <div>
            <span className="whisper" style={{ fontSize: 9 }}>in context · 2</span>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
              {["theme.css", "tokens/colors.ts"].map(f => (
                <div key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "var(--washi-white)", borderRadius: "2px 8px 2px 8px", borderLeft: "2px solid var(--sumi-black)" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>{f}</span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)" }}>×</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tree */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <span className="whisper" style={{ fontSize: 9 }}>tree</span>
            <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", display: "flex", flexDirection: "column", gap: 1 }}>
              {[
                { n: "▾ src", d: 0 },
                { n: "App.tsx", d: 1 },
                { n: "▸ components", d: 1 },
                { n: "▾ tokens", d: 1 },
                { n: "colors.ts", d: 2, pinned: true },
                { n: "theme.css", d: 0, pinned: true, changed: true },
                { n: "package.json", d: 0 },
                { n: "README.md", d: 0 },
              ].map((r,i) => (
                <div key={i} style={{ paddingLeft: 6 + r.d*14, display: "flex", justifyContent: "space-between", padding: "3px " + (6 + r.d*14) + "px" }}>
                  <span style={{ color: r.pinned ? "var(--fg)" : "var(--fg-subtle)" }}>{r.n}</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    {r.changed && <span style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--persimmon)", letterSpacing: "0.08em", textTransform: "uppercase" }}>M</span>}
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)" }}>+</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Changes summary */}
          <div style={{ paddingTop: 12, borderTop: "1px solid var(--border-hair)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="whisper" style={{ fontSize: 9 }}>uncommitted · 1</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--moss-stone)", letterSpacing: "0.08em", textTransform: "uppercase" }}>+12 −4</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.7, maxWidth: 720 }}>
        The chips-in-chat pattern makes <b style={{fontWeight:500}}>file intent</b> legible in conversation — what was read, what was edited, what's pending. The panel is there for browsing and git, but it's never in the way.
      </div>
    </NorthStarFrame>
  );
}

function WorkspaceSurface() {
  return (
    <div>
      <SurfaceHeading
        count="03"
        title="Workspace"
        subtitle={`"Enable users to modify or update their local file systems through the agent interaction interface." Browsing, reading, adding to context.`}
      />
      <VariantGrid cols={2} gap={56}>
        <WorkspaceA /><WorkspaceB /><WorkspaceC /><WorkspaceD /><WorkspaceE />
      </VariantGrid>
      <div style={{ height: 80 }}/>
      <WorkspaceNorthStar />
    </div>
  );
}

Object.assign(window, { WorkspaceSurface });
