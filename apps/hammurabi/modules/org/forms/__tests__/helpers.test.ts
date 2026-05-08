import { describe, expect, it } from 'vitest'
import {
  buildAutomationScheduleFromPreset,
  buildNewAutomationCreateRequestBody,
  looksLikeCronExpression,
  validateNewAutomationWizardStep,
} from '../helpers'

const PROVIDERS = [
  {
    id: 'claude',
    label: 'Claude',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
  },
  {
    id: 'gemini',
    label: 'Gemini',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    capabilities: {
      supportsAutomation: true,
      supportsCommanderConversation: true,
      supportsWorkerDispatch: true,
    },
  },
] as const

describe('org wizard helpers', () => {
  it('validates cron-like expressions', () => {
    expect(looksLikeCronExpression('0 9 * * *')).toBe(true)
    expect(looksLikeCronExpression('*/5 * * * *')).toBe(true)
    expect(looksLikeCronExpression('every morning')).toBe(false)
  })

  it('builds schedule and quest automation payloads', () => {
    expect(buildAutomationScheduleFromPreset('every-5-minutes', '')).toBe('*/5 * * * *')
    expect(buildAutomationScheduleFromPreset('custom', ' 0 9 * * * ')).toBe('0 9 * * *')

    const invalid = validateNewAutomationWizardStep({
      trigger: 'schedule',
      cadencePreset: 'custom',
      customCron: 'bad cron',
      questCommanderId: '',
      name: 'Daily Briefing',
      instruction: 'Summarize updates.',
      agentType: 'claude',
    }, 'details', {
      existingAutomationNames: [],
      commanders: [{ id: 'cmd-1', displayName: 'Atlas' }],
      providers: PROVIDERS as never,
    })

    expect(invalid.cron).toBe('Cron expression must contain exactly five fields.')

    expect(buildNewAutomationCreateRequestBody({
      trigger: 'quest',
      cadencePreset: 'every-5-minutes',
      customCron: '',
      questCommanderId: 'cmd-1',
      name: ' Quest ping ',
      instruction: ' Notify the team. ',
      agentType: 'gemini',
    }, {
      existingAutomationNames: [],
      commanders: [{ id: 'cmd-1', displayName: 'Atlas' }],
      owner: {
        kind: 'commander',
        id: 'cmd-7',
        displayName: 'Hermes',
      },
      providers: PROVIDERS as never,
    })).toEqual({
      name: 'Quest ping',
      parentCommanderId: 'cmd-7',
      trigger: 'quest',
      questTrigger: {
        event: 'completed',
        commanderId: 'cmd-1',
      },
      instruction: 'Notify the team.',
      agentType: 'gemini',
      status: 'active',
    })
  })
})
