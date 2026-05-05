import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface EnumOption {
  value: string
  label: string
}

interface EnumSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: ReadonlyArray<EnumOption>
  placeholder?: string
}

export function EnumSelect({
  options,
  placeholder,
  className,
  ...props
}: EnumSelectProps) {
  return (
    <select
      {...props}
      className={cn(
        'min-h-11 w-full rounded-2xl border border-ink-border bg-washi-white px-4 py-2 text-sm text-sumi-black outline-none transition-colors focus:border-sumi-black',
        className,
      )}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
