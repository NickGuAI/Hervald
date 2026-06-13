import type { FormEvent } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { useProviderRegistry } from '@/hooks/use-providers'
import { useSkills } from '@/hooks/use-skills'
import type { AgentType } from '@/types'
import { cn } from '@/lib/utils'
import { DirectoryPicker } from '../../agents/components/DirectoryPicker'

export type QuestSource = 'idea' | 'github-issue' | 'manual' | 'voice-log'
export type QuestAgentType = AgentType
export type QuestPermissionMode = 'default'
export type QuestArtifactType = 'github_issue' | 'github_pr' | 'url' | 'file'

export interface QuestArtifact {
  type: QuestArtifactType
  label: string
  href: string
}

const QUEST_SOURCES: Array<{ value: QuestSource; label: string }> = [
  { value: 'manual', label: 'manual' },
  { value: 'github-issue', label: 'github-issue' },
  { value: 'idea', label: 'idea' },
  { value: 'voice-log', label: 'voice-log' },
]

const QUEST_ARTIFACT_TYPES: Array<{ value: QuestArtifactType; label: string }> = [
  { value: 'github_issue', label: 'github_issue' },
  { value: 'github_pr', label: 'github_pr' },
  { value: 'url', label: 'url' },
  { value: 'file', label: 'file' },
]

export const QUEST_ARTIFACT_PREFIX: Record<QuestArtifactType, string> = {
  github_issue: 'issue',
  github_pr: 'PR',
  url: 'url',
  file: 'file',
}

interface QuestCreateFormProps {
  source: QuestSource
  onSourceChange: (source: QuestSource) => void
  githubIssueUrl: string
  onGitHubIssueUrlChange: (value: string) => void
  onFetchIssue: () => void
  fetchingIssue: boolean
  instruction: string
  onInstructionChange: (value: string) => void
  cwd: string
  onCwdChange: (value: string) => void
  directoryHost?: string
  agentType: QuestAgentType
  onAgentTypeChange: (value: QuestAgentType) => void
  permissionMode: QuestPermissionMode
  onPermissionModeChange: (value: QuestPermissionMode) => void
  selectedSkills: string[]
  onSelectedSkillsChange: (value: string[]) => void
  artifacts: QuestArtifact[]
  showArtifactForm: boolean
  onToggleArtifactForm: () => void
  artifactType: QuestArtifactType
  onArtifactTypeChange: (value: QuestArtifactType) => void
  artifactLabel: string
  onArtifactLabelChange: (value: string) => void
  artifactHref: string
  onArtifactHrefChange: (value: string) => void
  onAddArtifact: () => void
  onRemoveArtifact: (indexToRemove: number) => void
  formError: string | null
  submitPending: boolean
  canClearDraft: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClearDraft: () => void
}

export function QuestCreateForm({
  source,
  onSourceChange,
  githubIssueUrl,
  onGitHubIssueUrlChange,
  onFetchIssue,
  fetchingIssue,
  instruction,
  onInstructionChange,
  cwd,
  onCwdChange,
  directoryHost,
  agentType,
  onAgentTypeChange,
  permissionMode,
  onPermissionModeChange,
  selectedSkills,
  onSelectedSkillsChange,
  artifacts,
  showArtifactForm,
  onToggleArtifactForm,
  artifactType,
  onArtifactTypeChange,
  artifactLabel,
  onArtifactLabelChange,
  artifactHref,
  onArtifactHrefChange,
  onAddArtifact,
  onRemoveArtifact,
  formError,
  submitPending,
  canClearDraft,
  onSubmit,
  onClearDraft,
}: QuestCreateFormProps) {
  const { data: providers = [] } = useProviderRegistry()
  const {
    data: skills,
    error: skillsError,
    isError: skillsIsError,
    isLoading: skillsLoading,
    refetch: refetchSkills,
  } = useSkills()
  const skillList = skills ?? []
  const selectedSkillSet = new Set(selectedSkills)

  function toggleSkill(skillName: string): void {
    if (selectedSkillSet.has(skillName)) {
      onSelectedSkillsChange(selectedSkills.filter((selectedSkill) => selectedSkill !== skillName))
      return
    }
    onSelectedSkillsChange([...selectedSkills, skillName])
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm text-sumi-gray">Add quest</p>

      <div>
        <label className="section-title block mb-2">Source</label>
        <div className="flex flex-wrap gap-2">
          {QUEST_SOURCES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSourceChange(opt.value)}
              className={cn(
                'rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors',
                source === opt.value
                  ? 'border-sumi-black bg-sumi-black text-washi-aged'
                  : 'border-ink-border bg-washi-aged text-sumi-black hover:border-ink-border-hover',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {source === 'github-issue' && (
        <div>
          <label className="section-title block mb-2">GitHub Issue URL</label>
          <div className="flex gap-2">
            <input
              value={githubIssueUrl}
              onChange={(event) => onGitHubIssueUrlChange(event.target.value)}
              placeholder="https://github.com/owner/repo/issues/412"
              className="flex-1 px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
            />
            <button
              type="button"
              onClick={onFetchIssue}
              disabled={fetchingIssue || !githubIssueUrl.trim()}
              className="px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-xs hover:bg-ink-wash disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {fetchingIssue ? 'Fetching...' : 'Fetch'}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="section-title block mb-2">Instruction</label>
        <textarea
          value={instruction}
          onChange={(event) => onInstructionChange(event.target.value)}
          placeholder="Investigate Auth0 token expiry on mobile sessions"
          className="w-full min-h-20 px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="section-title block mb-2">cwd</label>
          <DirectoryPicker value={cwd} onChange={onCwdChange} host={directoryHost} />
        </div>
        <div>
          <label className="section-title block mb-2">agentType</label>
          <select
            value={agentType}
            onChange={(event) => onAgentTypeChange(event.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="section-title block mb-2">permissionMode</label>
          <select
            value={permissionMode}
            onChange={(event) => onPermissionModeChange(event.target.value as QuestPermissionMode)}
            className="w-full px-3 py-2 rounded-lg border border-ink-border bg-washi-aged text-[16px] md:text-sm focus:outline-none focus:border-ink-border-hover"
          >
            <option value="default">default</option>
          </select>
        </div>
      </div>

      <div>
        <label className="section-title block mb-2">Skills</label>
        <div
          className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2"
          role="group"
          aria-label="Skills to use"
        >
          {skillsLoading ? (
            <p className="text-sm text-sumi-diluted">Loading skills...</p>
          ) : skillsIsError ? (
            <div className="text-sm text-accent-vermillion">
              <p>{skillsError instanceof Error ? skillsError.message : 'Unable to load skills.'}</p>
              <button
                type="button"
                className="mt-1 font-mono text-xs underline"
                onClick={() => {
                  void refetchSkills()
                }}
              >
                Retry
              </button>
            </div>
          ) : skillList.length === 0 ? (
            <p className="text-sm text-sumi-diluted">No user-invocable skills installed.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {skillList.map((skill) => (
                <label key={skill.name} className="flex items-start gap-2 text-sm text-sumi-gray">
                  <input
                    type="checkbox"
                    checked={selectedSkillSet.has(skill.name)}
                    onChange={() => toggleSkill(skill.name)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono text-sumi-black">/{skill.name}</span>
                    {skill.description ? (
                      <span className="mt-0.5 block text-xs text-sumi-diluted">{skill.description}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="section-title">Artifacts</label>
          <button
            type="button"
            onClick={onToggleArtifactForm}
            className="rounded-lg border border-ink-border bg-washi-aged px-2 py-1 text-xs hover:bg-ink-wash transition-colors"
          >
            {showArtifactForm ? 'Cancel' : 'Add artifact'}
          </button>
        </div>

        {artifacts.length > 0 && (
          <div className="space-y-1">
            {artifacts.map((artifact, index) => (
              <div
                key={`${artifact.type}-${artifact.href}-${index}`}
                className="flex items-center justify-between gap-2 rounded border border-ink-border bg-washi-aged px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate">
                  [{QUEST_ARTIFACT_PREFIX[artifact.type]}] {artifact.label} ({artifact.href})
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveArtifact(index)}
                  className="rounded border border-ink-border px-1.5 py-0.5 text-[10px] hover:bg-ink-wash transition-colors shrink-0"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {showArtifactForm && (
          <div className="rounded-lg border border-ink-border bg-washi-aged/60 p-2 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select
                value={artifactType}
                onChange={(event) => onArtifactTypeChange(event.target.value as QuestArtifactType)}
                className="w-full px-2 py-1.5 rounded border border-ink-border bg-washi-aged text-[16px] md:text-xs focus:outline-none focus:border-ink-border-hover"
              >
                {QUEST_ARTIFACT_TYPES.map((typeOption) => (
                  <option key={typeOption.value} value={typeOption.value}>
                    {typeOption.label}
                  </option>
                ))}
              </select>
              <input
                value={artifactLabel}
                onChange={(event) => onArtifactLabelChange(event.target.value)}
                placeholder="Label"
                className="w-full px-2 py-1.5 rounded border border-ink-border bg-washi-aged text-[16px] md:text-xs focus:outline-none focus:border-ink-border-hover"
              />
              <input
                value={artifactHref}
                onChange={(event) => onArtifactHrefChange(event.target.value)}
                placeholder="https://github.com/... or path"
                className="w-full px-2 py-1.5 rounded border border-ink-border bg-washi-aged text-[16px] md:text-xs focus:outline-none focus:border-ink-border-hover"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onAddArtifact}
                className="rounded-lg border border-ink-border bg-washi-aged px-2 py-1 text-xs hover:bg-ink-wash transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {formError && (
        <div className="flex items-start gap-2 rounded-lg bg-accent-vermillion/10 px-3 py-2 text-sm text-accent-vermillion">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={submitPending}
          className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          <Plus size={14} />
          {submitPending ? 'Adding...' : 'Add Quest'}
        </button>
        <button
          type="button"
          disabled={submitPending || !canClearDraft}
          className="rounded-lg border border-ink-border px-3 py-2 text-sm hover:bg-ink-wash transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={onClearDraft}
        >
          Clear draft
        </button>
      </div>
    </form>
  )
}
