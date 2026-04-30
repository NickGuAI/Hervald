import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'

interface StringArrayInputProps {
  label: string
  description: string
  values: string[]
  onChange: (nextValues: string[]) => void
  placeholder?: string
  emptyMessage?: string
  addLabel?: string
  disabled?: boolean
}

function normalizeValues(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

function areValuesEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

export function StringArrayInput({
  label,
  description,
  values,
  onChange,
  placeholder = '*@gehirn.ai',
  emptyMessage = 'No rules configured yet.',
  addLabel = 'Add',
  disabled = false,
}: StringArrayInputProps) {
  const [draftRows, setDraftRows] = useState<string[]>(values)

  useEffect(() => {
    setDraftRows(values)
  }, [values])

  function commit(nextDraftRows: string[]) {
    const normalized = normalizeValues(nextDraftRows)
    setDraftRows(normalized)

    if (!areValuesEqual(normalized, values)) {
      onChange(normalized)
    }
  }

  function commitRow(index: number, nextValue: string) {
    const nextDraftRows = draftRows.map((value, currentIndex) => (currentIndex === index ? nextValue : value))
    commit(nextDraftRows)
  }

  function updateDraft(index: number, nextValue: string) {
    setDraftRows((current) => current.map((value, currentIndex) => (currentIndex === index ? nextValue : value)))
  }

  function removeRow(index: number) {
    const nextDraftRows = draftRows.filter((_, currentIndex) => currentIndex !== index)
    setDraftRows(nextDraftRows)
    const normalized = normalizeValues(nextDraftRows)
    if (!areValuesEqual(normalized, values)) {
      onChange(normalized)
    }
  }

  function addRow() {
    setDraftRows((current) => [...current, ''])
  }

  return (
    <section className="rounded-[18px] border border-ink-border bg-washi-aged/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-title">{label}</p>
          <p className="mt-2 text-sm leading-relaxed text-sumi-diluted">{description}</p>
        </div>
        <span className="badge-sumi shrink-0">{values.length} rule{values.length === 1 ? '' : 's'}</span>
      </div>

      {draftRows.length > 0 ? (
        <div className="mt-4 space-y-2">
          {draftRows.map((value, index) => (
            <div key={`${label}-${index}`} className="flex items-center gap-2">
              <input
                value={value}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(event) => updateDraft(index, event.target.value)}
                onBlur={(event) => commitRow(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') {
                    return
                  }
                  event.preventDefault()
                  commitRow(index, event.currentTarget.value)
                }}
                className="w-full rounded-lg border border-ink-border bg-washi-white px-3 py-2 text-sm text-sumi-black focus:outline-none focus:ring-1 focus:ring-sumi-mist disabled:cursor-not-allowed disabled:bg-ink-wash"
              />
              <button
                type="button"
                onClick={() => removeRow(index)}
                disabled={disabled}
                className="badge-sumi h-9 w-9 shrink-0 justify-center border-0 text-sumi-diluted transition-colors hover:bg-accent-vermillion/10 hover:text-accent-vermillion disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={`Remove ${label} rule ${index + 1}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-ink-border/80 bg-white/40 px-3 py-4 text-sm text-sumi-mist">
          {emptyMessage}
        </div>
      )}

      <button
        type="button"
        onClick={addRow}
        disabled={disabled}
        className="btn-ghost mt-4 inline-flex items-center gap-1.5 !px-3 !py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Plus size={14} />
        {addLabel}
      </button>
    </section>
  )
}
