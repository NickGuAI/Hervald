import type { ComposerAbilitySettings } from './composer-abilities.js'
import type { ComposerSkillSlotSettings } from './composer-skill-slots.js'

export type AppTheme = 'light' | 'dark'

export interface AppSettings {
  theme: AppTheme
  fontScale: number
  composerAbilities: ComposerAbilitySettings
  composerSkillSlots: ComposerSkillSlotSettings
  updatedAt: string
}
