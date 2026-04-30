// HI-FI · COMMANDER TABS
// Four panels exposing the commander's configuration and background work:
// Quests · Sentinels · Cron · Identity
// Rendered inside the Command Room's center column when the user leaves Chat.

// ============================================================
// QUESTS — kanban of this commander's backlog
// ============================================================
function QuestsPanel({ commander }) {
  const cols = [
    { label: "pending", count: 1, accent: "var(--persimmon)", items: [
      { t: "Implement monaco diff viewer in review surface",
        path: "/home/builder/App · claude · default",
        by: "athena · manual", age: "created 21h ago",
        artifacts: 2, status: "pending",
        refs: ["[issue] NickGUI/monorepo-g#1004", "[PR] NickGUI/monorepo-g#1006"] },
    ] },
    { label: "active", count: 0, accent: "var(--moss-stone)", items: [] },
    { label: "done", count: 247, accent: "var(--brushed-gray)", items: [
      { t: "Implement nick-gui-psite#19: page commenting system + agent-fetch API for visual iteration loop. New table page_comments already migrated on prod Supabase by Nick. Build admin-gated CRUD endpoints, comments-widget.js for static HTML, React CommentSidebar for SPA routes.",
        artifacts: 1, status: "done", condensed: true },
    ] },
    { label: "failed", count: 8, accent: "var(--vermillion-seal)", items: [
      { t: "Q4: Investigation — Zenos Product Transition…",
        path: "/home/builder/App/apps/hammurabi · claude · default",
        by: "athena · manual", age: "failed 6d ago",
        status: "failed" },
      { t: "Q3: gehirn.ai Website Revision — Full website…",
        path: "/home/builder/App/apps/hammurabi · claude · default",
        by: "athena · manual", age: "failed 6d ago",
        status: "failed" },
      { t: "Correct issue #899 — the SDK-driven turns…",
        path: "/home/builder/App/apps/hammurabi · manual",
        by: "athena · manual", age: "failed 8d ago",
        status: "failed" },
      { t: "Investigate monorepo-g#880: Commander…",
        by: "athena · claude", age: "failed 8d ago",
        status: "failed" },
    ] },
  ];

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* commander picker + add */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22 }}>
        <div style={{ flex: 1, maxWidth: 320 }}>
          <span className="whisper" style={{ fontSize: 10 }}>commander</span>
          <div style={{ marginTop: 6, padding: "8px 12px", border: "1px solid var(--border-hair)", background: "var(--aged-paper)", borderRadius: "3px 12px 3px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{commander.id}{commander.shortHash ? <span style={{ color: "var(--fg-faint)" }}> ({commander.shortHash})</span> : null}</span>
            <span style={{ color: "var(--fg-subtle)", fontSize: 11 }}>▾</span>
          </div>
        </div>
        <div style={{ flex: 1 }}/>
        <button style={{
          fontFamily: "var(--font-body)", fontSize: 12, letterSpacing: "0.04em",
          padding: "8px 16px", background: "var(--washi-white)",
          border: "1px solid var(--border-firm)", color: "var(--fg)",
          borderRadius: "2px 12px 2px 12px", cursor: "pointer",
        }}>+ Add Quest</button>
      </div>

      {/* 4-column kanban */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, minHeight: 0 }}>
        {cols.map(col => (
          <div key={col.label} style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 2px 10px" }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: col.accent, fontWeight: 500 }}>{col.label}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-subtle)" }}>{col.count}</span>
            </div>
            <div style={{
              flex: 1,
              background: "var(--aged-paper)",
              border: "1px solid var(--border-hair)",
              borderTop: `2px solid ${col.accent}`,
              borderRadius: "2px 10px 2px 10px",
              padding: 10,
              display: "flex", flexDirection: "column", gap: 8,
              overflow: "auto",
              minHeight: 0,
            }}>
              {col.items.length === 0 ? (
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)", fontStyle: "italic", padding: "20px 8px", textAlign: "center" }}>
                  No {col.label} quests.
                </div>
              ) : col.items.map((q, i) => <QuestCard key={i} q={q} accent={col.accent} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestCard({ q, accent }) {
  return (
    <div style={{
      background: "var(--washi-white)",
      border: "1px solid var(--border-hair)",
      borderRadius: "2px 10px 2px 10px",
      padding: "10px 12px",
      position: "relative",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: accent, flexShrink: 0,
          }}/>
          {q.status === "done" && <span style={{ color: "var(--brushed-gray)", fontSize: 11, marginRight: 2 }}>✓</span>}
          {q.status === "failed" && <span style={{ color: "var(--vermillion-seal)", fontSize: 11, marginRight: 2 }}>✕</span>}
        </div>
        <span style={{
          fontFamily: "var(--font-body)", fontSize: 8,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: accent,
          border: `1px solid ${accent}`,
          padding: "1px 6px",
          borderRadius: "2px 6px 2px 6px",
          flexShrink: 0,
        }}>{q.status}</span>
        <span style={{ color: "var(--fg-faint)", fontSize: 12, cursor: "pointer", marginLeft: "auto" }}>×</span>
      </div>

      <div style={{
        fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg)",
        lineHeight: 1.5, marginTop: 6,
        display: "-webkit-box", WebkitLineClamp: q.condensed ? 999 : 3,
        WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {q.t}
      </div>

      {q.artifacts > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{
            fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "var(--persimmon)",
            background: "rgba(212,118,58,0.08)",
            padding: "2px 7px", borderRadius: "2px 6px 2px 6px",
          }}>{q.artifacts} artifact{q.artifacts > 1 ? "s" : ""}</span>
        </div>
      )}

      {q.path && (
        <div style={{ marginTop: 7, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-subtle)", wordBreak: "break-all" }}>
          {q.path}
        </div>
      )}
      {q.by && (
        <div style={{ marginTop: 4, fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {q.by}  ·  {q.age}
        </div>
      )}
      {q.refs && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
          {q.refs.map(r => (
            <span key={r} style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--moss-stone)" }}>{r}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SENTINELS — scheduled, memory-carrying agents
// ============================================================
function SentinelsPanel({ commander }) {
  const sentinels = [
    { n: "prod-watch", cadence: "every 10m",
      mem: "tracking error rates · since Apr 1",
      last: "2m ago", next: "in 8m",
      state: "active",
      note: "Wakes on cron, reads its memory file, scans Sentry for new issues, posts to #alerts on spike." },
    { n: "calendar-scribe", cadence: "daily · 07:30",
      mem: "attendees, open threads, last 30 days",
      last: "yesterday", next: "tomorrow 07:30",
      state: "active",
      note: "Builds the morning briefing from calendar + email threads." },
    { n: "backlog-groomer", cadence: "weekly · mon 09:00",
      mem: "GitHub label history",
      last: "4d ago", next: "mon 09:00",
      state: "paused",
      note: "Re-triages stale issues and recommends closures." },
  ];

  return (
    <div style={{ padding: "24px 28px", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <span className="whisper" style={{ fontSize: 10 }}>attached sentinels</span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", fontStyle: "italic" }}>
          Scheduled automations scoped to {commander.id}.
        </span>
        <div style={{ flex: 1 }}/>
        <button style={{
          fontFamily: "var(--font-body)", fontSize: 12, letterSpacing: "0.04em",
          padding: "8px 16px", background: "var(--washi-white)",
          border: "1px solid var(--border-firm)", color: "var(--fg)",
          borderRadius: "2px 12px 2px 12px", cursor: "pointer",
        }}>+ Add Sentinel</button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "auto", minHeight: 0 }}>
        {sentinels.map(s => (
          <div key={s.n} style={{
            background: "var(--washi-white)",
            border: "1px solid var(--border-hair)",
            borderLeft: s.state === "active" ? "2px solid var(--moss-stone)" : "2px solid var(--border-firm)",
            borderRadius: "3px 14px 3px 14px",
            padding: "16px 18px",
            display: "grid",
            gridTemplateColumns: "1.3fr 1fr auto",
            gap: 20,
            alignItems: "start",
          }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: s.state === "active" ? "var(--moss-stone)" : "var(--stone-gray)",
                  boxShadow: s.state === "active" ? "0 0 0 3px rgba(107,123,94,0.15)" : "none",
                }}/>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--fg)" }}>{s.n}</span>
                <span style={{
                  fontFamily: "var(--font-body)", fontSize: 9,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: s.state === "active" ? "var(--moss-stone)" : "var(--fg-subtle)",
                  border: `1px solid ${s.state === "active" ? "var(--moss-stone)" : "var(--border-firm)"}`,
                  padding: "2px 8px", borderRadius: "2px 8px 2px 8px",
                }}>{s.state}</span>
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.6 }}>{s.note}</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>cadence</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 2, color: "var(--fg)" }}>{s.cadence}</div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>memory</div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11, marginTop: 2, color: "var(--fg-muted)", fontStyle: "italic" }}>{s.mem}</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>last · next</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, marginTop: 2, color: "var(--fg)" }}>{s.last}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--persimmon)" }}>{s.next}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ fontFamily: "var(--font-body)", fontSize: 10, padding: "4px 10px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-muted)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em" }}>Run now</button>
                <button style={{ fontFamily: "var(--font-body)", fontSize: 10, padding: "4px 10px", border: "1px solid var(--border-firm)", background: "transparent", color: "var(--fg-muted)", borderRadius: "2px 8px 2px 8px", letterSpacing: "0.04em" }}>Edit</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, padding: "12px 16px", background: "var(--aged-paper)", borderRadius: "3px 12px 3px 12px", border: "1px dashed var(--border-firm)" }}>
        <span className="whisper" style={{ fontSize: 10 }}>what's a sentinel?</span>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-muted)", fontStyle: "italic", marginTop: 4, lineHeight: 1.6 }}>
          A cron-triggered agent <b style={{ fontWeight: 500, color: "var(--fg)" }}>with persistent memory</b>. Unlike a Cron task, a sentinel remembers what it saw last time — state accumulates over runs.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CRON — stateless scheduled tasks
// ============================================================
function CronPanel({ commander }) {
  const runs = [
    { cron: "30 0 * * *",
      cmd: "/domain-distill --all. After distillation completes, run: GEMINI_API_KEY=$(grep GEMINI_API_KEY /home/builder/App/apps/kaizen_os/app/.env | cut -d = -f2) python3 /home/builder/App/agent-skills/pkos/knowledge-search/knowledge_search.py --rebuild to update the knowledge-search index with any new/changed files.",
      agent: "claude · default",
      next: "4/19/2026, 12:30:00 AM", active: true },
    { cron: "0 23 * * *",
      cmd: "/daily-review",
      agent: "claude · default",
      next: "4/18/2026, 11:00:00 PM", active: true },
  ];

  return (
    <div style={{ padding: "24px 28px", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <span className="whisper" style={{ fontSize: 10 }}>{runs.length} scheduled runs</span>
        <div style={{ flex: 1 }}/>
        <button style={{
          fontFamily: "var(--font-body)", fontSize: 12, letterSpacing: "0.04em",
          padding: "8px 16px", background: "var(--washi-white)",
          border: "1px solid var(--border-firm)", color: "var(--fg)",
          borderRadius: "2px 12px 2px 12px", cursor: "pointer",
        }}>+ Add Task</button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, overflow: "auto", minHeight: 0 }}>
        {runs.map((r, i) => (
          <div key={i} style={{
            background: "var(--washi-white)",
            border: "1px solid var(--border-hair)",
            borderRadius: "3px 12px 3px 12px",
            padding: "14px 18px",
            display: "grid",
            gridTemplateColumns: "auto 1fr auto auto",
            gap: 16,
            alignItems: "start",
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: r.active ? "var(--moss-stone)" : "var(--stone-gray)",
              marginTop: 6,
              boxShadow: r.active ? "0 0 0 3px rgba(107,123,94,0.15)" : "none",
            }}/>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--fg)" }}>{r.cron}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", marginTop: 6, lineHeight: 1.6, wordBreak: "break-word" }}>{r.cmd}</div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 8 }}>
                {r.agent}  ·  next: {r.next}
              </div>
            </div>
            <button style={{ background: "transparent", border: "1px solid var(--border-firm)", color: "var(--fg-muted)", fontSize: 11, padding: "4px 8px", borderRadius: "2px 8px 2px 8px", cursor: "pointer", fontFamily: "var(--font-mono)" }}>▶</button>
            <button style={{ background: "transparent", border: "none", color: "var(--fg-faint)", fontSize: 13, cursor: "pointer" }}>×</button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, padding: "12px 16px", background: "var(--aged-paper)", borderRadius: "3px 12px 3px 12px", border: "1px dashed var(--border-firm)" }}>
        <span className="whisper" style={{ fontSize: 10 }}>what's cron?</span>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-muted)", fontStyle: "italic", marginTop: 4, lineHeight: 1.6 }}>
          A stateless scheduled run. The agent wakes on the crontab expression, runs the command, exits — <b style={{ fontWeight: 500, color: "var(--fg)" }}>no memory carries forward</b>. Use for idempotent jobs; use Sentinels when state should accumulate.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// IDENTITY — runtime config + Commander.md
// ============================================================
function IdentityPanel({ commander }) {
  return (
    <div style={{ padding: "24px 28px", height: "100%", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
      {/* Runtime config card */}
      <section style={{
        background: "var(--aged-paper)",
        border: "1px solid var(--border-hair)",
        borderRadius: "3px 14px 3px 14px",
        padding: "18px 22px",
      }}>
        <span className="whisper" style={{ fontSize: 10 }}>runtime config</span>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>claude effort</div>
            <div style={{ marginTop: 6, padding: "9px 12px", background: "var(--washi-white)", border: "1px solid var(--border-hair)", borderRadius: "2px 10px 2px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>max</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)" }}>▾</span>
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 5 }}>
              Applied whenever this commander launches a Claude session. Default: <span style={{ fontFamily: "var(--font-mono)" }}>max</span>.
            </div>
          </div>

          <div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)" }}>agent type</div>
            <div style={{ marginTop: 6, padding: "9px 12px", background: "var(--washi-white)", border: "1px solid var(--border-hair)", borderRadius: "2px 10px 2px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>claude</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)" }}>▾</span>
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 5 }}>
              Inference provider. Change restarts the session.
            </div>
          </div>
        </div>

        <button style={{
          marginTop: 16,
          fontFamily: "var(--font-body)", fontSize: 12, letterSpacing: "0.04em",
          padding: "8px 18px", background: "var(--sumi-black)",
          color: "var(--washi-white)", border: "none",
          borderRadius: "2px 10px 2px 10px", cursor: "pointer",
        }}>Save config</button>
      </section>

      {/* Commander.md */}
      <section style={{
        background: "var(--washi-white)",
        border: "1px solid var(--border-hair)",
        borderRadius: "3px 14px 3px 14px",
        padding: "20px 24px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span className="whisper" style={{ fontSize: 10 }}>commander.md</span>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-subtle)", letterSpacing: "0.08em", textTransform: "uppercase" }}>editable · cmd+s saves</span>
        </div>

        <div style={{ fontFamily: "var(--font-body)", fontSize: 13.5, color: "var(--fg)", lineHeight: 1.75 }}>
          <h3 style={{ fontFamily: "var(--font-primary)", fontWeight: 400, fontSize: 18, margin: "0 0 8px", letterSpacing: "-0.01em" }}>heartbeat fire interval in milliseconds (default: 300000 = 5 min)</h3>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)", background: "var(--aged-paper)", padding: "6px 10px", borderRadius: "2px 6px 2px 6px", display: "inline-block" }}>heartbeat.interval: 900000</div>

          <h3 style={{ fontFamily: "var(--font-primary)", fontWeight: 400, fontSize: 18, margin: "24px 0 8px", letterSpacing: "-0.01em" }}>override the default heartbeat message sent to the agent</h3>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)", background: "var(--aged-paper)", padding: "8px 12px", borderRadius: "2px 6px 2px 6px", lineHeight: 1.6 }}>
            heartbeat.message: "Check your quest board. What is your current task? Post a progress note, then continue or pick up the next quest."
          </div>

          <h3 style={{ fontFamily: "var(--font-primary)", fontWeight: 400, fontSize: 18, margin: "24px 0 8px", letterSpacing: "-0.01em" }}>max agent turns per session start (1–10, default: 3)</h3>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)", background: "var(--aged-paper)", padding: "6px 10px", borderRadius: "2px 6px 2px 6px", display: "inline-block" }}>maxTurns: 3</div>

          <h3 style={{ fontFamily: "var(--font-primary)", fontWeight: 400, fontSize: 18, margin: "24px 0 8px", letterSpacing: "-0.01em" }}>context delivery mode: "fat" (full) or "thin" (3000-token budget)</h3>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)", background: "var(--aged-paper)", padding: "6px 10px", borderRadius: "2px 6px 2px 6px", display: "inline-block" }}>contextMode: fat</div>

          <h3 style={{ fontFamily: "var(--font-primary)", fontWeight: 400, fontSize: 18, margin: "24px 0 8px", letterSpacing: "-0.01em" }}>System prompt: add text below the closing --- to replace the default Commander prompt</h3>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-subtle)", fontStyle: "italic", background: "var(--aged-paper)", padding: "10px 12px", borderRadius: "2px 6px 2px 6px", lineHeight: 1.7 }}>
            ---<br/>
            You are athena, a long-running commander. Your job is to pull the next quest, execute it, and return results to the human lead. Favor small, reversible steps. When blocked on policy, stop and ask.
          </div>
        </div>
      </section>

      {/* Heartbeat preview */}
      <section style={{
        background: "var(--aged-paper)",
        border: "1px solid var(--border-hair)",
        borderRadius: "3px 14px 3px 14px",
        padding: "18px 22px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="whisper" style={{ fontSize: 10 }}>last heartbeat</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-subtle)" }}>3m 42s ago · next in 11m 18s</span>
        </div>
        <div style={{ marginTop: 12, background: "var(--washi-white)", border: "1px solid var(--border-hair)", borderRadius: "2px 10px 2px 10px", padding: "12px 16px" }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>sent to {commander.id}</div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.7 }}>
            "Check your quest board. What is your current task? Post a progress note, then continue or pick up the next quest."
          </div>
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { QuestsPanel, SentinelsPanel, CronPanel, IdentityPanel });
