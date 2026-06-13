import { randomBytes } from 'node:crypto'

export const DEFAULT_TRANSPORT_AUTH_TICKET_TTL_MS = 60_000

export type TransportAuthTicketPurpose =
  | 'agents.session-stream'
  | 'approvals.pending-stream'
  | 'realtime.transcription'
  | 'workspace.raw'

export interface TransportAuthTicket {
  ticket: string
  expiresAt: string
}

interface TransportAuthTicketRecord {
  purpose: TransportAuthTicketPurpose
  subject?: string
  expiresAtMs: number
}

export class InMemoryTransportAuthTicketStore {
  private readonly tickets = new Map<string, TransportAuthTicketRecord>()

  constructor(
    private readonly options: {
      ttlMs?: number
      maxTickets?: number
      now?: () => Date
    } = {},
  ) {}

  issue(
    purpose: TransportAuthTicketPurpose,
    options: { subject?: string } = {},
  ): TransportAuthTicket {
    this.pruneExpired()

    const maxTickets = this.normalizeMaxTickets()
    while (this.tickets.size >= maxTickets) {
      const oldestTicket = this.tickets.keys().next().value
      if (!oldestTicket) break
      this.tickets.delete(oldestTicket)
    }

    const nowMs = this.now().getTime()
    const expiresAtMs = nowMs + this.normalizeTtlMs()
    const ticket = `hmrt_${randomBytes(24).toString('base64url')}`
    this.tickets.set(ticket, {
      purpose,
      ...(options.subject ? { subject: options.subject } : {}),
      expiresAtMs,
    })

    return {
      ticket,
      expiresAt: new Date(expiresAtMs).toISOString(),
    }
  }

  consume(
    rawTicket: string | null | undefined,
    purpose: TransportAuthTicketPurpose,
    options: { subject?: string } = {},
  ): boolean {
    const ticket = rawTicket?.trim()
    if (!ticket) {
      return false
    }

    const record = this.tickets.get(ticket)
    if (!record) {
      return false
    }

    this.tickets.delete(ticket)

    if (record.expiresAtMs <= this.now().getTime()) {
      return false
    }
    if (record.purpose !== purpose) {
      return false
    }
    if ((record.subject ?? '') !== (options.subject ?? '')) {
      return false
    }

    return true
  }

  private pruneExpired(): void {
    const nowMs = this.now().getTime()
    for (const [ticket, record] of this.tickets.entries()) {
      if (record.expiresAtMs <= nowMs) {
        this.tickets.delete(ticket)
      }
    }
  }

  private normalizeTtlMs(): number {
    const ttlMs = this.options.ttlMs
    return typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0
      ? Math.floor(ttlMs)
      : DEFAULT_TRANSPORT_AUTH_TICKET_TTL_MS
  }

  private normalizeMaxTickets(): number {
    const maxTickets = this.options.maxTickets
    return typeof maxTickets === 'number' && Number.isFinite(maxTickets) && maxTickets > 0
      ? Math.floor(maxTickets)
      : 512
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }
}

export function readTransportAuthTicketFromUrl(url: URL): string | null {
  const ticket = url.searchParams.get('ticket')?.trim()
  return ticket && ticket.length > 0 ? ticket : null
}
