import { useMemo, useState } from 'react'
import { Zap, X } from 'lucide-react'
import { DismissibleOverlay } from '@/components/DismissibleOverlay'
import { useSkills } from '@/hooks/use-skills'
import { cn } from '@/lib/utils'

export function SkillsPicker({
  visible,
  onSelectSkill,
  onClose,
  variant = 'default',
  theme = 'light',
}: {
  visible: boolean
  onSelectSkill: (command: string) => boolean | void | Promise<boolean | void>
  onClose: () => void
  variant?: 'default' | 'hervald'
  theme?: 'light' | 'dark'
}) {
  const { data: skills, isError, isLoading } = useSkills()
  const [query, setQuery] = useState('')
  const [selectingSkillName, setSelectingSkillName] = useState<string | null>(null)
  const filteredSkills = useMemo(() => {
    if (!skills) return []
    const normalized = query.trim().toLowerCase()
    if (!normalized) return skills
    return skills.filter((skill) => skill.name.toLowerCase().includes(normalized))
  }, [skills, query])

  return (
    <DismissibleOverlay
      open={visible}
      onClose={onClose}
      title="Skills"
      position="bottom-sheet"
      portalThemeClassName={theme === 'dark' ? 'hv-dark' : 'hv-light'}
      backdropClassName={cn(
        variant === 'hervald' && 'sheet-backdrop--hervald',
        variant === 'hervald' && theme === 'dark' && 'sheet-backdrop--hervald-dark',
      )}
      contentClassName={cn(
        'sheet visible',
        variant === 'hervald' && 'sheet--hervald',
        variant === 'hervald' && theme === 'dark' && 'sheet--hervald-dark',
      )}
    >
        <div className="sheet-handle">
          <div className="sheet-handle-bar" />
        </div>
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between mb-4">
            <h3
              className={cn(
                'font-display text-heading text-[color:var(--hv-fg)]',
                variant === 'hervald' && 'sheet-title--hervald',
              )}
            >
              Skills
            </h3>
            <button
              onClick={onClose}
              className={cn(
                'p-1.5 rounded-lg hover:bg-[var(--hv-surface-hover)] transition-colors',
                variant === 'hervald' && 'sheet-close--hervald',
              )}
              aria-label="Close"
            >
              <X
                size={16}
                className={cn(
                  'text-[color:var(--hv-fg-subtle)]',
                  variant === 'hervald' && 'sheet-close-icon--hervald',
                )}
              />
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={cn(
              'w-full px-3 py-2 mb-3 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] text-[16px] md:text-sm focus:outline-none focus:border-[color:var(--hv-border-soft)]',
              variant === 'hervald' && 'sheet-search--hervald',
            )}
            placeholder="Search skills..."
            aria-label="Search skills"
          />
          <div className="space-y-2 max-h-[60dvh] overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-3 h-3 rounded-full bg-[var(--hv-fg-faint)] animate-breathe" />
              </div>
            ) : isError ? (
              <div className="text-center py-8 text-[color:var(--hv-accent-danger)] text-sm">
                Unable to load skills
              </div>
            ) : skills?.length === 0 ? (
              <div className="text-center py-8 text-[color:var(--hv-fg-subtle)] text-sm">
                No user-invocable skills installed
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="text-center py-8 text-[color:var(--hv-fg-subtle)] text-sm">
                No skills match your search
              </div>
            ) : (
              filteredSkills.map((skill) => (
                <button
                  key={skill.name}
                  onClick={async () => {
                    const cmd = `/${skill.name}`
                    setSelectingSkillName(skill.name)
                    try {
                      const selected = await onSelectSkill(cmd)
                      if (selected !== false) {
                        onClose()
                      }
                    } finally {
                      setSelectingSkillName(null)
                    }
                  }}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] transition-colors',
                    '[-webkit-tap-highlight-color:transparent] [@media(hover:hover)]:hover:bg-[var(--hv-surface-hover)]',
                    variant === 'hervald' && 'sheet-skill--hervald',
                  )}
                  disabled={selectingSkillName !== null}
                >
                  <div className="flex items-center gap-2">
                    <Zap
                      size={14}
                      className={cn(
                        'text-[color:var(--hv-accent-danger)] shrink-0',
                        variant === 'hervald' && 'sheet-skill-icon--hervald',
                      )}
                    />
                    <span
                      className={cn(
                        'font-mono text-sm text-[color:var(--hv-fg)]',
                        variant === 'hervald' && 'sheet-skill-name--hervald',
                      )}
                    >
                      /{skill.name}
                    </span>
                    {selectingSkillName === skill.name && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--hv-fg-faint)]" />
                    )}
                  </div>
                  {skill.description && (
                    <p
                      className={cn(
                        'text-xs text-[color:var(--hv-fg-subtle)] mt-1.5 line-clamp-2',
                        variant === 'hervald' && 'sheet-skill-description--hervald',
                      )}
                    >
                      {skill.description}
                    </p>
                  )}
                  {skill.argumentHint && (
                    <p
                      className={cn(
                        'text-xs text-[color:var(--hv-fg-faint)] mt-1 font-mono',
                        variant === 'hervald' && 'sheet-skill-args--hervald',
                      )}
                    >
                      args: {skill.argumentHint}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
    </DismissibleOverlay>
  )
}
