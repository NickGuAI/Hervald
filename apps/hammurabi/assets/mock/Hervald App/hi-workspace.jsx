// HI-FI · WORKSPACE (modal, kept as-is)
function WorkspaceHi() {
  const files = [
    { n: ".harmonic/", kind: "dir" },
    { n: ".config/",   kind: "dir" },
    { n: "src/",       kind: "dir", open: true },
    { n: "  App.tsx",    kind: "file", inCtx: true },
    { n: "  theme.css",  kind: "file", inCtx: true },
    { n: "  index.ts",   kind: "file" },
    { n: "package.json", kind: "file" },
    { n: "readme.md",    kind: "file" },
  ];
  const recent = [
    { f: "src/App.tsx", by: "writer", ago: "2m" },
    { f: "src/theme.css", by: "writer", ago: "4m" },
  ];
  return (
    <div style={{
      background: "var(--washi-white)",
      border: "1px solid var(--border-hair)",
      borderRadius: "4px 20px 4px 20px",
      overflow: "hidden",
      boxShadow: "0 4px 20px rgba(28,28,28,0.04), 0 40px 80px rgba(28,28,28,0.06)",
      minHeight: 640,
      position: "relative",
    }}>
      {/* Top chrome */}
      <div style={{
        background: "#0F0F0F", color: "var(--washi-white)",
        padding: "10px 20px", display: "flex", alignItems: "center", gap: 14,
        fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase",
      }}>
        <span style={{ color: "var(--vermillion-seal)", fontSize: 14, letterSpacing: 0 }}>●</span>
        <span style={{ fontFamily: "var(--font-primary)", fontSize: 15, textTransform: "none", letterSpacing: "-0.01em" }}>Hervald</span>
        <span style={{ opacity: 0.4, marginLeft: 4 }}>/</span>
        <span style={{ opacity: 0.7 }}>jarvis · workspace</span>
        <span style={{ flex: 1 }}/>
        <span style={{ opacity: 0.5 }}>modal over chat</span>
      </div>

      {/* Blurred chat behind */}
      <div style={{ position: "absolute", inset: "40px 0 0", padding: "24px 32px", opacity: 0.18, filter: "blur(1.5px)", pointerEvents: "none" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 14 }}>jarvis</div>
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {[60, 80, 50, 70, 45].map((w,i) => (
            <div key={i} style={{ height: 14, width: `${w}%`, background: "rgba(28,28,28,0.08)", borderRadius: 2, alignSelf: i%2 ? "flex-end" : "flex-start" }}/>
          ))}
        </div>
      </div>

      {/* Modal */}
      <div style={{
        position: "absolute", left: "8%", right: "8%", top: 80, bottom: 50,
        background: "var(--washi-white)",
        border: "1px solid var(--border-firm)",
        borderRadius: "4px 18px 4px 18px",
        boxShadow: "0 30px 80px rgba(28,28,28,0.18)",
        display: "grid", gridTemplateColumns: "280px 1fr",
        overflow: "hidden",
      }}>
        {/* Left: file tree */}
        <div style={{ background: "var(--aged-paper)", borderRight: "1px solid var(--border-hair)", padding: "18px 16px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
            <span className="whisper" style={{ fontSize: 10 }}>workspace · 247 files</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.1em", textTransform: "uppercase" }}>esc</span>
          </div>
          <div style={{ padding: "8px 12px", border: "1px solid var(--border-hair)", borderRadius: "2px 10px 2px 10px", background: "var(--washi-white)", marginBottom: 14 }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 12, fontStyle: "italic", color: "var(--fg-subtle)" }}>search files…</span>
          </div>
          <div style={{ display: "flex", gap: 14, marginBottom: 12, fontFamily: "var(--font-body)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            <span style={{ color: "var(--sumi-black)", borderBottom: "2px solid var(--sumi-black)", paddingBottom: 4 }}>files</span>
            <span style={{ color: "var(--fg-subtle)" }}>changes · 2</span>
            <span style={{ color: "var(--fg-subtle)" }}>git</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {files.map(f => (
              <div key={f.n} style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", borderRadius: "2px 6px 2px 6px", background: f.inCtx ? "var(--washi-white)" : "transparent" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: f.kind === "dir" ? "var(--fg)" : "var(--fg-muted)" }}>
                  {f.kind === "dir" ? (f.open ? "▾ " : "▸ ") : ""}{f.n.trim()}
                </span>
                {f.inCtx && <span style={{ fontSize: 9, color: "var(--moss-stone)", letterSpacing: "0.1em", textTransform: "uppercase" }}>ctx</span>}
              </div>
            ))}
          </div>
          <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--border-hair)" }}>
            <span className="whisper" style={{ fontSize: 9 }}>in context · 2</span>
            <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
              <div>• App.tsx</div>
              <div>• theme.css</div>
            </div>
          </div>
        </div>

        {/* Right: file content */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--border-hair)", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14 }}>src/App.tsx</span>
            <span style={{ flex: 1 }}/>
            <span style={{ fontSize: 11, color: "var(--fg-subtle)" }}>last edited by <span style={{ fontFamily: "var(--font-mono)" }}>writer</span> · 2m ago</span>
          </div>
          <div style={{ flex: 1, background: "#FCFAF5", padding: "18px 22px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.75, color: "var(--fg-muted)", overflow: "auto" }}>
            {[
              { l: 1,  t: 'import { Agent } from "./agent";' },
              { l: 2,  t: 'import { theme } from "./theme";' },
              { l: 3,  t: "" },
              { l: 4,  t: "export function App() {" },
              { l: 5,  t: "  const commander = useCommander();" },
              { l: 6,  t: "  const team = commander.team;" },
              { l: 7,  t: "" },
              { l: 8,  t: "  return (" },
              { l: 9,  t: '    <Shell theme={theme}>' },
              { l: 10, t: '      <Commander agent={commander} />' },
              { l: 11, t: '      <Team members={team} />' },
              { l: 12, t: "    </Shell>" },
              { l: 13, t: "  );" },
              { l: 14, t: "}" },
            ].map(r => (
              <div key={r.l} style={{ display: "flex", gap: 14, padding: "0 4px" }}>
                <span style={{ color: "var(--fg-faint)", width: 22, textAlign: "right", fontSize: 11 }}>{r.l}</span>
                <span style={{ whiteSpace: "pre", color: "var(--fg-muted)" }}>{r.t || " "}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "12px 22px", borderTop: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--aged-paper)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="whisper" style={{ fontSize: 9 }}>recent activity</span>
              {recent.map(c => (
                <span key={c.f} style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "4px 10px", background: "var(--washi-white)", border: "1px solid var(--border-hair)", borderRadius: "2px 8px 2px 8px" }}>{c.f} <span style={{color:"var(--fg-faint)"}}>· {c.ago}</span></span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ fontFamily: "var(--font-body)", fontSize: 11, padding: "6px 14px", border: "none", background: "var(--sumi-black)", color: "var(--washi-white)", borderRadius: "2px 10px 2px 10px", letterSpacing: "0.04em" }}>Attach to chat</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceSurface() {
  return (
    <div>
      <SurfaceHeading
        count="04"
        title="Workspace"
        subtitle="Staying with the modal pattern — opens over the active chat, dismisses with esc. Files and the latest content, agents edit directly; no diff approval gate."
      />
      <WorkspaceHi />
      <div style={{ marginTop: 28, maxWidth: 720, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.7 }}>
        Per product direction — workspace remains its own modal surface. File edits by agents flow through without approval; you see the current state of the tree and the latest content. Approval is reserved for agent <i>actions</i> (send email, publish, shell) and happens inline in the chat.
      </div>
    </div>
  );
}

Object.assign(window, { WorkspaceSurface });
