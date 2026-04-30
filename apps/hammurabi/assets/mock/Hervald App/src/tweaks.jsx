// ============================================================
// Hervald — Tweaks panel (floating, bottom-right).
// ============================================================

function TweaksPanel({ state, set, open, onClose }) {
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 40,
      width: 280,
      background: "var(--washi-white)",
      border: "1px solid var(--border-soft)",
      borderRadius: "4px 18px 4px 18px",
      boxShadow: "var(--shadow-float)",
      padding: 16,
      animation: "hvFadeIn 0.3s var(--ease-gentle) both",
      fontFamily: "var(--font-body)",
    }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <span style={{
          fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "var(--fg-subtle)",
        }}>Tweaks</span>
        <span style={{ flex: 1 }}/>
        <button onClick={onClose} style={{
          background: "transparent", border: "none", color: "var(--fg-subtle)",
          cursor: "pointer", padding: 0, display: "flex",
        }}><Icon name="close" size={14}/></button>
      </div>

      <TweakRow label="Session theme">
        <Seg options={[["light","Light"],["dark","Dark"]]} value={state.theme} onChange={v => set({ theme: v })}/>
      </TweakRow>
      <TweakRow label="Chat density">
        <Seg options={[["comfortable","Comfortable"],["compact","Compact"]]} value={state.density} onChange={v => set({ density: v })}/>
      </TweakRow>
      <TweakRow label="Fleet window">
        <Seg options={[["5","5m"],["15","15m"],["30","30m"],["60","60m"]]} value={String(state.fleetWindow)} onChange={v => set({ fleetWindow: Number(v) })}/>
      </TweakRow>
      <TweakRow label="Activity">
        <Seg options={[["quiet","Quiet"],["normal","Normal"],["busy","Busy"]]} value={state.activity} onChange={v => set({ activity: v })}/>
      </TweakRow>

      <div style={{
        marginTop: 12, paddingTop: 12,
        borderTop: "1px solid var(--border-hair)",
        fontSize: 11, color: "var(--fg-faint)", lineHeight: 1.55,
      }}>
        Surface-only. Data lives in <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>window.HV_DATA</code> — the agent replaces it to wire real sources.
      </div>
    </div>
  );
}

function TweakRow({ label, children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      margin: "8px 0",
    }}>
      <span style={{
        flex: 1, fontSize: 12, color: "var(--fg-muted)",
      }}>{label}</span>
      {children}
    </div>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div style={{
      display: "flex", gap: 2,
      background: "var(--ink-wash-02)",
      border: "1px solid var(--border-hair)",
      borderRadius: "2px 8px 2px 8px",
      padding: 2,
    }}>
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} style={{
          padding: "4px 9px",
          fontSize: 10.5, letterSpacing: "0.02em",
          background: value === v ? "var(--washi-white)" : "transparent",
          color: value === v ? "var(--fg)" : "var(--fg-subtle)",
          border: "none", cursor: "pointer",
          borderRadius: "2px 6px 2px 6px",
          boxShadow: value === v ? "var(--shadow-whisper)" : "none",
          fontFamily: "var(--font-body)",
        }}>{l}</button>
      ))}
    </div>
  );
}

function TweakFab({ onClick }) {
  return (
    <button onClick={onClick} style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 39,
      width: 44, height: 44,
      background: "var(--sumi-black)", color: "var(--washi-white)",
      border: "none", cursor: "pointer",
      borderRadius: "50%",
      boxShadow: "var(--shadow-lift)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 18,
    }} title="Tweaks">
      <Icon name="settings" size={17}/>
    </button>
  );
}

Object.assign(window, { TweaksPanel, TweakFab });
