// ============================================================
// Hervald — Fleet dashboard.
// Swim-lanes across all commanders · last 30 min.
// ============================================================

function Fleet() {
  const { commanders, fleetEvents, fleetWindow, workers, approvals } = window.HV_DATA;
  const [zoom, setZoom] = React.useState(30); // 5 | 15 | 30 | 60

  return (
    <div style={{
      flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
      overflow: "hidden", background: "var(--bg)",
    }}>
      {/* Summary strip */}
      <div style={{
        padding: "22px 32px 18px",
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20,
        borderBottom: "1px solid var(--border-hair)",
      }}>
        <SummaryCard label="Commanders" main={`${commanders.filter(c=>c.status==="connected").length} / ${commanders.length}`}
                     sub="connected"/>
        <SummaryCard label="Workers active" main={workers.filter(w=>w.state==="active").length}
                     sub={`${workers.filter(w=>w.state==="done").length} completed · last 30m`}/>
        <SummaryCard label="Approvals" main={approvals.length}
                     sub={approvals.filter(a=>a.risk==="high").length + " high risk"}
                     tone={approvals.length ? "critical" : "neutral"}/>
        <SummaryCard label="Quests" main="0 / 0" sub="pending · active"/>
      </div>

      {/* Controls */}
      <div style={{
        padding: "14px 32px",
        display: "flex", alignItems: "center", gap: 16,
        borderBottom: "1px solid var(--border-hair)",
      }}>
        <span style={{
          fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "var(--fg-subtle)",
        }}>Window</span>
        <div style={{
          display: "flex", gap: 2,
          background: "var(--ink-wash-02)",
          border: "1px solid var(--border-hair)",
          borderRadius: "2px 10px 2px 10px",
          padding: 3,
        }}>
          {[5, 15, 30, 60].map(n => (
            <button key={n} onClick={() => setZoom(n)} style={{
              padding: "5px 12px",
              background: zoom === n ? "var(--washi-white)" : "transparent",
              color: zoom === n ? "var(--fg)" : "var(--fg-subtle)",
              border: "none", cursor: "pointer",
              fontFamily: "var(--font-body)", fontSize: 11.5,
              letterSpacing: "0.02em",
              borderRadius: "2px 8px 2px 8px",
              boxShadow: zoom === n ? "var(--shadow-whisper)" : "none",
            }}>{n}m</button>
          ))}
        </div>

        <span style={{ flex: 1 }}/>

        <LegendSwatch color="var(--moss-stone)" label="worker"/>
        <LegendSwatch color="var(--diluted-ink)" label="tool"/>
        <LegendSwatch color="var(--vermillion-seal)" label="blocked"/>
        <LegendSwatch color="var(--ink-wash-03)" label="idle" ring/>
      </div>

      {/* Swim lanes */}
      <div className="hv-scroll" style={{
        flex: 1, overflow: "auto", padding: "20px 32px 40px",
      }}>
        <SwimLanes commanders={commanders} events={fleetEvents} zoom={zoom}/>
      </div>
    </div>
  );
}

function SummaryCard({ label, main, sub, tone }) {
  return (
    <div style={{
      padding: "18px 20px",
      background: "var(--washi-white)",
      border: "1px solid var(--border-hair)",
      borderRadius: "2px 16px 2px 16px",
    }}>
      <div style={{
        fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase",
        color: "var(--fg-subtle)", marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontFamily: "var(--font-primary)", fontWeight: 300,
        fontSize: 32, lineHeight: 1, color: tone === "critical" ? "var(--vermillion-seal)" : "var(--fg)",
        letterSpacing: "-0.01em",
      }}>{main}</div>
      <div style={{
        marginTop: 6, fontSize: 11.5, color: "var(--fg-muted)",
        letterSpacing: "0.02em",
      }}>{sub}</div>
    </div>
  );
}

function LegendSwatch({ color, label, ring }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 10.5, color: "var(--fg-subtle)",
      letterSpacing: "0.08em", textTransform: "uppercase",
    }}>
      <span style={{
        width: 10, height: 10,
        background: ring ? "transparent" : color,
        border: ring ? `1px dashed ${color}` : "none",
        borderRadius: "2px 6px 2px 6px",
      }}/>
      {label}
    </span>
  );
}

function SwimLanes({ commanders, events, zoom }) {
  const widthPx = 1100; // virtual lane width
  const pxPerMin = widthPx / zoom;

  // Ticks
  const ticks = [];
  for (let m = 0; m <= zoom; m += Math.max(1, Math.floor(zoom / 6))) ticks.push(m);

  return (
    <div>
      {/* Ticks / header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 16,
        padding: "0 0 8px",
        borderBottom: "1px solid var(--border-hair)",
        marginBottom: 8,
      }}>
        <div/>
        <div style={{ position: "relative", height: 22 }}>
          {ticks.map(t => {
            const left = widthPx - t * pxPerMin;
            return (
              <div key={t} style={{
                position: "absolute", left: left - 20, width: 40,
                textAlign: "center",
                fontSize: 10, color: "var(--fg-faint)",
                letterSpacing: "0.08em", textTransform: "uppercase",
              }}>
                {t === 0 ? "now" : `${t}m`}
              </div>
            );
          })}
        </div>
      </div>

      {commanders.map(c => (
        <SwimLane key={c.id} commander={c}
                  events={events.filter(e => e.commanderId === c.id)}
                  zoom={zoom} pxPerMin={pxPerMin} widthPx={widthPx}/>
      ))}
    </div>
  );
}

function SwimLane({ commander, events, zoom, pxPerMin, widthPx }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "180px 1fr",
      gap: 16,
      padding: "12px 0",
      borderBottom: "1px solid var(--border-hair)",
    }}>
      {/* Left — commander */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AgentAvatar commander={commander} size={32} active/>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, color: "var(--fg)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {commander.name}
          </div>
          <div style={{
            fontSize: 10.5, letterSpacing: "0.08em",
            color: "var(--fg-subtle)",
            display: "flex", alignItems: "center", gap: 6, marginTop: 2,
          }}>
            <StatusDot state={commander.status} pulse={commander.status === "connected"}/>
            <span>{commander.status}</span>
          </div>
        </div>
      </div>

      {/* Right — timeline */}
      <div style={{ position: "relative", height: 38, overflow: "hidden" }}>
        {/* grid lines */}
        {Array.from({ length: Math.floor(zoom / 5) + 1 }).map((_, i) => {
          const m = i * 5;
          const left = widthPx - m * pxPerMin;
          return (
            <div key={i} style={{
              position: "absolute", left, top: 0, bottom: 0, width: 1,
              background: "var(--border-hair)",
            }}/>
          );
        })}

        {/* events */}
        {events.map((e, i) => {
          // start is minutes-ago (where it STARTED). dur is length.
          // x = widthPx - start * pxPerMin (right side)
          // bar extends from (start-dur) ago to start ago.
          const rightEdge = widthPx - (e.start - e.dur) * pxPerMin;
          const leftEdge  = widthPx - e.start * pxPerMin;
          // Actually: earlier (more ago) = further left. e.start is how many min ago it started.
          // That means if start=29 dur=2, it ran from 29min ago to 27min ago.
          // left = widthPx - 29*pxPerMin; right = widthPx - 27*pxPerMin
          const L = widthPx - e.start * pxPerMin;
          const W = e.dur * pxPerMin;
          if (L + W < 0 || L > widthPx) return null;

          const color = {
            worker:  "var(--moss-stone)",
            tool:    "var(--diluted-ink)",
            blocked: "var(--vermillion-seal)",
            idle:    "transparent",
          }[e.kind] || "var(--diluted-ink)";

          const isIdle = e.kind === "idle";

          return (
            <div key={i}
                 title={`${e.label} · ${e.dur}m`}
                 style={{
                   position: "absolute", left: Math.max(0, L),
                   width: Math.min(W, widthPx - Math.max(0, L)),
                   top: 8, height: 22,
                   background: isIdle ? "transparent" : color,
                   border: isIdle ? "1px dashed var(--border-soft)" : "none",
                   borderRadius: "1px 6px 1px 6px",
                   padding: "0 6px",
                   color: isIdle ? "var(--fg-faint)" : "var(--washi-white)",
                   display: "flex", alignItems: "center",
                   fontSize: 10.5,
                   letterSpacing: "0.02em",
                   overflow: "hidden", whiteSpace: "nowrap",
                   boxShadow: e.kind === "blocked" ? "0 0 0 1.5px rgba(194,59,34,0.25)" : "none",
                   animation: (e.start - e.dur) < 1 && !isIdle ? "hvPulse 2.4s var(--ease-gentle) infinite" : "none",
                 }}>
              {W > 40 && (
                <span style={{
                  textOverflow: "ellipsis", overflow: "hidden",
                  fontFamily: e.kind === "tool" ? "var(--font-mono)" : "var(--font-body)",
                  fontSize: e.kind === "tool" ? 10 : 10.5,
                  fontWeight: e.kind === "tool" ? 400 : 500,
                }}>{e.label}</span>
              )}
            </div>
          );
        })}

        {/* "now" edge */}
        <div style={{
          position: "absolute", right: 0, top: -4, bottom: -4, width: 2,
          background: "var(--vermillion-seal)", opacity: 0.35,
        }}/>
      </div>
    </div>
  );
}

Object.assign(window, { Fleet });
