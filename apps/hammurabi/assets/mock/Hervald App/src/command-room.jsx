// ============================================================
// Hervald — Command Room (rebuilt to match the North Star design)
// Three columns: Sessions list · Chat + tabs · Team panel
// ============================================================

function CommandRoom({ onOpenWorkspace }) {
  const { commanders, transcript, workers, approvals } = window.HV_DATA;
  const [selectedId, setSelectedId] = React.useState(() =>
    localStorage.getItem("hv-selected-commander") || "jarvis");
  React.useEffect(() => { localStorage.setItem("hv-selected-commander", selectedId); }, [selectedId]);

  const commander = commanders.find(c => c.id === selectedId) || commanders[0];
  const myWorkers = workers.filter(w => w.commanderId === commander.id);
  const myApprovals = approvals.filter(a => a.commanderId === commander.id);
  const [selectedWorkerId, setSelectedWorkerId] = React.useState(myWorkers[0]?.id);

  React.useEffect(() => { setSelectedWorkerId(myWorkers[0]?.id); }, [commander.id]);

  const [activeTab, setActiveTab] = React.useState("chat");
  const selectedWorker = myWorkers.find(w => w.id === selectedWorkerId) || myWorkers[0];

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto" }} className="hv-scroll">
      <div style={{
        display: "grid",
        gridTemplateColumns: "232px 1fr 260px",
        minWidth: 1100,
        height: "100%",
      }}>
        <SessionsColumn
          commanders={commanders}
          selectedId={selectedId}
          onSelect={setSelectedId}
          workers={workers}
          approvals={approvals}
        />
        <CenterColumn
          commander={commander}
          transcript={transcript}
          workers={myWorkers}
          approvals={myApprovals}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenWorkspace={onOpenWorkspace}
        />
        <TeamColumn
          commander={commander}
          workers={myWorkers}
          approvals={myApprovals}
          selectedWorkerId={selectedWorkerId}
          setSelectedWorkerId={setSelectedWorkerId}
          selectedWorker={selectedWorker}
          onOpenWorkspace={onOpenWorkspace}
        />
      </div>
    </div>
  );
}

// ============================================================
// LEFT · SESSIONS column
// ============================================================
function SessionsColumn({ commanders, selectedId, onSelect, workers, approvals }) {
  // Split into live + stale for the grouped list
  const live  = commanders.filter(c => c.status !== "offline");
  const stale = [
    { id: "pn-920",      name: "pn-920",      age: "2d" },
    { id: "srswworker",  name: "srswworker",  age: "1d" },
    { id: "wop81",       name: "wop81",       age: "1d" },
  ];

  return (
    <aside style={{
      background: "var(--washi-white)",
      borderRight: "1px solid var(--border-hair)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <ColumnHeader
        left={<>SESSIONS <span style={{ color: "var(--fg-faint)", marginLeft: 6 }}>· {live.length}</span></>}
        right={
          <button style={tinyIconBtn}>
            <Icon name="plus" size={13}/>
          </button>
        }
      />

      <div className="hv-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 0 20px" }}>
        {live.map(c => (
          <SessionRow
            key={c.id}
            commander={c}
            selected={selectedId === c.id}
            onClick={() => onSelect(c.id)}
            workers={workers.filter(w => w.commanderId === c.id)}
            approvals={approvals.filter(a => a.commanderId === c.id)}
          />
        ))}

        <div style={{
          padding: "22px 20px 8px",
          fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "var(--fg-faint)",
        }}>STALE · {stale.length}</div>
        {stale.map(s => (
          <div key={s.id} style={{
            padding: "6px 20px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontFamily: "var(--font-mono)", fontSize: 12,
            color: "var(--fg-faint)",
          }}>
            <span>{s.name}</span>
            <span style={{ fontSize: 10.5, letterSpacing: "0.02em" }}>{s.age}</span>
          </div>
        ))}
      </div>

      <div style={{
        padding: "12px 20px 14px",
        borderTop: "1px solid var(--border-hair)",
        fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
        color: "var(--fg-faint)",
        display: "flex", justifyContent: "space-between",
      }}>
        <span>live · auto-refresh</span>
        <span>phase 2</span>
      </div>
    </aside>
  );
}

function SessionRow({ commander, selected, onClick, workers, approvals }) {
  const subAgents = workers.filter(w => w.kind === "worker" || w.kind === "tool");
  // Show 3-5 sub-agents nested when selected.
  const shown = selected ? subAgents.slice(0, 5) : [];
  const pendingCount = approvals.length;

  return (
    <div>
      <button onClick={onClick} style={{
        width: "100%", padding: "10px 20px",
        display: "flex", alignItems: "flex-start", gap: 10,
        background: selected ? "var(--ink-wash-02)" : "transparent",
        borderLeft: selected ? "2px solid var(--sumi-black)" : "2px solid transparent",
        border: "none", cursor: "pointer", textAlign: "left",
        transition: "background 0.15s var(--ease-gentle)",
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: commander.status === "connected" ? "var(--vermillion-seal)"
                    : commander.status === "paused"    ? "var(--persimmon)"
                    : "var(--ink-mist)",
          marginTop: 8, flexShrink: 0,
        }}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 13,
              color: "var(--fg)", letterSpacing: "-0.01em",
            }}>{commander.name}</span>
            {pendingCount > 0 && (
              <span style={{
                fontSize: 10, padding: "1px 6px",
                background: "rgba(194,59,34,0.10)",
                color: "var(--vermillion-seal)",
                borderRadius: "2px 6px 2px 6px",
                letterSpacing: "0.08em", textTransform: "uppercase",
                fontWeight: 500,
              }}>{pendingCount} PEND</span>
            )}
          </div>
          <div style={{
            fontSize: 11.5, color: "var(--fg-subtle)",
            marginTop: 2, fontStyle: "italic",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{commander.description.split(".")[0].toLowerCase()}</div>
        </div>
      </button>

      {/* Nested sub-agent list when selected */}
      {selected && shown.length > 0 && (
        <div style={{ padding: "2px 0 8px" }}>
          {shown.map((w, i) => {
            const pend = approvals.find(a => a.workerId === w.id) ? 1 : 0;
            return (
              <div key={w.id} style={{
                padding: "3px 20px 3px 36px",
                display: "flex", alignItems: "center", gap: 8,
                fontFamily: "var(--font-mono)", fontSize: 12,
                color: "var(--fg-muted)",
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: w.state === "active"  ? "var(--moss-stone)"
                            : w.state === "blocked" ? "var(--vermillion-seal)"
                            : w.state === "queued"  ? "var(--stone-gray)"
                            : "var(--ink-mist)",
                  flexShrink: 0,
                }}/>
                <span style={{ flex: 1 }}>{w.name}</span>
                {pend > 0 && (
                  <span style={{
                    fontSize: 10, color: "var(--vermillion-seal)",
                    fontFamily: "var(--font-mono)",
                  }}>{pend}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ColumnHeader({ left, right }) {
  return (
    <div style={{
      padding: "16px 20px 12px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: "1px solid var(--border-hair)",
      fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase",
      color: "var(--fg-subtle)", fontWeight: 500,
    }}>
      <span>{left}</span>
      {right}
    </div>
  );
}

const tinyIconBtn = {
  background: "transparent", border: "none", color: "var(--fg-subtle)",
  cursor: "pointer", padding: 2, display: "flex",
};

// ============================================================
// CENTER column — tabs + chat + composer
// ============================================================
function CenterColumn({ commander, transcript, workers, approvals, activeTab, setActiveTab, onOpenWorkspace }) {
  const tabs = [
    { id: "chat",      label: "Chat" },
    { id: "quests",    label: "Quests" },
    { id: "sentinels", label: "Sentinels" },
    { id: "cron",      label: "Cron" },
    { id: "identity",  label: "Identity" },
  ];
  const actionApproval = approvals[0];

  return (
    <section style={{
      display: "flex", flexDirection: "column",
      background: "var(--washi-white)",
      borderRight: "1px solid var(--border-hair)",
      overflow: "hidden",
    }}>
      {/* Top tabs row */}
      <div style={{
        display: "flex", alignItems: "stretch",
        borderBottom: "1px solid var(--border-hair)",
        paddingRight: 20, flexShrink: 0,
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: "14px 18px",
            background: "transparent", border: "none", cursor: "pointer",
            fontFamily: "var(--font-body)", fontSize: 11,
            letterSpacing: "0.14em", textTransform: "uppercase",
            color: activeTab === t.id ? "var(--sumi-black)" : "var(--fg-subtle)",
            borderBottom: activeTab === t.id ? "2px solid var(--sumi-black)" : "2px solid transparent",
            marginBottom: -1,
            fontWeight: 500,
          }}>{t.label}</button>
        ))}
        <span style={{ flex: 1 }}/>
        <span style={{
          alignSelf: "center",
          fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "var(--fg-faint)",
        }}>{commander.name} · live conversation</span>
      </div>

      {/* Main content area */}
      <div className="hv-scroll" style={{ flex: 1, overflowY: "auto" }}>
        {/* Commander status strip */}
        <div style={{
          padding: "26px 32px 0",
          display: "flex", alignItems: "flex-start", gap: 14,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                fontFamily: "var(--font-primary)", fontStyle: "italic",
                fontWeight: 400, fontSize: 22, color: "var(--fg)",
                letterSpacing: "-0.01em",
              }}>{commander.name}</span>
              <StatusPill tone="waiting">WAITING</StatusPill>
            </div>
            <div style={{
              fontSize: 11.5, letterSpacing: "0.06em",
              color: "var(--fg-subtle)", marginTop: 4,
            }}>
              commander · Q3 baseline review
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <Stat value="$45.33"/>
            <Stat value="6H 02S"/>
            <Stat value="5 AGENTS"/>
            <button onClick={onOpenWorkspace} style={{
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid var(--border-firm)",
              borderRadius: "2px 8px 2px 8px",
              cursor: "pointer",
              fontFamily: "var(--font-body)", fontSize: 12,
              letterSpacing: "0.02em", color: "var(--fg)",
            }}>Workspace</button>
          </div>
        </div>

        {/* Delegated strip */}
        <div style={{
          padding: "22px 32px 6px",
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        }}>
          <span style={{
            fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
            color: "var(--fg-faint)",
          }}>Delegated · {workers.filter(w => w.kind === "worker").length} sub-agents</span>
          {workers.filter(w => w.kind === "worker").slice(0,3).map(w => (
            <SubAgentChip key={w.id} worker={w}/>
          ))}
        </div>

        {/* Chat transcript */}
        {activeTab === "chat" ? (
          <ChatPane transcript={transcript} actionApproval={actionApproval} workers={workers}/>
        ) : (
          <TabPlaceholder tab={activeTab}/>
        )}
      </div>

      {/* Composer */}
      <Composer commander={commander}/>
    </section>
  );
}

function StatusPill({ tone, children }) {
  const tones = {
    waiting: { bg: "rgba(212,118,58,0.12)", fg: "var(--persimmon)", border: "rgba(212,118,58,0.35)" },
    running: { bg: "rgba(107,123,94,0.12)", fg: "var(--moss-stone)", border: "rgba(107,123,94,0.35)" },
    pending: { bg: "rgba(194,59,34,0.10)",  fg: "var(--vermillion-seal)", border: "rgba(194,59,34,0.30)" },
  };
  const t = tones[tone] || tones.waiting;
  return (
    <span style={{
      padding: "2px 9px",
      background: t.bg,
      color: t.fg,
      border: `1px solid ${t.border}`,
      borderRadius: "2px 6px 2px 6px",
      fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
      fontFamily: "var(--font-body)", fontWeight: 500,
    }}>{children}</span>
  );
}

function Stat({ value }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 12,
      color: "var(--fg-muted)", letterSpacing: "0.02em",
    }}>{value}</span>
  );
}

function SubAgentChip({ worker }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px",
      border: "1px solid var(--border-soft)",
      borderRadius: "2px 8px 2px 8px",
      fontFamily: "var(--font-mono)", fontSize: 11.5,
      color: "var(--fg-muted)",
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%",
        background: worker.state === "active" ? "var(--moss-stone)"
                  : worker.state === "blocked" ? "var(--vermillion-seal)"
                  : "var(--stone-gray)",
      }}/>
      {worker.name}
    </span>
  );
}

function ChatPane({ transcript, actionApproval, workers }) {
  return (
    <div style={{ padding: "20px 32px 10px" }}>
      {/* Agent message — paper card */}
      <AgentBubble>
        I've dispatched researcher and fetcher to pull comparative data — they should land within the hour. Writer is drafting from the existing outline. Critic is holding for the draft before reviewing tone.
      </AgentBubble>

      {/* User message — dark ink bubble */}
      <UserBubble>
        Keep the Q3 section under 400 words and leave room for Miko's chart.
      </UserBubble>

      {/* Action awaiting approval */}
      {actionApproval && (
        <ActionApprovalCard approval={actionApproval}/>
      )}

      <div style={{
        padding: "18px 0 6px",
        display: "flex", alignItems: "center", gap: 14,
        fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
        color: "var(--fg-faint)",
      }}>
        <div style={{ flex: 1, height: 1, background: "var(--border-hair)" }}/>
        <span>action awaiting approval</span>
        <div style={{ flex: 1, height: 1, background: "var(--border-hair)" }}/>
      </div>
    </div>
  );
}

function AgentBubble({ children }) {
  return (
    <div style={{
      margin: "6px 0 18px",
      padding: "14px 18px",
      background: "var(--bg)",
      border: "1px solid var(--border-hair)",
      borderRadius: "2px 14px 2px 14px",
      color: "var(--fg)",
      fontSize: 13.5, lineHeight: 1.7,
      maxWidth: "82%",
    }}>{children}</div>
  );
}

function UserBubble({ children }) {
  return (
    <div style={{
      display: "flex", justifyContent: "flex-end",
      margin: "0 0 22px",
    }}>
      <div style={{
        padding: "12px 18px",
        background: "var(--sumi-black)",
        color: "var(--washi-white)",
        borderRadius: "2px 14px 2px 14px",
        fontSize: 13.5, lineHeight: 1.6,
        maxWidth: "62%",
      }}>{children}</div>
    </div>
  );
}

function ActionApprovalCard({ approval }) {
  return (
    <div style={{
      margin: "10px 0 0",
      border: "1.5px solid var(--vermillion-seal)",
      borderRadius: "2px 14px 2px 14px",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 18px 8px",
        display: "flex", alignItems: "center", gap: 10,
        fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
        color: "var(--vermillion-seal)",
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--vermillion-seal)",
        }}/>
        writer · action · needs approval
      </div>
      <div style={{ padding: "2px 18px 14px" }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 13,
          color: "var(--vermillion-seal)",
          marginBottom: 8,
        }}>
          send_email → finance@hervald.co
        </div>
        <div style={{
          fontSize: 13, lineHeight: 1.65, color: "var(--fg)",
          marginBottom: 14,
        }}>
          Ready to send Q3 baseline draft to the finance team for comment. Subject: <i>"Q3 baseline — review by Fri"</i>. Attachment: q3-baseline.pdf.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={approveBtnStyle("primary")}>Approve & send</button>
          <button style={approveBtnStyle("ghost")}>Preview</button>
          <button style={approveBtnStyle("ghost-muted")}>Deny</button>
        </div>
      </div>
    </div>
  );
}

function approveBtnStyle(kind) {
  const s = {
    padding: "8px 16px",
    fontFamily: "var(--font-body)", fontSize: 12,
    letterSpacing: "0.02em",
    borderRadius: "2px 8px 2px 8px", cursor: "pointer",
  };
  if (kind === "primary")     return { ...s, background: "var(--sumi-black)", color: "var(--washi-white)", border: "1px solid var(--sumi-black)" };
  if (kind === "ghost")       return { ...s, background: "transparent", color: "var(--fg)", border: "1px solid var(--border-firm)" };
  return                      { ...s, background: "transparent", color: "var(--fg-subtle)", border: "1px solid var(--border-hair)" };
}

function TabPlaceholder({ tab }) {
  return (
    <div style={{
      padding: "60px 40px",
      textAlign: "center",
      color: "var(--fg-faint)",
      fontSize: 13, fontStyle: "italic",
    }}>
      {tab} panel — hooked up in phase 2.
    </div>
  );
}

function Composer({ commander }) {
  const [text, setText] = React.useState("");
  return (
    <div style={{
      flexShrink: 0,
      borderTop: "1px solid var(--border-hair)",
      padding: "14px 22px",
      display: "flex", alignItems: "center", gap: 14,
      background: "var(--washi-white)",
    }}>
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`Send a message to ${commander.name}… use @writer to address a sub-agent directly`}
        style={{
          flex: 1, padding: "8px 2px",
          background: "transparent",
          border: "none", outline: "none",
          fontFamily: "var(--font-body)", fontSize: 13,
          color: "var(--fg)",
          fontStyle: text ? "normal" : "italic",
        }}
      />
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
        color: "var(--fg-faint)",
      }}>
        <span>ENTER · SEND</span>
        <span>TAB · QUEUE</span>
      </div>
    </div>
  );
}

// ============================================================
// RIGHT · TEAM column
// ============================================================
function TeamColumn({ commander, workers, approvals, selectedWorkerId, setSelectedWorkerId, selectedWorker, onOpenWorkspace }) {
  const teamMembers = workers.filter(w => w.kind === "worker" || w.kind === "tool").slice(0, 5);
  const pendCount = approvals.length;

  return (
    <aside style={{
      background: "var(--washi-white)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <ColumnHeader
        left={<>TEAM · {teamMembers.length}</>}
        right={pendCount > 0 ? (
          <span style={{
            fontSize: 10, color: "var(--vermillion-seal)",
            letterSpacing: "0.14em", fontWeight: 500,
          }}>{pendCount} PEND</span>
        ) : null}
      />

      <div style={{
        padding: "14px 20px 6px",
        fontFamily: "var(--font-primary)", fontStyle: "italic",
        fontSize: 17, color: "var(--fg)", letterSpacing: "-0.01em",
      }}>{commander.name}'s team</div>

      <div className="hv-scroll" style={{ flex: 1, overflowY: "auto", padding: "6px 0 14px" }}>
        {teamMembers.map(w => (
          <TeamMemberRow
            key={w.id}
            worker={w}
            approvalCount={approvals.filter(a => a.workerId === w.id).length}
            selected={selectedWorkerId === w.id}
            onClick={() => setSelectedWorkerId(w.id)}
          />
        ))}
      </div>

      {selectedWorker && (
        <SelectedDetailCard worker={selectedWorker} onOpenWorkspace={onOpenWorkspace}/>
      )}
    </aside>
  );
}

function TeamMemberRow({ worker, approvalCount, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "10px 16px",
      margin: selected ? "4px 10px" : "0",
      marginLeft: selected ? 10 : 0, marginRight: selected ? 10 : 0,
      width: selected ? "calc(100% - 20px)" : "100%",
      display: "flex", alignItems: "flex-start", gap: 10,
      background: "transparent",
      border: selected ? "1px solid var(--border-firm)" : "none",
      borderRadius: selected ? "2px 10px 2px 10px" : 0,
      boxShadow: selected ? "var(--shadow-whisper)" : "none",
      cursor: "pointer", textAlign: "left",
      fontFamily: "var(--font-body)",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: worker.state === "active"  ? "var(--moss-stone)"
                  : worker.state === "blocked" ? "var(--vermillion-seal)"
                  : worker.state === "queued"  ? "var(--stone-gray)"
                  : "var(--ink-mist)",
        marginTop: 7, flexShrink: 0,
      }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 12.5,
            color: "var(--fg)",
          }}>{worker.name}</span>
          {worker.kind === "tool" && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10.5,
              color: "var(--fg-faint)",
            }}>& {worker.name === "researcher" ? "fetcher" : "caller"}</span>
          )}
        </div>
        <div style={{
          fontSize: 11, color: "var(--fg-subtle)",
          marginTop: 2, fontStyle: "italic",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{worker.label}</div>
      </div>
      {approvalCount > 0 && (
        <span style={{
          fontSize: 10, color: "var(--vermillion-seal)",
          fontFamily: "var(--font-mono)", marginTop: 6,
        }}>{approvalCount}</span>
      )}
    </button>
  );
}

function SelectedDetailCard({ worker, onOpenWorkspace }) {
  const isWaiting = worker.state === "blocked";
  return (
    <div style={{
      margin: "4px 12px 14px",
      padding: "14px 14px 12px",
      border: "1px solid var(--border-soft)",
      borderRadius: "2px 12px 2px 12px",
      background: "var(--washi-white)",
      boxShadow: "var(--shadow-whisper)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
      }}>
        <span style={{
          fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "var(--fg-subtle)", fontWeight: 500,
        }}>Selected</span>
        <span style={{ flex: 1 }}/>
        {isWaiting && <StatusPill tone="waiting">WAITING</StatusPill>}
      </div>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 13.5,
        color: "var(--fg)", marginBottom: 4,
      }}>{worker.name}</div>
      <div style={{
        fontSize: 11.5, color: "var(--fg-subtle)",
        fontStyle: "italic", marginBottom: 10,
      }}>{worker.label}</div>
      <div style={{
        fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase",
        color: "var(--vermillion-seal)",
        marginBottom: 12,
      }}>action · <span style={{ fontFamily: "var(--font-mono)", letterSpacing: 0, textTransform: "none" }}>send_email</span></div>

      <div style={{ display: "flex", gap: 6 }}>
        <button style={{
          flex: 1, padding: "6px 10px",
          background: "var(--sumi-black)", color: "var(--washi-white)",
          border: "1px solid var(--sumi-black)",
          borderRadius: "2px 6px 2px 6px",
          fontSize: 11, letterSpacing: "0.04em", cursor: "pointer",
          fontFamily: "var(--font-body)",
        }}>Open</button>
        <button style={{
          flex: 1, padding: "6px 10px",
          background: "transparent",
          color: "var(--vermillion-seal)",
          border: "1px solid rgba(194,59,34,0.35)",
          borderRadius: "2px 6px 2px 6px",
          fontSize: 11, letterSpacing: "0.04em", cursor: "pointer",
          fontFamily: "var(--font-body)",
        }}>Approve action</button>
        <button onClick={onOpenWorkspace} style={{
          flex: 1, padding: "6px 10px",
          background: "transparent",
          color: "var(--fg-muted)",
          border: "1px solid var(--border-firm)",
          borderRadius: "2px 6px 2px 6px",
          fontSize: 11, letterSpacing: "0.04em", cursor: "pointer",
          fontFamily: "var(--font-body)",
        }}>Workspace</button>
      </div>
    </div>
  );
}

Object.assign(window, { CommandRoom });
