// Shared sketchy primitives for all wireframes
// ------------------------------------------------------------------
// Hand-drawn look uses a SVG turbulence filter + Caveat/Cormorant for labels.
// Mid-fi polished uses clean Hervald tokens.

const { useState, useRef, useEffect } = React;

// ---- SVG rough filter (paste once, referenced everywhere) -------
function RoughDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <filter id="rough" x="-2%" y="-2%" width="104%" height="104%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="1.4" />
        </filter>
        <filter id="rough-hard" x="-2%" y="-2%" width="104%" height="104%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="2.2" />
        </filter>
        <filter id="paper" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" />
          <feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.11  0 0 0 0 0.10  0 0 0 0.04 0"/>
          <feComposite in2="SourceGraphic" operator="in"/>
        </filter>
      </defs>
    </svg>
  );
}

// ---- HandBox: sketchy rectangle container -----------------------
function HandBox({ children, style = {}, filled = false, accent = false, dashed = false, ...rest }) {
  return (
    <div
      style={{
        border: `1.5px ${dashed ? "dashed" : "solid"} ${accent ? "var(--vermillion-seal)" : "var(--sumi-black)"}`,
        background: filled ? "rgba(28,28,28,0.04)" : "transparent",
        borderRadius: "3px 11px 2px 9px",
        padding: "10px 14px",
        filter: "url(#rough)",
        position: "relative",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// HandBox where the filter is only on the border, not content (better for text readability)
function SketchFrame({ children, style = {}, filled = false, accent = false, dashed = false, radius = "3px 11px 2px 9px" }) {
  return (
    <div style={{ position: "relative", ...style }}>
      <div style={{
        position: "absolute", inset: 0,
        border: `1.5px ${dashed ? "dashed" : "solid"} ${accent ? "var(--vermillion-seal)" : "var(--sumi-black)"}`,
        background: filled ? "rgba(28,28,28,0.04)" : "transparent",
        borderRadius: radius,
        filter: "url(#rough)",
        pointerEvents: "none",
      }}/>
      <div style={{ position: "relative", padding: "10px 14px" }}>{children}</div>
    </div>
  );
}

// ---- Hand label: written font ----------------------------------
function Scribble({ children, size = 16, style = {}, italic = false, color }) {
  return (
    <span style={{
      fontFamily: "'Caveat', 'Gloria Hallelujah', cursive",
      fontSize: size,
      fontStyle: italic ? "italic" : "normal",
      color: color || "var(--sumi-black)",
      lineHeight: 1.15,
      letterSpacing: "0.01em",
      ...style,
    }}>{children}</span>
  );
}

// ---- Tiny annotation (whisper style) ---------------------------
function Whisper({ children, style = {} }) {
  return (
    <span style={{
      fontFamily: "var(--font-body)",
      fontSize: 10,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "var(--fg-subtle)",
      ...style,
    }}>{children}</span>
  );
}

// ---- Status dot ------------------------------------------------
function StatusDot({ kind = "running", size = 8, label }) {
  const colors = {
    running: "var(--moss-stone)",
    idle: "var(--stone-gray)",
    waiting: "var(--persimmon)",
    failed: "var(--vermillion-seal)",
    done: "var(--brushed-gray)",
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: size, height: size, borderRadius: "50%",
        background: colors[kind],
        boxShadow: kind === "running" ? `0 0 0 3px ${colors[kind]}22` : "none",
        display: "inline-block",
      }}/>
      {label && <Whisper>{label}</Whisper>}
    </span>
  );
}

// ---- Sketchy arrow ---------------------------------------------
function Arrow({ from, to, curve = 0, dashed = false, accent = false, label, labelOffset = 0, labelSize = 14 }) {
  const [x1, y1] = from, [x2, y2] = to;
  const mx = (x1 + x2) / 2 + curve;
  const my = (y1 + y2) / 2 + curve * 0.6;
  const color = accent ? "var(--vermillion-seal)" : "var(--sumi-black)";
  return (
    <>
      <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
        <path
          d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
          fill="none" stroke={color} strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={dashed ? "4 4" : "none"}
          filter="url(#rough-hard)"
        />
        {/* arrowhead */}
        <g transform={`translate(${x2} ${y2}) rotate(${Math.atan2(y2 - my, x2 - mx) * 180 / Math.PI})`}>
          <path d="M 0 0 L -8 -4 M 0 0 L -8 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" filter="url(#rough-hard)" />
        </g>
      </svg>
      {label && (
        <Scribble size={labelSize} italic color={color} style={{
          position: "absolute",
          left: mx + labelOffset, top: my - 10,
          background: "var(--washi-white)", padding: "0 6px",
        }}>{label}</Scribble>
      )}
    </>
  );
}

// ---- Squiggle (thinking / connector line) ----------------------
function Squiggle({ width = 60, style = {}, color }) {
  return (
    <svg width={width} height="12" style={{ display: "inline-block", ...style }}>
      <path
        d={`M 0 6 Q ${width*0.15} 0 ${width*0.3} 6 T ${width*0.6} 6 T ${width*0.9} 6`}
        fill="none" stroke={color || "var(--diluted-ink)"} strokeWidth="1.2"
        strokeLinecap="round" filter="url(#rough)"
      />
    </svg>
  );
}

// ---- Sketchy button ---------------------------------------------
function SketchBtn({ children, filled = false, accent = false, style = {}, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: "'Caveat', cursive",
      fontSize: 17,
      background: filled ? "var(--sumi-black)" : "transparent",
      color: filled ? "var(--washi-white)" : (accent ? "var(--vermillion-seal)" : "var(--sumi-black)"),
      border: `1.5px solid ${accent ? "var(--vermillion-seal)" : "var(--sumi-black)"}`,
      borderRadius: "2px 10px 2px 10px",
      padding: "5px 14px",
      cursor: "pointer",
      filter: "url(#rough)",
      ...style,
    }}>{children}</button>
  );
}

// ---- Variant label (corner tag on each wireframe cell) ---------
function VariantLabel({ letter, name, tagline }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 20 }}>
      <span style={{
        fontFamily: "var(--font-primary)", fontSize: 40, fontWeight: 300,
        fontStyle: "italic", color: "var(--sumi-black)", lineHeight: 1,
      }}>{letter}</span>
      <div>
        <div style={{ fontFamily: "var(--font-primary)", fontSize: 22, fontWeight: 400, color: "var(--sumi-black)", lineHeight: 1.2 }}>{name}</div>
        {tagline && <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 2 }}>{tagline}</div>}
      </div>
    </div>
  );
}

// ---- Surface heading -------------------------------------------
function SurfaceHeading({ title, subtitle, count }) {
  return (
    <div style={{ marginBottom: 48, paddingBottom: 32, borderBottom: "1px solid var(--border-hair)" }}>
      <Whisper style={{ color: "var(--fg-faint)" }}>
        {count} · exploration
      </Whisper>
      <h1 style={{
        fontFamily: "var(--font-primary)", fontSize: 52, fontWeight: 300,
        margin: "12px 0 10px", letterSpacing: "-0.02em", lineHeight: 1.05,
      }}>{title}</h1>
      <p style={{
        fontFamily: "var(--font-body)", fontSize: 16, fontStyle: "italic",
        color: "var(--fg-muted)", margin: 0, maxWidth: 640, lineHeight: 1.6,
      }}>{subtitle}</p>
    </div>
  );
}

// ---- Polished north-star frame ---------------------------------
function NorthStarFrame({ children, label = "north star", style = {} }) {
  return (
    <div style={{ position: "relative", ...style }}>
      <div style={{
        position: "absolute", top: -14, left: 32,
        background: "var(--sumi-black)", color: "var(--washi-white)",
        fontFamily: "var(--font-body)", fontSize: 10, letterSpacing: "0.16em",
        textTransform: "uppercase", padding: "5px 12px",
        borderRadius: "2px 8px 2px 8px", zIndex: 2,
      }}>{label}</div>
      <div style={{
        background: "linear-gradient(165deg, #FAF8F5 0%, #F0EBE3 100%)",
        border: "1px solid var(--border-hair)",
        borderRadius: "4px 20px 4px 20px",
        padding: 32,
        boxShadow: "0 2px 4px rgba(28,28,28,0.02), 0 20px 60px rgba(28,28,28,0.04)",
      }}>
        {children}
      </div>
    </div>
  );
}

// ---- Variant grid ----------------------------------------------
function VariantGrid({ children, cols = 2, gap = 48 }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap,
    }}>{children}</div>
  );
}

// ---- Tiny agent avatar/glyph -----------------------------------
// uses first letter in hand font, in a small hand-drawn circle
function AgentGlyph({ name, size = 28, role = "cmd", accent = false }) {
  const initial = (name || "?")[0].toUpperCase();
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, borderRadius: "50%",
      border: `1.4px solid ${accent ? "var(--vermillion-seal)" : (role === "cmd" ? "var(--sumi-black)" : "var(--brushed-gray)")}`,
      fontFamily: "'Caveat', cursive", fontSize: size * 0.6,
      color: accent ? "var(--vermillion-seal)" : (role === "cmd" ? "var(--sumi-black)" : "var(--brushed-gray)"),
      filter: "url(#rough)",
      flexShrink: 0,
      background: "var(--washi-white)",
    }}>{initial}</span>
  );
}

Object.assign(window, {
  RoughDefs, HandBox, SketchFrame, Scribble, Whisper, StatusDot,
  Arrow, Squiggle, SketchBtn, VariantLabel, SurfaceHeading,
  NorthStarFrame, VariantGrid, AgentGlyph,
});
