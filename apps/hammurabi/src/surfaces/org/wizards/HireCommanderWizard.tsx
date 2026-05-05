import { useContext, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { useProviderRegistry } from '@/hooks/use-providers'
import type { OrgNode } from '@modules/org/types'
import { ORG_QUERY_KEY } from '@modules/org/hooks/useOrgTree'
import { createOrgCommander } from '@modules/org/hooks/useOrgActions'
import {
  HIRE_COMMANDER_EFFORT_OPTIONS,
  HIRE_COMMANDER_ROLE_OPTIONS,
  buildHiddenCommanderHost,
  listSupportedCommanderConversationProviders,
  useHireCommanderWizardForm,
} from '@modules/org/forms'
import type { HireCommanderCreateRequestBody } from '@modules/org/forms'
import { EnumSelect, Field, FormModal } from '../components'

const INPUT_CLASS =
  'min-h-11 w-full rounded-2xl border border-ink-border bg-washi-white px-4 py-2 text-sm text-sumi-black outline-none transition-colors focus:border-sumi-black'
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-28 resize-y`
const PRIMARY_BUTTON_CLASS =
  'rounded-full bg-sumi-black px-4 py-2 text-sm text-washi-white transition-colors hover:bg-sumi-black/90 disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON_CLASS =
  'rounded-full border border-ink-border px-4 py-2 text-sm text-sumi-black transition-colors hover:bg-ink-wash disabled:cursor-not-allowed disabled:opacity-60'

interface HireCommanderWizardProps {
  open: boolean
  commanders: ReadonlyArray<OrgNode>
  onClose: () => void
}

type OptionalQueryClient = {
  invalidateQueries: (options: { queryKey: readonly unknown[] }) => Promise<unknown>
}

export function HireCommanderWizard({
  open,
  commanders,
  onClose,
}: HireCommanderWizardProps) {
  const { data: providers = [] } = useProviderRegistry()
  const agentTypeOptions = listSupportedCommanderConversationProviders(providers)
  const queryClient = useContext(
    QueryClientContext as Parameters<typeof useContext>[0],
  ) as OptionalQueryClient | undefined
  const form = useHireCommanderWizardForm({
    existingCommanderNames: commanders
      .filter((commander) => commander.kind === 'commander')
      .map((commander) => commander.displayName),
  })
  const [isPending, setIsPending] = useState(false)

  function requestClose() {
    form.reset()
    form.setGlobalError(null)
    setIsPending(false)
    onClose()
  }

  async function handleSubmit(): Promise<void> {
    const payload = form.buildCreateRequestBody(buildHiddenCommanderHost(form.values.displayName))
    if (!payload) {
      return
    }

    setIsPending(true)
    form.setGlobalError(null)
    try {
      await createOrgCommander(payload)
      await queryClient?.invalidateQueries({ queryKey: ORG_QUERY_KEY })
      requestClose()
    } catch (error) {
      form.setGlobalError(error instanceof Error ? error.message : 'Failed to hire commander.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <FormModal
      open={open}
      title="Hire Commander"
      onClose={requestClose}
      bodyTestId="hire-commander-wizard"
      footer={(
        <>
          {form.step === 'review' ? (
            <button
              type="button"
              data-testid="hire-back-button"
              onClick={form.goBack}
              disabled={isPending}
              className={SECONDARY_BUTTON_CLASS}
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            data-testid="hire-close-button"
            onClick={requestClose}
            disabled={isPending}
            className={SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
          {form.step === 'review' ? (
            <button
              type="button"
              data-testid="hire-submit-button"
              onClick={() => void handleSubmit()}
              disabled={isPending}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isPending ? 'Hiring...' : 'Hire'}
            </button>
          ) : (
            <button
              type="button"
              data-testid="hire-next-button"
              onClick={form.goNext}
              disabled={isPending}
              className={PRIMARY_BUTTON_CLASS}
            >
              Review
            </button>
          )}
        </>
      )}
    >
      {form.errors.global ? (
        <div className="rounded-2xl border border-accent-vermillion/30 bg-accent-vermillion/10 px-4 py-3 text-sm text-accent-vermillion">
          {form.errors.global}
        </div>
      ) : null}

      {form.step === 'details' ? (
        <div className="space-y-4">
          <p className="text-sm text-sumi-diluted">
            Create a commander directly from the org page.
          </p>

          <Field
            label="Display Name"
            htmlFor="hire-display-name-input"
            required
            error={form.errors.displayName}
          >
            <input
              id="hire-display-name-input"
              data-testid="hire-display-name-input"
              value={form.values.displayName}
              onChange={(event) => form.updateField('displayName', event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label="Role"
            htmlFor="hire-role-select"
            required
            error={form.errors.roleKey}
          >
            <EnumSelect
              id="hire-role-select"
              data-testid="hire-role-select"
              value={form.values.roleKey}
              onChange={(event) => form.updateField('roleKey', event.target.value as typeof form.values.roleKey)}
              placeholder="— Select role —"
              options={HIRE_COMMANDER_ROLE_OPTIONS}
            />
          </Field>

          <Field label="Agent Type" htmlFor="hire-agent-type-select">
            <EnumSelect
              id="hire-agent-type-select"
              data-testid="hire-agent-type-select"
              value={form.values.agentType}
              onChange={(event) => form.updateField('agentType', event.target.value as typeof form.values.agentType)}
              options={agentTypeOptions}
            />
          </Field>

          <Field label="Effort" htmlFor="hire-effort-select">
            <EnumSelect
              id="hire-effort-select"
              data-testid="hire-effort-select"
              value={form.values.effort}
              onChange={(event) => form.updateField('effort', event.target.value as typeof form.values.effort)}
              options={HIRE_COMMANDER_EFFORT_OPTIONS}
            />
          </Field>

          <Field label="Persona" htmlFor="hire-persona-input">
            <textarea
              id="hire-persona-input"
              data-testid="hire-persona-input"
              value={form.values.persona}
              onChange={(event) => form.updateField('persona', event.target.value)}
              className={TEXTAREA_CLASS}
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-sumi-diluted">
            Review the commander before creating it.
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-ink-border bg-washi-white px-4 py-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">Display Name</dt>
              <dd className="mt-1 text-sm text-sumi-black">{form.values.displayName}</dd>
            </div>
            <div className="rounded-2xl border border-ink-border bg-washi-white px-4 py-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">Role</dt>
              <dd className="mt-1 text-sm text-sumi-black">{form.values.roleKey || '—'}</dd>
            </div>
            <div className="rounded-2xl border border-ink-border bg-washi-white px-4 py-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">Agent</dt>
              <dd className="mt-1 text-sm text-sumi-black">{form.values.agentType}</dd>
            </div>
            <div className="rounded-2xl border border-ink-border bg-washi-white px-4 py-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">Effort</dt>
              <dd className="mt-1 text-sm text-sumi-black">{form.values.effort}</dd>
            </div>
            <div className="rounded-2xl border border-ink-border bg-washi-white px-4 py-3 sm:col-span-2">
              <dt className="text-xs uppercase tracking-[0.16em] text-sumi-diluted">Persona</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-sumi-black">
                {form.values.persona || '—'}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </FormModal>
  )
}
