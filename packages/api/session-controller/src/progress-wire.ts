/** Personal Kimi progress snapshots are summaries on the wire; durable logs remain intact. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionWireEvent } from './types.ts'

function object(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

/** Preserve event sequence and identity while avoiding repeated full native transcripts. */
export function progressWireEvent(event: SessionWireEvent): SessionWireEvent {
  if (event.type !== 'kimi/progress') return event
  const data = object(event.data)
  const turn = object(data?.turn)
  if (data === undefined || turn === undefined) return event
  const summary: Record<string, JsonValue> = {}
  for (const key of ['turnId', 'triggerPromptId', 'state', 'agentId']) {
    if (turn[key] !== undefined) summary[key] = turn[key]
  }
  summary.steps = []
  return { ...event, data: { ...data, turn: summary } }
}
