/** Plugin-owned session menu actions; React-free descriptors and callbacks. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One reversible menu contribution. */
export interface SessionMenuAction {
  id: string
  label: string
  /** Optional localized progress and completion banners. */
  feedback?: { pending: string; success: string }
  run(sessionId: SessionId): Promise<void> | void
}

/** Observable registry backing the workspace menu injection. */
export class SessionMenuRegistry {
  private items: readonly SessionMenuAction[] = []
  private readonly listeners = new Set<() => void>()
  /** Stable framework-hook source; publishes registration changes. */
  readonly source = {
    getSnapshot: (): readonly SessionMenuAction[] => this.items,
    subscribe: (listener: () => void): (() => void) => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  /**
   * Register one contribution.
   * @param action - Descriptor with a unique action id.
   * @returns Disposer that withdraws only this registration.
   */
  register(action: SessionMenuAction): () => void {
    if (['rename', 'fork', 'archive'].includes(action.id) || this.items.some(item => item.id === action.id)) {
      throw new Error(`duplicate session menu action: ${action.id}`)
    }
    this.items = [...this.items, action]
    this.notify()
    return () => {
      this.items = this.items.filter(item => item !== action)
      this.notify()
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
