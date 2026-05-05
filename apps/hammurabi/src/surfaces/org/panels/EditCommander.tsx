import { useContext, useEffect, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { useProviderRegistry } from '@/hooks/use-providers'
import { DEFAULT_CLAUDE_EFFORT_LEVEL, type ClaudeEffortLevel } from '@modules/claude-effort.js'
import {
  HIRE_COMMANDER_EFFORT_OPTIONS,
  HIRE_COMMANDER_ROLE_OPTIONS,
  listSupportedCommanderConversationProviders,
  type OrgAgentType,
} from '@modules/org/forms'
import {
  fetchOrgCommanderDetail,
  type OrgCommanderDetail,
  updateOrgCommander,
} from '@modules/org/hooks/useOrgActions'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import type { OrgCommanderRoleKey, OrgNode } from '@modules/org/types'
import { EnumSelect, Field, FormModal } from '../components'

const INPUT_CLASS =
  'min-h-11 w-full rounded-2xl border border-ink-border bg-washi-white px-4 py-2 text-sm text-sumi-black outline-none transition-colors focus:border-sumi-black'
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-28 resize-y`
const PRIMARY_BUTTON_CLASS =
  'rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white transition-colors hover:bg-sumi-black/90 disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON_CLASS =
  'rounded-full border border-ink-border px-4 py-2 text-sm text-sumi-black transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-60'
const METADATA_CARD_CLASS =
  'rounded-2xl border border-ink-border bg-washi-white px-4 py-3'

type OptionalQueryClient = {
  invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<unknown>
}

type CommanderContextMode = 'thin' | 'fat'

interface EditCommanderProps {
  open: boolean
  commanderId: string
  commanderDisplayName: string
  commanders: ReadonlyArray<Pick<OrgNode, 'id' | 'displayName'>>
  fallbackOperatorId?: string | null
  onClose: () => void
  onUpdated?: (displayName: string) => void
}

interface EditCommanderValues {
  displayName: string
  roleKey: OrgCommanderRoleKey | ''
  persona: string
  agentType: OrgAgentType
  effort: ClaudeEffortLevel
  cwd: string
  maxTurns: string
  contextMode: CommanderContextMode
}

interface EditCommanderMetadata {
  id: string
  operatorId: string | null
  createdAt: string | null
  templateId: string | null
  replicatedFromCommanderId: string | null
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function buildFormValues(
  detail: OrgCommanderDetail,
  commanderDisplayName: string,
): EditCommanderValues {
  return {
    displayName: detail.displayName?.trim() || commanderDisplayName,
    roleKey: detail.roleKey ?? '',
    persona: detail.persona ?? '',
    agentType: detail.agentType ?? 'claude',
    effort: detail.effort ?? DEFAULT_CLAUDE_EFFORT_LEVEL,
    cwd: detail.cwd ?? '',
    maxTurns: typeof detail.maxTurns === 'number' && Number.isInteger(detail.maxTurns)
      ? String(detail.maxTurns)
      : '1',
    contextMode: detail.contextMode === 'thin' ? 'thin' : 'fat',
  }
}

function buildMetadata(
  detail: OrgCommanderDetail,
  fallbackOperatorId?: string | null,
): EditCommanderMetadata {
  return {
    id: detail.id,
    operatorId: detail.operatorId ?? fallbackOperatorId ?? null,
    createdAt: detail.createdAt ?? detail.created ?? null,
    templateId: detail.templateId ?? null,
    replicatedFromCommanderId: detail.replicatedFromCommanderId ?? null,
  }
}

function isValidRoleKey(value: EditCommanderValues['roleKey']): value is OrgCommanderRoleKey {
  return HIRE_COMMANDER_ROLE_OPTIONS.some((option) => option.value === value)
}

function isValidAgentType(
  options: ReadonlyArray<{ value: OrgAgentType }>,
  value: string,
): value is OrgAgentType {
  return options.some((option) => option.value === value)
}

function isValidEffort(value: string): value is ClaudeEffortLevel {
  return HIRE_COMMANDER_EFFORT_OPTIONS.some((option) => option.value === value)
}

export function EditCommander({
  open,
  commanderId,
  commanderDisplayName,
  commanders,
  fallbackOperatorId,
  onClose,
  onUpdated,
}: EditCommanderProps) {
  const { data: providers = [] } = useProviderRegistry()
  const agentTypeOptions = listSupportedCommanderConversationProviders(providers)
  const queryClient = useContext(
    QueryClientContext as Parameters<typeof useContext>[0],
  ) as OptionalQueryClient | undefined

  const [initialValues, setInitialValues] = useState<EditCommanderValues | null>(null)
  const [values, setValues] = useState<EditCommanderValues | null>(null)
  const [metadata, setMetadata] = useState<EditCommanderMetadata | null>(null)
  const [maxTurnsLimit, setMaxTurnsLimit] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setIsLoading(true)
    setIsPending(false)
    setGlobalError(null)

    void fetchOrgCommanderDetail(commanderId)
      .then((detail) => {
        if (cancelled) {
          return
        }

        const nextValues = buildFormValues(detail, commanderDisplayName)
        setInitialValues(nextValues)
        setValues(nextValues)
        setMetadata(buildMetadata(detail, fallbackOperatorId))
        setMaxTurnsLimit(
          typeof detail.runtimeConfig?.limits?.maxTurns === 'number'
            ? detail.runtimeConfig.limits.maxTurns
            : null,
        )
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setInitialValues(null)
        setValues(null)
        setMetadata(null)
        setGlobalError(error instanceof Error ? error.message : 'Failed to load commander details.')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, commanderId, commanderDisplayName, fallbackOperatorId])

  function requestClose() {
    setIsPending(false)
    setGlobalError(null)
    onClose()
  }

  function updateField<TKey extends keyof EditCommanderValues>(
    field: TKey,
    nextValue: EditCommanderValues[TKey],
  ) {
    setValues((current) => (current ? { ...current, [field]: nextValue } : current))
  }

  const displayName = values?.displayName ?? ''
  const trimmedDisplayName = displayName.trim()
  const roleKey = values?.roleKey ?? ''
  const maxTurnsValue = values?.maxTurns ?? ''
  const parsedMaxTurns = Number.parseInt(maxTurnsValue, 10)
  const hasIntegerMaxTurns = Number.isInteger(parsedMaxTurns) && String(parsedMaxTurns) === maxTurnsValue.trim()

  let displayNameError: string | null = null
  if (!trimmedDisplayName) {
    displayNameError = 'Display name is required.'
  } else if (
    commanders.some((commander) =>
      commander.id !== commanderId
      && normalizeName(commander.displayName) === normalizeName(trimmedDisplayName))
  ) {
    displayNameError = 'Display name already exists.'
  }

  const roleKeyError = isValidRoleKey(roleKey) ? null : 'Select a valid role.'

  let maxTurnsError: string | null = null
  if (!maxTurnsValue.trim()) {
    maxTurnsError = 'Max turns is required.'
  } else if (!hasIntegerMaxTurns || parsedMaxTurns < 1) {
    maxTurnsError = 'Max turns must be an integer greater than or equal to 1.'
  } else if (typeof maxTurnsLimit === 'number' && parsedMaxTurns > maxTurnsLimit) {
    maxTurnsError = `Max turns must be ${maxTurnsLimit} or fewer.`
  }

  const isFormValid = !displayNameError && !roleKeyError && !maxTurnsError

  const isDirty = Boolean(
    initialValues
    && values
    && (
      normalizeName(values.displayName) !== normalizeName(initialValues.displayName)
      || values.roleKey !== initialValues.roleKey
      || values.persona.trim() !== initialValues.persona.trim()
      || values.agentType !== initialValues.agentType
      || values.effort !== initialValues.effort
      || values.cwd.trim() !== initialValues.cwd.trim()
      || parsedMaxTurns !== Number.parseInt(initialValues.maxTurns, 10)
      || values.contextMode !== initialValues.contextMode
    ),
  )

  async function handleSubmit(): Promise<void> {
    if (!values || !initialValues || !isFormValid || !isDirty) {
      return
    }

    const payload: Record<string, string | number> = {}
    const trimmedPersona = values.persona.trim()
    const trimmedCwd = values.cwd.trim()

    if (normalizeName(values.displayName) !== normalizeName(initialValues.displayName)) {
      payload.displayName = trimmedDisplayName
    }
    if (values.roleKey !== initialValues.roleKey && isValidRoleKey(values.roleKey)) {
      payload.roleKey = values.roleKey
    }
    if (trimmedPersona !== initialValues.persona.trim()) {
      payload.persona = trimmedPersona
    }
    if (values.agentType !== initialValues.agentType) {
      payload.agentType = values.agentType
    }
    if (values.effort !== initialValues.effort) {
      payload.effort = values.effort
    }
    if (trimmedCwd !== initialValues.cwd.trim()) {
      payload.cwd = trimmedCwd
    }
    if (parsedMaxTurns !== Number.parseInt(initialValues.maxTurns, 10)) {
      payload.maxTurns = parsedMaxTurns
    }
    if (values.contextMode !== initialValues.contextMode) {
      payload.contextMode = values.contextMode
    }

    setIsPending(true)
    setGlobalError(null)
    try {
      await updateOrgCommander(commanderId, payload)
      await queryClient?.invalidateQueries({ queryKey: ORG_QUERY_KEY })
      onUpdated?.(trimmedDisplayName)
      requestClose()
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Failed to update commander.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <FormModal
      open={open}
      title="Edit Commander"
      onClose={requestClose}
      bodyTestId="edit-commander-panel"
      footer={(
        <>
          <button
            type="button"
            data-testid="edit-commander-cancel-button"
            onClick={requestClose}
            disabled={isPending}
            className={SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
          <button
            type="button"
            data-testid="edit-commander-save-button"
            onClick={() => void handleSubmit()}
            disabled={isLoading || isPending || !isDirty || !isFormValid}
            className={PRIMARY_BUTTON_CLASS}
          >
            {isPending ? 'Saving...' : 'Save changes'}
          </button>
        </>
      )}
    >
      {globalError ? (
        <div
          data-testid="edit-commander-error"
          className="rounded-2xl border border-accent-vermillion/30 bg-accent-vermillion/10 px-4 py-3 text-sm text-accent-vermillion"
        >
          {globalError}
        </div>
      ) : null}

      {isLoading ? (
        <p data-testid="edit-commander-loading" className="text-sm text-sumi-diluted">
          Loading commander details...
        </p>
      ) : !values || !metadata ? (
        <p data-testid="edit-commander-load-failed" className="text-sm text-sumi-diluted">
          Commander details are unavailable right now.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="space-y-4">
            <p className="text-sm text-sumi-diluted">
              Update commander identity and runtime defaults without leaving the org page.
            </p>

            <Field
              label="Display Name"
              htmlFor="edit-commander-displayname-input"
              required
              error={displayNameError}
            >
              <input
                id="edit-commander-displayname-input"
                data-testid="edit-commander-displayname-input"
                value={values.displayName}
                onChange={(event) => updateField('displayName', event.target.value)}
                className={INPUT_CLASS}
              />
            </Field>

            <Field
              label="Role"
              htmlFor="edit-commander-role-select"
              required
              error={roleKeyError}
            >
              <EnumSelect
                id="edit-commander-role-select"
                data-testid="edit-commander-role-select"
                value={values.roleKey}
                onChange={(event) => updateField(
                  'roleKey',
                  event.target.value as EditCommanderValues['roleKey'],
                )}
                placeholder="— Select role —"
                options={HIRE_COMMANDER_ROLE_OPTIONS}
              />
            </Field>

            <Field label="Persona" htmlFor="edit-commander-persona-input">
              <textarea
                id="edit-commander-persona-input"
                data-testid="edit-commander-persona-textarea"
                value={values.persona}
                onChange={(event) => updateField('persona', event.target.value)}
                className={TEXTAREA_CLASS}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agent Type" htmlFor="edit-commander-agent-type-select">
                <EnumSelect
                  id="edit-commander-agent-type-select"
                  data-testid="edit-commander-agent-select"
                  value={values.agentType}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    if (isValidAgentType(agentTypeOptions, nextValue)) {
                      updateField('agentType', nextValue)
                    }
                  }}
                  options={agentTypeOptions}
                />
              </Field>

              <Field label="Effort" htmlFor="edit-commander-effort-select">
                <EnumSelect
                  id="edit-commander-effort-select"
                  data-testid="edit-commander-effort-select"
                  value={values.effort}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    if (isValidEffort(nextValue)) {
                      updateField('effort', nextValue)
                    }
                  }}
                  options={HIRE_COMMANDER_EFFORT_OPTIONS}
                />
              </Field>
            </div>

            <Field label="Working Directory" htmlFor="edit-commander-cwd-input">
              <input
                id="edit-commander-cwd-input"
                data-testid="edit-commander-cwd-input"
                value={values.cwd}
                onChange={(event) => updateField('cwd', event.target.value)}
                className={INPUT_CLASS}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Max Turns"
                htmlFor="edit-commander-maxturns-input"
                required
                error={maxTurnsError}
              >
                <input
                  id="edit-commander-maxturns-input"
                  data-testid="edit-commander-maxturns-input"
                  type="number"
                  min={1}
                  max={maxTurnsLimit ?? undefined}
                  value={values.maxTurns}
                  onChange={(event) => updateField('maxTurns', event.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>

              <Field label="Context Mode" htmlFor="edit-commander-context-mode-select">
                <EnumSelect
                  id="edit-commander-context-mode-select"
                  data-testid="edit-commander-context-mode-select"
                  value={values.contextMode}
                  onChange={(event) => updateField(
                    'contextMode',
                    event.target.value === 'thin' ? 'thin' : 'fat',
                  )}
                  options={[
                    { value: 'fat', label: 'Fat' },
                    { value: 'thin', label: 'Thin' },
                  ]}
                />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-medium text-sumi-black">Metadata</h2>
            <dl
              data-testid="edit-commander-metadata"
              className="grid gap-3 sm:grid-cols-2"
            >
              <div className={METADATA_CARD_CLASS}>
                <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">ID</dt>
                <dd className="mt-1 break-all font-mono text-sm text-sumi-black">{metadata.id}</dd>
              </div>
              <div className={METADATA_CARD_CLASS}>
                <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">Operator ID</dt>
                <dd className="mt-1 break-all font-mono text-sm text-sumi-black">{metadata.operatorId ?? '—'}</dd>
              </div>
              <div className={METADATA_CARD_CLASS}>
                <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">Created At</dt>
                <dd className="mt-1 break-all font-mono text-sm text-sumi-black">{metadata.createdAt ?? '—'}</dd>
              </div>
              <div className={METADATA_CARD_CLASS}>
                <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">Template ID</dt>
                <dd className="mt-1 break-all font-mono text-sm text-sumi-black">{metadata.templateId ?? '—'}</dd>
              </div>
              <div className={`${METADATA_CARD_CLASS} sm:col-span-2`}>
                <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">
                  Replicated From Commander ID
                </dt>
                <dd className="mt-1 break-all font-mono text-sm text-sumi-black">
                  {metadata.replicatedFromCommanderId ?? '—'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </FormModal>
  )
}
