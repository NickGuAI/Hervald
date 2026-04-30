interface PartyHudProps {
  worldStatus: 'live' | 'syncing' | 'offline'
  wsStatus: 'idle' | 'connecting' | 'connected' | 'disconnected'
}

export function PartyHud({
  worldStatus,
  wsStatus,
}: PartyHudProps) {
  return (
    <aside className="pointer-events-none absolute inset-y-3 left-3 z-20 flex w-[220px] flex-col gap-2">
      <header className="rounded-lg border border-white/20 bg-black/55 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-white/90 backdrop-blur-[2px]">
        <div className="flex items-center justify-between gap-3">
          <span>party hud</span>
          <span className="rounded border border-white/20 bg-black/40 px-1.5 py-0.5 text-[10px]">
            world {worldStatus}
          </span>
        </div>
        <div className="mt-1 text-[10px] text-white/65">ws {wsStatus}</div>
      </header>
    </aside>
  )
}
