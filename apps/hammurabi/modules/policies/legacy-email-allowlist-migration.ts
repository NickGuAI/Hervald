import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { PolicyStore } from './store.js'
import {
  createStandingApprovalEntry,
  getPermanentStandingApprovalReason,
  SEND_EMAIL_ACTION_ID,
  type StandingApprovalEntry,
} from './email-standing-approval.js'
import { isRecord, normalizeStringArray, readJsonFile } from './shared.js'

const execFileAsync = promisify(execFile)
const LEGACY_REPO_ALLOWLIST_PATH = 'agent-skills/guards/data/email-allowlist.json'
interface LegacyStandingApprovalAuditEntry {
  email: string
  decision: 'keep' | 'purge'
  reason: string
}

const LEGACY_STANDING_APPROVAL_AUDIT: LegacyStandingApprovalAuditEntry[] = [
  {
    email: 'nickgu@google.com',
    decision: 'purge',
    reason: 'Purged stale Apr 10 google.com approval-queue test mistake.',
  },
  {
    email: 'birthdays@lsc.org',
    decision: 'purge',
    reason: 'Purged one-off birthday party inquiry from Apr 9, 2026.',
  },
  {
    email: 'birthdays@gritsportstraining.com',
    decision: 'purge',
    reason: 'Purged one-off birthday party inquiry from Apr 9, 2026.',
  },
  {
    email: 'funzytangram@gmail.com',
    decision: 'purge',
    reason: 'Purged one-off birthday party inquiry from Apr 9, 2026.',
  },
  {
    email: 'jerseycity@catchair.com',
    decision: 'purge',
    reason: 'Purged one-off birthday party inquiry from Apr 9, 2026.',
  },
  {
    email: 'info@tinyartisanjc.com',
    decision: 'purge',
    reason: 'Purged one-off birthday party inquiry from Apr 9, 2026.',
  },
  {
    email: 'create@lunadepapel.us',
    decision: 'purge',
    reason: 'Purged one-off birthday party inquiry from Apr 9, 2026.',
  },
  {
    email: 'ruth@lunadepapel.us',
    decision: 'purge',
    reason: 'Purged one-off birthday party inquiry from Apr 9, 2026.',
  },
  {
    email: 'lonnnghy@gmail.com',
    decision: 'purge',
    reason: 'Purged after Gmail audit: Heyang / Pioneer Track Session 1 reminder on Apr 9-10, 2026.',
  },
  {
    email: 'lima01@gmail.com',
    decision: 'purge',
    reason: 'Purged after Gmail audit: Li Ma collaborator thread and Pioneer Track reminder, but not a permanent-bypass recipient.',
  },
  {
    email: 'dvora5018@gmail.com',
    decision: 'purge',
    reason: 'Purged after Gmail audit: Jingyun / Pioneer Track Session 1 reminder on Apr 9, 2026.',
  },
  {
    email: 'injune1123@gmail.com',
    decision: 'purge',
    reason: 'Purged after Gmail audit: Jun Yin event registration and Pioneer Track reminder, but not a permanent-bypass recipient.',
  },
  {
    email: 'estella.qixin.ho@gmail.com',
    decision: 'purge',
    reason: 'Purged after Gmail audit: Estella Ho event registration and Pioneer Track reminder, but not a permanent-bypass recipient.',
  },
  {
    email: 'zhangchong186@126.com',
    decision: 'purge',
    reason: 'Purged after Gmail audit: Chong / Pioneer Track payment reminder on Apr 9, 2026.',
  },
]

export interface LegacyEmailAllowlistMigrationOptions {
  sourceFilePath: string
  targetPolicyFilePath: string
  repoRoot?: string
  now?: () => Date
  addedBy?: string
  resolveAddedAt?: (email: string) => Promise<string>
}

export interface LegacyEmailAllowlistMigrationResult {
  kept: StandingApprovalEntry[]
  purged: Array<{ email: string; reason: string }>
  unresolved: string[]
  sourceFilePath: string
  targetPolicyFilePath: string
}

async function resolveLegacyAddedAtFromGit(
  repoRoot: string,
  email: string,
): Promise<string | null> {
  try {
    const result = await execFileAsync(
      'git',
      ['log', '--format=%aI', '--reverse', '-S', email, '--', LEGACY_REPO_ALLOWLIST_PATH],
      { cwd: repoRoot },
    )
    const firstTimestamp = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    return firstTimestamp ?? null
  } catch {
    return null
  }
}

async function resolveLegacyAddedAtFromMtime(sourceFilePath: string): Promise<string | null> {
  try {
    const fileStats = await stat(sourceFilePath)
    return fileStats.mtime.toISOString()
  } catch {
    return null
  }
}

async function resolveLegacyAddedAt(
  email: string,
  sourceFilePath: string,
  repoRoot: string | undefined,
): Promise<string | undefined> {
  const fromGit = repoRoot ? await resolveLegacyAddedAtFromGit(repoRoot, email) : null
  if (fromGit) {
    return fromGit
  }

  return (await resolveLegacyAddedAtFromMtime(sourceFilePath)) ?? undefined
}

function readLegacyStandingApproval(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return []
  }
  return normalizeStringArray(payload.standing_approval)
}

function getLegacyStandingApprovalAudit(email: string): LegacyStandingApprovalAuditEntry | null {
  const normalized = email.trim().toLowerCase()
  return LEGACY_STANDING_APPROVAL_AUDIT.find((entry) => entry.email.trim().toLowerCase() === normalized) ?? null
}

export async function migrateLegacyEmailAllowlist(
  options: LegacyEmailAllowlistMigrationOptions,
): Promise<LegacyEmailAllowlistMigrationResult> {
  const now = options.now ?? (() => new Date())
  const currentTime = now()
  const sourcePayload = await readJsonFile<unknown>(options.sourceFilePath, {
    standing_approval: [],
    per_instance_approved: [],
  })
  const sourceEmails = readLegacyStandingApproval(sourcePayload)

  const resolveAddedAt = options.resolveAddedAt
    ? options.resolveAddedAt
    : async (email: string) => (
      await resolveLegacyAddedAt(email, options.sourceFilePath, options.repoRoot)
    ) ?? currentTime.toISOString()

  const kept: StandingApprovalEntry[] = []
  const purged: Array<{ email: string; reason: string }> = []
  const unresolved: string[] = []

  for (const email of sourceEmails) {
    const permanentReason = getPermanentStandingApprovalReason(email)
    if (permanentReason) {
      const entry = createStandingApprovalEntry({
        email,
        now: currentTime,
        added_at: await resolveAddedAt(email),
        added_by: options.addedBy ?? 'email-allowlist-migration',
        reason: permanentReason,
        permanent: true,
      })
      if (entry) {
        kept.push(entry)
      }
      continue
    }

    const audit = getLegacyStandingApprovalAudit(email)
    if (!audit) {
      unresolved.push(email)
      continue
    }

    if (audit.decision === 'purge') {
      purged.push({ email: audit.email, reason: audit.reason })
      continue
    }

    const entry = createStandingApprovalEntry({
      email,
      now: currentTime,
      added_at: await resolveAddedAt(email),
      added_by: options.addedBy ?? 'email-allowlist-migration',
      reason: audit.reason,
    })
    if (entry) {
      kept.push(entry)
    }
  }

  const policyStore = new PolicyStore({
    filePath: options.targetPolicyFilePath,
    now,
  })
  const globalPolicies = await policyStore.getGlobal()
  const existingSendEmail = globalPolicies.records.find((record) => record.actionId === SEND_EMAIL_ACTION_ID)

  await policyStore.putPolicy('global', SEND_EMAIL_ACTION_ID, {
    policy: 'review',
    allowlist: kept.map((entry) => entry.email),
    standing_approval: kept,
    blocklist: existingSendEmail?.blocklist ?? [],
    updatedBy: options.addedBy ?? 'email-allowlist-migration',
  })

  return {
    kept: [...kept].sort((left, right) => left.email.localeCompare(right.email)),
    purged: [...purged].sort((left, right) => left.email.localeCompare(right.email)),
    unresolved: [...unresolved].sort((left, right) => left.localeCompare(right)),
    sourceFilePath: options.sourceFilePath,
    targetPolicyFilePath: options.targetPolicyFilePath,
  }
}
