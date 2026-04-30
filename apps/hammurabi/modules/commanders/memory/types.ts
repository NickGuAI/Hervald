export interface GoalEntry {
  id: string
  title: string
  targetDate: string // YYYY-MM-DD
  currentState: string
  intendedState: string
  reminders: string[]
}
