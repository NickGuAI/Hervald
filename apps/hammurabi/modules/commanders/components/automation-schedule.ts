export type AutomationCadence =
  | 'every-15-minutes'
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekly'

export interface AutomationScheduleState {
  cadence: AutomationCadence
  minute: string
  time: string
  weekday: string
}

export const DEFAULT_AUTOMATION_SCHEDULE: AutomationScheduleState = {
  cadence: 'daily',
  minute: '0',
  time: '09:00',
  weekday: '1',
}

export const AUTOMATION_CADENCE_OPTIONS: Array<{
  value: AutomationCadence
  label: string
}> = [
  { value: 'every-15-minutes', label: 'Every 15 minutes' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
]

export const AUTOMATION_MINUTE_OPTIONS = ['0', '15', '30', '45'].map((value) => ({
  value,
  label: `:${value.padStart(2, '0')}`,
}))

export const AUTOMATION_WEEKDAY_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
] as const

export const AUTOMATION_TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const minutesFromMidnight = index * 15
  const hours = Math.floor(minutesFromMidnight / 60)
  const minutes = minutesFromMidnight % 60
  const value = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  return {
    value,
    label: value,
  }
})

function parseTimeParts(value: string): { hour: string; minute: string } {
  const [rawHour = '00', rawMinute = '00'] = value.split(':')
  const hour = /^\d+$/.test(rawHour) ? rawHour : '00'
  const minute = /^\d+$/.test(rawMinute) ? rawMinute : '00'
  return {
    hour,
    minute,
  }
}

function formatTime(hour: string, minute: string): string {
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

export function buildAutomationSchedule(state: AutomationScheduleState): string {
  if (state.cadence === 'every-15-minutes') {
    return '*/15 * * * *'
  }

  if (state.cadence === 'hourly') {
    return `${state.minute} * * * *`
  }

  const { hour, minute } = parseTimeParts(state.time)

  if (state.cadence === 'daily') {
    return `${minute} ${hour} * * *`
  }

  if (state.cadence === 'weekdays') {
    return `${minute} ${hour} * * 1-5`
  }

  return `${minute} ${hour} * * ${state.weekday}`
}

function lookupWeekday(dayOfWeek: string): string | null {
  const normalized = dayOfWeek === '7' ? '0' : dayOfWeek
  const option = AUTOMATION_WEEKDAY_OPTIONS.find((entry) => entry.value === normalized)
  return option?.label ?? null
}

export function describeAutomationSchedule(expression: string): string {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return expression
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return expression
  }

  const isWildcardDate = dayOfMonth === '*' && month === '*'

  if (expression.trim() === '*/15 * * * *') {
    return 'Every 15 minutes'
  }

  if (/^\d+$/.test(minute) && hour === '*' && isWildcardDate && dayOfWeek === '*') {
    return `Every hour at :${minute.padStart(2, '0')}`
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && isWildcardDate && dayOfWeek === '*') {
    return `Every day at ${formatTime(hour, minute)}`
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && isWildcardDate && dayOfWeek === '1-5') {
    return `Every weekday at ${formatTime(hour, minute)}`
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && isWildcardDate) {
    const weekday = lookupWeekday(dayOfWeek)
    if (weekday) {
      return `Every ${weekday} at ${formatTime(hour, minute)}`
    }
  }

  return expression
}
