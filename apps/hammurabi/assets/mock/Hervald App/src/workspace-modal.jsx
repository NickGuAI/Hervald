// ============================================================
// Hervald — Workspace modal
// Files · Changes · Git Log tabs + read-only preview pane.
// ============================================================

function WorkspaceModal({ open, onClose }) {
  const { workspace } = window.HV_DATA;
  const [tab, setTab] = React.useState("files");
  const [selected, setSelected] = React.useState("reports/google-baseline.md");

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(10,10,12,0.62)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 40,
      animation: "hvFadeIn 0.3s var(--ease-gentle) both",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(1200px, 100%)", height: "min(760px, 90vh)",
        display: "flex", flexDirection: "column",
        background: "#18181b", color: "#e8e6e1",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "4px 18px 4px 18px",
        boxShadow: "var(--shadow-modal)",
        overflow: "hidden",
      }} className="hv-dark">
        {/* Header */}
        <div style={{
          height: 54, flexShrink: 0,
          padding: "0 18px",
          display: "flex", alignItems: "center", gap: 14,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <Icon name="workspace" size={16} style={{ color: "#a09d96" }}/>
          <div style={{
            fontFamily: "var(--font-primary)", fontStyle: "italic",
            fontSize: 15, color: "#e8e6e1",
          }}>Workspace</div>
          <span style={{ color: "#42413f" }}>·</span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 11.5,
            color: "#a09d96",
          }}>{workspace.repo}</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 10.5, fontFamily: "var(--font-mono)",
            color: "#a09d96",
            padding: "2px 8px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "2px 6px 2px 6px",
          }}>
            <Icon name="branch" size={11}/>
            {workspace.branch}
          </span>
          <span style={{ flex: 1 }}/>
          <button onClick={onClose} style={{
            background: "transparent", border: "none",
            color: "#a09d96", cursor: "pointer",
            padding: 6, display: "flex",
          }}><Icon name="close" size={16}/></button>
        </div>

        {/* Search + tabs */}
        <div style={{
          padding: "10px 18px 0",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "2px 10px 2px 10px",
            padding: "7px 12px", marginBottom: 10,
          }}>
            <Icon name="search" size={13} style={{ color: "#6f6c67" }}/>
            <input placeholder="Search files…" style={{
              flex: 1, border: "none", outline: "none",
              background: "transparent", color: "#e8e6e1",
              fontFamily: "var(--font-body)", fontSize: 12.5,
            }}/>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            {[
              ["files",   "Files",   workspace.tree.length],
              ["changes", "Changes", workspace.changes.length],
              ["log",     "Git Log", workspace.log.length],
            ].map(([id, label, count]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: "8px 14px",
                background: "transparent",
                border: "none",
                color: tab === id ? "#e8e6e1" : "#6f6c67",
                borderBottom: tab === id ? "2px solid #e8e6e1" : "2px solid transparent",
                cursor: "pointer",
                fontFamily: "var(--font-body)", fontSize: 12,
                letterSpacing: "0.06em", textTransform: "uppercase",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {label}
                <span style={{
                  fontSize: 10, padding: "1px 6px",
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 8, color: "#a09d96",
                }}>{count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Body: left list + right preview */}
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* Left pane */}
          <div className="hv-scroll" style={{
            width: 380, flexShrink: 0,
            borderRight: "1px solid rgba(255,255,255,0.06)",
            overflowY: "auto",
          }}>
            {tab === "files"   && <FileTree tree={workspace.tree} selected={selected} onSelect={setSelected}/>}
            {tab === "changes" && <ChangesList changes={workspace.changes} selected={selected} onSelect={setSelected}/>}
            {tab === "log"     && <GitLog log={workspace.log}/>}
          </div>

          {/* Right preview */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <Preview selected={selected} tab={tab} preview={workspace.preview}/>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileTree({ tree, selected, onSelect }) {
  return (
    <div style={{ padding: "6px 0" }}>
      {tree.map(node => (
        <TreeNode key={node.path} node={node} depth={0} selected={selected} onSelect={onSelect}/>
      ))}
    </div>
  );
}

function TreeNode({ node, depth, selected, onSelect }) {
  const [open, setOpen] = React.useState(!!node.open);
  const isDir = node.kind === "dir";
  const isSel = selected === node.path;

  return (
    <>
      <button onClick={() => { if (isDir) setOpen(v => !v); else onSelect(node.path); }}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: `5px 14px 5px ${14 + depth * 14}px`,
          background: isSel ? "rgba(255,255,255,0.05)" : "transparent",
          border: "none",
          color: node.modified ? "var(--persimmon)" : (node.added ? "var(--moss-stone)" : "#d8d6d1"),
          cursor: "pointer", textAlign: "left",
          fontFamily: "var(--font-mono)", fontSize: 12,
          borderLeft: isSel ? "2px solid var(--vermillion-seal)" : "2px solid transparent",
        }}
        onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
        onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}>
        {isDir ? (
          <>
            <Icon name="chevronR" size={11} style={{
              color: "#6f6c67",
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 0.2s",
            }}/>
            <Icon name={open ? "folderOpen" : "folder"} size={13} style={{ color: "#6f6c67" }}/>
          </>
        ) : (
          <>
            <span style={{ width: 11 }}/>
            <Icon name="file" size={13} style={{ color: "#6f6c67" }}/>
          </>
        )}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.path.split("/").pop()}
        </span>
        {node.modified && <span style={{ fontSize: 9.5, color: "var(--persimmon)" }}>M</span>}
        {node.added && <span style={{ fontSize: 9.5, color: "var(--moss-stone)" }}>A</span>}
        <span style={{
          fontSize: 10.5, color: "#6f6c67",
          letterSpacing: "0.04em",
        }}>+ Add</span>
      </button>
      {isDir && open && node.children && node.children.map(c => (
        <TreeNode key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect}/>
      ))}
    </>
  );
}

function ChangesList({ changes, selected, onSelect }) {
  return (
    <div style={{ padding: "6px 0" }}>
      {changes.map(c => {
        const isSel = selected === c.path;
        return (
          <button key={c.path} onClick={() => onSelect(c.path)} style={{
            display: "flex", alignItems: "center", gap: 10,
            width: "100%", padding: "10px 14px",
            background: isSel ? "rgba(255,255,255,0.05)" : "transparent",
            border: "none",
            color: "#d8d6d1", cursor: "pointer", textAlign: "left",
            borderLeft: isSel ? "2px solid var(--vermillion-seal)" : "2px solid transparent",
          }}>
            <span style={{
              width: 20, height: 20, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 4,
              fontSize: 10.5, fontFamily: "var(--font-mono)", fontWeight: 500,
              background: c.status === "A" ? "rgba(107,123,94,0.15)" : c.status === "M" ? "rgba(212,118,58,0.15)" : "rgba(194,59,34,0.15)",
              color: c.status === "A" ? "var(--moss-stone)" : c.status === "M" ? "var(--persimmon)" : "var(--vermillion-seal)",
            }}>{c.status}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#e8e6e1",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</div>
              <div style={{ fontSize: 10.5, marginTop: 2, display: "flex", gap: 8 }}>
                <span style={{ color: "var(--moss-stone)" }}>+{c.additions}</span>
                <span style={{ color: "var(--vermillion-seal)" }}>−{c.deletions}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function GitLog({ log }) {
  return (
    <div style={{ padding: "8px 0" }}>
      {log.map(c => (
        <div key={c.sha} style={{
          padding: "10px 16px",
          display: "flex", gap: 12, alignItems: "flex-start",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}>
          <Icon name="commit" size={13} style={{ color: "#6f6c67", marginTop: 3, flexShrink: 0 }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: "#e8e6e1", lineHeight: 1.45 }}>{c.message}</div>
            <div style={{
              marginTop: 3, fontSize: 10.5,
              color: "#6f6c67", display: "flex", gap: 8,
            }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--persimmon)" }}>{c.sha}</span>
              <span>·</span>
              <span>{c.author}</span>
              <span>·</span>
              <span>{formatAgo(c.at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.round(diff)}m ago`;
  if (diff < 1440) return `${Math.round(diff/60)}h ago`;
  return `${Math.round(diff/1440)}d ago`;
}

function Preview({ selected, tab, preview }) {
  const showFile = (tab === "files" || tab === "changes") && selected === preview.path;

  if (!showFile) {
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        color: "#6f6c67", gap: 10, padding: 40, textAlign: "center",
      }}>
        <Icon name="eye" size={22}/>
        <div style={{ fontFamily: "var(--font-primary)", fontStyle: "italic", fontSize: 18, color: "#a09d96" }}>
          {tab === "log" ? "Select a commit to see its diff" : "Select a file to preview"}
        </div>
        <div style={{ fontSize: 12, maxWidth: 320 }}>
          Read-only. Workers edit through the session; this pane is for humans to check their work.
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{
        padding: "12px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <Icon name="file" size={13} style={{ color: "#6f6c67" }}/>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#e8e6e1" }}>{preview.path}</span>
        <span style={{
          fontSize: 10, padding: "1px 6px",
          background: "rgba(212,118,58,0.12)", color: "var(--persimmon)",
          borderRadius: "2px 6px 2px 6px",
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>modified · read-only</span>
        <span style={{ flex: 1 }}/>
        <span style={{ fontSize: 10.5, color: "#6f6c67" }}>{preview.language}</span>
      </div>

      <div className="hv-scroll" style={{
        flex: 1, overflow: "auto", padding: "18px 22px",
        fontFamily: "var(--font-mono)", fontSize: 12.5,
        lineHeight: 1.7, color: "#c8c6c1",
        whiteSpace: "pre-wrap",
      }}>
        {preview.content}
      </div>
    </>
  );
}

Object.assign(window, { WorkspaceModal });
