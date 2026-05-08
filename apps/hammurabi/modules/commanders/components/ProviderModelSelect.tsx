import type { AgentType, ProviderModelOption, ProviderRegistryEntry } from '@/types'

export function resolveProviderModelOptions(
  providers: readonly ProviderRegistryEntry[],
  agentType: AgentType,
): readonly ProviderModelOption[] {
  return providers.find((provider) => provider.id === agentType)?.availableModels ?? []
}

export function ProviderModelSelect({
  providers,
  agentType,
  value,
  onChange,
  label = 'Model',
  labelClassName = 'section-title block mb-2',
  className = 'w-full rounded-lg border border-ink-border bg-washi-white px-3 py-2 text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover',
}: {
  providers: readonly ProviderRegistryEntry[]
  agentType: AgentType
  value: string | null
  onChange: (value: string | null) => void
  label?: string
  labelClassName?: string
  className?: string
}) {
  const options = resolveProviderModelOptions(providers, agentType)

  return (
    <label className="block">
      <span className={labelClassName}>{label}</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className={className}
      >
        <option value="">— Adapter default —</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
