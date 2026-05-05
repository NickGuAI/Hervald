import { asTrimmedString, uniqueStrings } from './shared.js'

export const SEND_EMAIL_ACTION_ID = 'send-email'
export const DEFAULT_STANDING_APPROVAL_EXPIRY_DAYS = 30

const DEFAULT_STANDING_APPROVAL_REASON = 'Added via action policy update'
const PERMANENT_STANDING_APPROVAL_REASONS = new Map<string, string>([
  ['yu.gu.columbia@gmail.com', 'Permanent standing approval: personal inbox.'],
  ['nickgu@pioneeringminds.ai', 'Permanent standing approval: work inbox.'],
  ['mengzew.xieyi@gmail.com', 'Permanent standing approval: spouse.'],
])

export interface StandingApprovalEntry {
  email: string
  added_at: string
  added_by: string
  reason: string
  expires_at?: string
  permanent?: boolean
}

export interface StandingApprovalNormalizationOptions {
  now: Date
  default_added_at?: string
  default_added_by?: string
  default_reason?: string
  expiry_days?: number
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function getPermanentStandingApprovalReason(email: string): string | null {
  return PERMANENT_STANDING_APPROVAL_REASONS.get(normalizeEmail(email)) ?? null
}

export function isPermanentStandingApprovalEmail(email: string): boolean {
  return getPermanentStandingApprovalReason(email) !== null
}

export function createStandingApprovalEntry(options: {
  email: string
  now: Date
  added_at?: string
  added_by?: string
  reason?: string
  expires_at?: string
  permanent?: boolean
  expiry_days?: number
}): StandingApprovalEntry | null {
  const normalizedEmail = asTrimmedString(options.email)
  if (!normalizedEmail) {
    return null
  }

  const email = normalizeEmail(normalizedEmail)
  const permanent = options.permanent ?? isPermanentStandingApprovalEmail(email)
  const addedAt = parseIsoDate(options.added_at) ?? options.now
  const added_at = addedAt.toISOString()
  const added_by = asTrimmedString(options.added_by) ?? 'unknown'
  const reason =
    asTrimmedString(options.reason)
    ?? getPermanentStandingApprovalReason(email)
    ?? DEFAULT_STANDING_APPROVAL_REASON

  const explicitExpiry = parseIsoDate(options.expires_at)
  const expires_at = permanent
    ? undefined
    : (explicitExpiry ?? addDays(addedAt, options.expiry_days ?? DEFAULT_STANDING_APPROVAL_EXPIRY_DAYS)).toISOString()

  return {
    email,
    added_at,
    added_by,
    reason,
    ...(expires_at ? { expires_at } : {}),
    ...(permanent ? { permanent: true } : {}),
  }
}

export function normalizeStandingApprovalEntry(
  value: unknown,
  options: StandingApprovalNormalizationOptions,
): StandingApprovalEntry | null {
  if (typeof value === 'string') {
    return createStandingApprovalEntry({
      email: value,
      now: options.now,
      added_at: options.default_added_at,
      added_by: options.default_added_by,
      reason: options.default_reason,
      expiry_days: options.expiry_days,
    })
  }

  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  return createStandingApprovalEntry({
    email: typeof record.email === 'string' ? record.email : '',
    now: options.now,
    added_at:
      (typeof record.added_at === 'string' ? record.added_at : undefined)
      ?? (typeof record.addedAt === 'string' ? record.addedAt : undefined)
      ?? options.default_added_at,
    added_by:
      (typeof record.added_by === 'string' ? record.added_by : undefined)
      ?? (typeof record.addedBy === 'string' ? record.addedBy : undefined)
      ?? options.default_added_by,
    reason:
      (typeof record.reason === 'string' ? record.reason : undefined)
      ?? options.default_reason,
    expires_at:
      (typeof record.expires_at === 'string' ? record.expires_at : undefined)
      ?? (typeof record.expiresAt === 'string' ? record.expiresAt : undefined),
    permanent:
      typeof record.permanent === 'boolean'
        ? record.permanent
        : undefined,
    expiry_days: options.expiry_days,
  })
}

export function normalizeStandingApprovalEntries(
  value: unknown,
  options: StandingApprovalNormalizationOptions,
): StandingApprovalEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((entry) => normalizeStandingApprovalEntry(entry, options))
    .filter((entry): entry is StandingApprovalEntry => entry !== null)

  const byEmail = new Map<string, StandingApprovalEntry>()
  for (const entry of normalized) {
    byEmail.set(entry.email, entry)
  }

  return Array.from(byEmail.values()).sort((left, right) => left.email.localeCompare(right.email))
}

export function isStandingApprovalActive(entry: StandingApprovalEntry, now: Date): boolean {
  if (entry.permanent) {
    return true
  }

  if (!entry.expires_at) {
    return true
  }

  const expiresAt = parseIsoDate(entry.expires_at)
  if (!expiresAt) {
    return true
  }

  return expiresAt.getTime() > now.getTime()
}

export function getActiveStandingApprovalEmails(
  entries: StandingApprovalEntry[] | undefined,
  now: Date,
): string[] {
  if (!entries) {
    return []
  }

  return uniqueStrings(
    entries
      .filter((entry) => isStandingApprovalActive(entry, now))
      .map((entry) => entry.email),
  )
}

export function reconcileStandingApprovalEntries(options: {
  existing: StandingApprovalEntry[]
  nextEmails: string[]
  now: Date
  added_by?: string
  reason?: string
  expiry_days?: number
}): StandingApprovalEntry[] {
  const existingByEmail = new Map(
    options.existing.map((entry) => [normalizeEmail(entry.email), entry] as const),
  )

  const nextEntries: StandingApprovalEntry[] = []
  for (const candidate of uniqueStrings(
    options.nextEmails
      .map((email) => asTrimmedString(email))
      .filter((email): email is string => email !== null)
      .map((email) => normalizeEmail(email)),
  )) {
    const existing = existingByEmail.get(candidate)
    if (existing && isStandingApprovalActive(existing, options.now)) {
      nextEntries.push({
        ...existing,
        email: candidate,
        ...(isPermanentStandingApprovalEmail(candidate) ? { permanent: true, expires_at: undefined } : {}),
      })
      continue
    }

    const nextEntry = createStandingApprovalEntry({
      email: candidate,
      now: options.now,
      added_by: options.added_by,
      reason: options.reason,
      expiry_days: options.expiry_days,
    })
    if (nextEntry) {
      nextEntries.push(nextEntry)
    }
  }

  return nextEntries.sort((left, right) => left.email.localeCompare(right.email))
}
