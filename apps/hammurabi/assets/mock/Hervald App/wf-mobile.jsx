// MOBILE — session navigation + team/workspace on phone
// Phones presented inside sketchy device frames.

function Phone({ children, label, tag }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{
        width: 260, height: 520,
        border: "2px solid var(--sumi-black)",
        borderRadius: "28px 36px 28px 36px",
        padding: 8, background: "var(--sumi-black)",
        filter: "url(#rough)",
        boxShadow: "0 6px 20px rgba(28,28,28,0.08)",
      }}>
        <div style={{
          width: "100%", height: "100%",
          background: "var(--washi-white)",
          borderRadius: "22px 30px 22px 30px",
          overflow: "hidden", position: "relative",
          fontFamily: "var(--font-body)",
        }}>
          {/* notch */}
          <div style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", width: 60, height: 5, background: "var(--sumi-black)", borderRadius: 4, opacity: 0.7 }}/>
          <div style={{ padding: "22px 14px 14px", height: "100%", display: "flex", flexDirection: "column" }}>
            {children}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-primary)", fontSize: 20, fontStyle: "italic", lineHeight: 1.1 }}>{label}</div>
        {tag && <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--fg-subtle)", fontStyle: "italic", marginTop: 2 }}>{tag}</div>}
      </div>
    </div>
  );
}

// ============================================================
// A · Sessions list → tap to enter
// ============================================================
function MobileA() {
  return (
    <Phone label="A · List → chat" tag="Home screen = all sessions">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <Scribble size={18}>sessions</Scribble>
        <Scribble size={13} color="var(--fg-subtle)">+</Scribble>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {["all","cmd","sub"].map((t,i) => (
          <span key={t} style={{
            fontFamily: "'Caveat',cursive", fontSize: 13,
            padding: "2px 9px", borderRadius: "2px 8px 2px 8px",
            background: i===0?"var(--sumi-black)":"transparent",
            color: i===0?"var(--washi-white)":"var(--fg-muted)",
            border: i===0?"none":"1px solid var(--border-soft)",
          }}>{t}</span>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
        {[
          {n:"athena", s:"running", t:"9h"},
          {n:"jarvis", s:"waiting", t:"7h", p:2},
          {n:"jake",   s:"running", t:"6h"},
          {n:"pm-920", s:"idle",    t:"2d"},
        ].map(r => (
          <div key={r.n} style={{ padding: "8px 10px", border: "1px solid var(--border-soft)", borderRadius: "3px 10px 3px 10px", filter: "url(#rough)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <StatusDot kind={r.s} size={6}/>
                <Scribble size={14}>{r.n}</Scribble>
              </div>
              {r.p > 0 && <Scribble size={11} color="var(--vermillion-seal)">{r.p} pend</Scribble>}
            </div>
            <Scribble size={10} color="var(--diluted-ink)" italic>{r.t} ago · effort max</Scribble>
          </div>
        ))}
      </div>
    </Phone>
  );
}

// ============================================================
// B · Swipe deck (novel)
// ============================================================
function MobileB() {
  return (
    <Phone label="B · Swipe deck" tag="Left/right between active sessions">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Scribble size={12} color="var(--diluted-ink)">‹ athena</Scribble>
        <Scribble size={16}>jarvis</Scribble>
        <Scribble size={12} color="var(--diluted-ink)">jake ›</Scribble>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 10 }}>
        {[0,1,2].map(i => (
          <span key={i} style={{ width: i===1?16:5, height: 5, borderRadius: 3, background: i===1?"var(--sumi-black)":"var(--ink-mist)" }}/>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ alignSelf: "flex-start", maxWidth: "85%", background: "var(--aged-paper)", padding: "7px 10px", borderRadius: "3px 11px 3px 11px" }}>
          <Scribble size={12}>Report republished.</Scribble>
        </div>
        <div style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--sumi-black)", color: "var(--washi-white)", padding: "7px 10px", borderRadius: "11px 3px 11px 3px" }}>
          <Scribble size={12} color="var(--washi-white)">pick up next quest</Scribble>
        </div>
        <div style={{ alignSelf: "flex-start", maxWidth: "85%", background: "var(--aged-paper)", padding: "7px 10px", borderRadius: "3px 11px 3px 11px" }}>
          <Scribble size={12}>Board clear. What's next?</Scribble>
        </div>
      </div>
      <div style={{ marginTop: 6, padding: "6px 10px", border: "1px solid var(--border-soft)", borderRadius: "3px 10px 3px 10px" }}>
        <Scribble size={12} color="var(--diluted-ink)" italic>Send…</Scribble>
      </div>
    </Phone>
  );
}

// ============================================================
// C · Bottom dock with live dots
// ============================================================
function MobileC() {
  return (
    <Phone label="C · Bottom dock" tag="Avatars always visible">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Scribble size={12} color="var(--fg-subtle)">‹</Scribble>
        <Scribble size={16}>jarvis</Scribble>
        <Scribble size={12} color="var(--fg-subtle)">⋮</Scribble>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
        {[55, 90, 70, 45, 60].map((w,i) => (
          <div key={i} style={{ height: 9, width: `${w}%`, background: "rgba(28,28,28,0.06)", borderRadius: 2, alignSelf: i%2?"flex-end":"flex-start" }}/>
        ))}
      </div>
      <div style={{
        marginTop: 6, display: "flex", justifyContent: "space-around",
        padding: "8px 6px", borderTop: "1px dashed var(--border-soft)",
      }}>
        {[
          {n:"a", s:"running"},
          {n:"j", s:"waiting", active: true, pending: 2},
          {n:"k", s:"running"},
          {n:"p", s:"idle"},
          {n:"+", s:null},
        ].map((r,i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, position: "relative" }}>
            <div style={{
              width: 26, height: 26, borderRadius: "50%",
              border: `1.5px solid ${r.active?"var(--sumi-black)":"var(--border-soft)"}`,
              background: r.active?"rgba(28,28,28,0.05)":"transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              filter: "url(#rough)",
            }}>
              <Scribble size={13}>{r.n}</Scribble>
            </div>
            {r.s && <StatusDot kind={r.s} size={5}/>}
            {r.pending > 0 && <span style={{
              position: "absolute", top: -3, right: -3,
              width: 14, height: 14, borderRadius: "50%",
              background: "var(--vermillion-seal)",
              color: "var(--washi-white)", fontSize: 9,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{r.pending}</span>}
          </div>
        ))}
      </div>
    </Phone>
  );
}

// ============================================================
// D · Pull-down team drawer
// ============================================================
function MobileD() {
  return (
    <Phone label="D · Pull team down" tag="Team org peeks from the top">
      <div style={{
        margin: "-4px -14px 8px", padding: "8px 14px 10px",
        background: "var(--aged-paper)",
        borderBottom: "1.5px dashed var(--border-soft)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <Whisper style={{ fontSize: 8 }}>jarvis' team · 3</Whisper>
          <Scribble size={11} color="var(--diluted-ink)">↓</Scribble>
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {[{n:"res",s:"running"},{n:"wri",s:"waiting",p:2},{n:"cri",s:"idle"}].map(x => (
            <div key={x.n} style={{ flex: 1, padding: "4px 4px", border: "1px solid var(--border-soft)", borderRadius: "2px 8px 2px 8px", textAlign: "center", background: "var(--washi-white)" }}>
              <StatusDot kind={x.s} size={5}/>
              <div><Scribble size={10}>{x.n}</Scribble></div>
              {x.p && <Scribble size={9} color="var(--vermillion-seal)">{x.p}</Scribble>}
            </div>
          ))}
        </div>
      </div>
      <Scribble size={14}>jarvis</Scribble>
      <div style={{ flex: 1, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {[55, 80, 60, 40].map((w,i) => (
          <div key={i} style={{ height: 8, width: `${w}%`, background: "rgba(28,28,28,0.06)", borderRadius: 2 }}/>
        ))}
      </div>
      <div style={{ padding: "5px 8px", border: "1px solid var(--border-soft)", borderRadius: "3px 9px 3px 9px", marginTop: 6 }}>
        <Scribble size={11} color="var(--diluted-ink)" italic>Send…</Scribble>
      </div>
    </Phone>
  );
}

// ============================================================
// E · Approvals-first (monitoring mode)
// ============================================================
function MobileE() {
  return (
    <Phone label="E · Approvals first" tag="For on-the-go governance">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <Scribble size={18}>inbox</Scribble>
        <Scribble size={11} color="var(--vermillion-seal)">3 pend</Scribble>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
        {[
          {from:"writer", parent:"jarvis", msg:"Draft v2 ready — review tone?", kind:"review"},
          {from:"editor", parent:"writer", msg:"apply_patch exit 1 — retry?", kind:"failed"},
          {from:"fetcher", parent:"researcher", msg:"Approve bash: curl bloomberg?", kind:"permission"},
        ].map((r,i) => (
          <div key={i} style={{
            padding: "8px 10px",
            border: `1px solid ${r.kind==="failed"?"var(--vermillion-seal)":"var(--border-soft)"}`,
            borderLeft: `3px solid ${r.kind==="failed"?"var(--vermillion-seal)":r.kind==="permission"?"var(--persimmon)":"var(--sumi-black)"}`,
            borderRadius: "2px 10px 2px 10px",
            filter: "url(#rough)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Scribble size={13}>{r.from}</Scribble>
              <Scribble size={9} color="var(--diluted-ink)">↳ {r.parent}</Scribble>
            </div>
            <Scribble size={11} color="var(--fg-muted)" italic style={{ display: "block", marginTop: 2 }}>{r.msg}</Scribble>
            <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
              <span style={{ fontFamily: "'Caveat',cursive", fontSize: 11, padding: "1px 7px", background: "var(--sumi-black)", color: "var(--washi-white)", borderRadius: "2px 7px 2px 7px" }}>approve</span>
              <span style={{ fontFamily: "'Caveat',cursive", fontSize: 11, padding: "1px 7px", border: "1px solid var(--border-firm)", borderRadius: "2px 7px 2px 7px", color: "var(--fg-muted)" }}>open</span>
            </div>
          </div>
        ))}
      </div>
    </Phone>
  );
}

// ============================================================
// NORTH STAR (Mobile): two phones — sessions + chat w/ team peek
// ============================================================
function MobileNorthStar() {
  return (
    <NorthStarFrame label="north star · mobile">
      <VariantLabel letter="★" name="Two screens: sessions ⇄ chat with peekable team" tagline="Primary flow is monitoring + approvals. Swipe between sessions inside chat; pull-down reveals team; bottom intent bar pulls in approvals fastest." />
      <div style={{ display: "flex", gap: 56, justifyContent: "center", flexWrap: "wrap", marginTop: 20 }}>
        {/* Phone 1 — sessions list */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ width: 280, height: 560, border: "10px solid var(--sumi-black)", borderRadius: 42, background: "var(--washi-white)", overflow: "hidden", position: "relative", boxShadow: "0 20px 48px rgba(28,28,28,0.12)" }}>
            <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 80, height: 22, background: "var(--sumi-black)", borderRadius: 14 }}/>
            <div style={{ padding: "44px 18px 18px", fontFamily: "var(--font-body)", height: "100%", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <span className="whisper" style={{ fontSize: 9 }}>hervald</span>
                  <h2 style={{ fontFamily: "var(--font-primary)", fontWeight: 300, fontSize: 26, margin: "4px 0 0" }}>Sessions</h2>
                </div>
                <span style={{ fontFamily: "var(--font-primary)", fontSize: 22, color: "var(--fg-muted)", fontStyle: "italic" }}>+</span>
              </div>
              <div style={{ display: "flex", gap: 6, margin: "14px 0 16px" }}>
                {["All","Cmd","Sub"].map((t,i) => (
                  <span key={t} style={{
                    fontSize: 11, letterSpacing: "0.04em",
                    padding: "4px 10px", borderRadius: "2px 8px 2px 8px",
                    background: i===0?"var(--sumi-black)":"transparent",
                    color: i===0?"var(--washi-white)":"var(--fg-muted)",
                    border: i===0?"none":"1px solid var(--border-hair)",
                  }}>{t}</span>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                {[
                  {n:"athena", s:"running", t:"9h · 3 sub", p:0, bg:"var(--washi-white)"},
                  {n:"jarvis", s:"waiting", t:"7h · 3 sub", p:2, bg:"var(--washi-white)", active:true},
                  {n:"jake",   s:"running", t:"6h",        p:0, bg:"var(--washi-white)"},
                  {n:"pm-920", s:"idle",    t:"2d · stale",p:0, bg:"var(--washi-white)", faint: true},
                ].map(r => (
                  <div key={r.n} style={{
                    padding: "12px 14px",
                    background: r.bg,
                    border: "1px solid var(--border-hair)",
                    borderLeft: r.active ? "2px solid var(--sumi-black)" : "1px solid var(--border-hair)",
                    borderRadius: "2px 14px 2px 14px",
                    opacity: r.faint ? 0.7 : 1,
                    boxShadow: r.active ? "0 4px 10px rgba(28,28,28,0.04)" : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: r.s==="running"?"var(--moss-stone)":r.s==="waiting"?"var(--persimmon)":"var(--stone-gray)",
                          boxShadow: r.s==="waiting"?"0 0 0 3px rgba(212,118,58,0.18)":r.s==="running"?"0 0 0 3px rgba(107,123,94,0.15)":"none",
                        }}/>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{r.n}</span>
                      </div>
                      {r.p > 0 && <span style={{ fontSize: 9, color: "var(--vermillion-seal)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{r.p} pend</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--fg-subtle)", marginTop: 3, letterSpacing: "0.08em", textTransform: "uppercase" }}>{r.t}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, textAlign: "center", paddingTop: 10, borderTop: "1px solid var(--border-hair)" }}>
                <span className="whisper" style={{ fontSize: 9 }}>3 pend · queue clear</span>
              </div>
            </div>
          </div>
          <div style={{ fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 18 }}>Sessions</div>
        </div>

        {/* Phone 2 — chat w/ team peek + swipe */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ width: 280, height: 560, border: "10px solid var(--sumi-black)", borderRadius: 42, background: "var(--washi-white)", overflow: "hidden", position: "relative", boxShadow: "0 20px 48px rgba(28,28,28,0.12)" }}>
            <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 80, height: 22, background: "var(--sumi-black)", borderRadius: 14 }}/>
            <div style={{ padding: "44px 0 0", fontFamily: "var(--font-body)", height: "100%", display: "flex", flexDirection: "column" }}>
              {/* Header with swipe indicator */}
              <div style={{ padding: "0 16px 10px", borderBottom: "1px solid var(--border-hair)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, color: "var(--fg-subtle)" }}>‹ athena</span>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>jarvis</div>
                    <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 3 }}>
                      {[0,1,2].map(i => (
                        <span key={i} style={{ width: i===1?14:4, height: 4, borderRadius: 3, background: i===1?"var(--sumi-black)":"var(--ink-mist)" }}/>
                      ))}
                    </div>
                  </div>
                  <span style={{ fontSize: 14, color: "var(--fg-subtle)" }}>jake ›</span>
                </div>
              </div>

              {/* Collapsed team peek */}
              <div style={{ padding: "8px 16px", background: "var(--aged-paper)", borderBottom: "1px solid var(--border-hair)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="whisper" style={{ fontSize: 9 }}>team · 3</span>
                  <span style={{ fontSize: 9, color: "var(--fg-faint)", letterSpacing: "0.12em", textTransform: "uppercase" }}>pull to expand ⌄</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  {[
                    {n:"researcher", s:"running"},
                    {n:"writer", s:"waiting", p: 2},
                    {n:"critic", s:"idle"},
                  ].map(x => (
                    <div key={x.n} style={{ flex: 1, padding: "5px 6px", background: "var(--washi-white)", border: "1px solid var(--border-hair)", borderRadius: "2px 8px 2px 8px", textAlign: "center", position: "relative" }}>
                      <span style={{
                        width: 5, height: 5, borderRadius: "50%", display: "inline-block",
                        background: x.s==="running"?"var(--moss-stone)":x.s==="waiting"?"var(--persimmon)":"var(--stone-gray)",
                      }}/>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.n}</div>
                      {x.p && <span style={{ position: "absolute", top: -4, right: -4, background: "var(--vermillion-seal)", color: "var(--washi-white)", fontSize: 8, width: 13, height: 13, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>{x.p}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Transcript */}
              <div style={{ flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
                <div style={{ alignSelf: "flex-start", maxWidth: "82%", background: "var(--aged-paper)", padding: "8px 11px", borderRadius: "3px 12px 3px 12px" }}>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.5 }}>Report republished.</p>
                </div>
                <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: "var(--sumi-black)", color: "var(--washi-white)", padding: "8px 11px", borderRadius: "12px 3px 12px 3px" }}>
                  <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>Pick up next quest.</p>
                </div>
                <div style={{ alignSelf: "flex-start", maxWidth: "82%", background: "var(--aged-paper)", padding: "8px 11px", borderRadius: "3px 12px 3px 12px" }}>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.5 }}>Board clear. What's on your mind?</p>
                </div>
                {/* Approval banner */}
                <div style={{ padding: "8px 10px", border: "1px solid var(--persimmon)", borderLeft: "3px solid var(--persimmon)", borderRadius: "2px 10px 2px 10px", background: "rgba(212,118,58,0.04)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>writer</span>
                    <span style={{ fontSize: 8, color: "var(--persimmon)", letterSpacing: "0.12em", textTransform: "uppercase" }}>2 approvals</span>
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--fg-muted)", fontStyle: "italic" }}>Review Q3 draft tone?</p>
                </div>
              </div>

              {/* Composer */}
              <div style={{ padding: "8px 12px 14px", borderTop: "1px solid var(--border-hair)" }}>
                <div style={{ padding: "8px 10px", border: "1px solid var(--border-hair)", borderRadius: "3px 12px 3px 12px", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "var(--fg-subtle)", fontStyle: "italic" }}>Send…</span>
                  <span style={{ fontSize: 9, color: "var(--fg-faint)" }}>@ file</span>
                </div>
              </div>
            </div>
          </div>
          <div style={{ fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 18 }}>Chat + team peek</div>
        </div>
      </div>

      <div style={{ marginTop: 28, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-muted)", fontStyle: "italic", lineHeight: 1.7, maxWidth: 720, marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
        Mobile leans monitoring-first. Swipe between sessions; pull down for team; approval cards inline with the transcript so governance action is one tap away.
      </div>
    </NorthStarFrame>
  );
}

function MobileSurface() {
  return (
    <div>
      <SurfaceHeading
        count="04"
        title="Mobile"
        subtitle={`Phones are where you watch and approve, not where you deeply chat. Five nav patterns + a polished pairing.`}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 48, justifyItems: "center" }}>
        <MobileA /><MobileB /><MobileC /><MobileD /><MobileE />
      </div>
      <div style={{ height: 80 }}/>
      <MobileNorthStar />
    </div>
  );
}

Object.assign(window, { MobileSurface });
