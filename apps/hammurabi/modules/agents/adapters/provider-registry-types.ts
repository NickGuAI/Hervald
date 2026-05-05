/**
 * String-typed provider identifier.
 *
 * #1294's registry migration is now the canonical source of provider ids.
 * Consumers should use `ProviderId` / `AgentType` and validate runtime input
 * through `parseProviderId()` instead of duplicating closed string unions.
 * This remains a string alias so shared types can stay registry-backed
 * without creating circular dependencies.
 *
 * Source of truth: `registerProvider({ id })` under `adapters/<id>/provider.ts`.
 */

export type ProviderId = string
