export interface AutomationQuestCompletedEvent {
  event: 'completed'
  questId: string
  commanderId: string
  completedAt: string
}

export type AutomationQuestEventPayload = AutomationQuestCompletedEvent
export type AutomationQuestEventListener = (event: AutomationQuestEventPayload) => void | Promise<void>

export class AutomationQuestEventBus {
  private readonly listeners = new Set<AutomationQuestEventListener>()

  subscribe(listener: AutomationQuestEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: AutomationQuestEventPayload): void {
    for (const listener of this.listeners) {
      void Promise.resolve(listener(event)).catch((error) => {
        console.error('[automations/quest-event-bus] listener failed:', error)
      })
    }
  }
}
