/**
 * Operator entity — singleton founder today, multi-operator schema-ready.
 *
 * Persisted at `~/.hammurabi/operators.json`. Migrates to a database row
 * when database infrastructure lands; the shape is stable across that move.
 *
 * Source of truth: #1198 [Spec v8] Domain model block.
 */

export type OperatorKind = 'founder' | 'cofounder' | 'contractor' | 'va'

export interface Operator {
  id: string
  kind: OperatorKind
  displayName: string
  email: string | null
  avatarUrl?: string | null
  createdAt: string
}
