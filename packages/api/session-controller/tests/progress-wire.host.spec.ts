import { expect, it } from 'vitest'
import { progressWireEvent } from '../src/progress-wire.ts'

it('keeps durable progress untouched and sends only its identity and status', () => {
  const event = { type: 'kimi/progress', seq: 7, time: 8, data: {
    promptId: 'p', nativeId: 'n', turn: { turnId: 't', state: 'running', steps: [{ text: 'x'.repeat(1000000) }] },
  } }
  const result = progressWireEvent(event)
  expect(result).toEqual({ ...event, data: { ...event.data, turn: { turnId: 't', state: 'running', steps: [] } } })
  expect(event.data.turn.steps[0]?.text.length).toBe(1000000)
  expect(progressWireEvent({ ...event, type: 'kimi/transcript' }).data).toBe(event.data)
})

it('preserves unknown and malformed event shapes', () => {
  for (const data of [null, [], {}, { turn: null }]) {
    const event = { type: 'kimi/progress', seq: 0, time: 0, data }
    expect(progressWireEvent(event)).toBe(event)
  }
})
