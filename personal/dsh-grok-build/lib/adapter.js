import { LlmAdapter, ReasoningEffortId, ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { DEFAULT_GROK_MODEL, GROK_PRESET_ID, GROK_PROVIDER, NO_RETRY_POLICY, REASONING_EFFORTS, resolveGrokModelId } from './constants.js'
import { dynamicPresenterDefinition, GROK_PRESENTER_NAMES, toolRegistryName } from './presenters.js'

function abortIfRequested(signal) {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('Grok Build input resolution aborted')
  error.name = 'AbortError'
  throw error
}

function auxiliaryText(messages) {
  return messages.flatMap((message) => message.content.filter((block) => block.type === 'text').map((block) => block.text)).join('\n')
}

function resolveAgent(agents, options) {
  const initiator = agents.currentInitiator()
  if (initiator !== undefined) return initiator
  if (options.sessionId !== undefined) {
    const agent = agents.get(options.sessionId)
    if (agent !== undefined) return agent
  }
  throw new Error('dsh-grok-build: the model request has no live owning DSH agent')
}

function jsonText(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

function argumentsJson(value) {
  if (typeof value === 'string') return value
  const text = jsonText(value)
  return text.length === 0 ? '{}' : text
}

function resultTextFromUpdate(update) {
  const parts = []
  for (const item of update.content ?? []) {
    if (item?.type === 'content' && item.content?.type === 'text' && typeof item.content.text === 'string') {
      parts.push(item.content.text)
    } else if (item?.type === 'terminal' && typeof item.terminalId === 'string') {
      parts.push(`[terminal ${item.terminalId}]`)
    } else if (item?.type === 'diff' && typeof item.path === 'string') {
      parts.push(`diff ${item.path}`)
    }
  }
  if (parts.length === 0) {
    const raw = jsonText(update.rawOutput)
    if (raw.length > 0) parts.push(raw)
  }
  return parts.join('\n\n')
}

function diffsFromUpdate(update) {
  const diffs = []
  for (const item of update.content ?? []) {
    if (item?.type !== 'diff' || typeof item.path !== 'string' || typeof item.newText !== 'string') continue
    diffs.push({
      path: item.path,
      oldText: typeof item.oldText === 'string' ? item.oldText : null,
      newText: item.newText,
    })
  }
  return diffs
}

function currentCursor(agent, sessionProjections) {
  const boundary = sessionProjections?.stateOf?.(agent.session, 'turnBoundary')
  if (boundary?.lastTurn) {
    let step = 1
    if (boundary.lastStepStartSeq != null) {
      const event = agent.session.eventAt(boundary.lastStepStartSeq)
      if (event?.type === 'step/start' && typeof event.data?.step === 'number') step = event.data.step
    }
    return { turn: boundary.lastTurn, step }
  }
  let turn = 0
  let step = 1
  for (const event of agent.session.snapshotEvents()) {
    if (event.type === 'turn/start' && typeof event.data?.turn === 'number') turn = event.data.turn
    if (event.type === 'step/start' && typeof event.data?.step === 'number') step = event.data.step
  }
  return { turn, step }
}

async function resolveDirectUserPrompt(messages, attachments, signal) {
  const message = [...messages].reverse().find((candidate) => candidate.role === 'user' && candidate.source?.kind === 'user')
  if (message === undefined) throw new Error('dsh-grok-build: no direct human input was present in this model step')
  const imageRefs = message.content.filter((block) => block.type === 'image').map((block) => block.attachment)
  const limits = attachments.imageLimits
  if (imageRefs.length > limits.maxImagesPerMessage) throw new Error('dsh-grok-build: prompt exceeds the configured image-count limit')
  let declaredBytes = 0
  imageRefs.forEach((ref, index) => {
    declaredBytes += ref.bytes
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > limits.maxMessageImageBytes) {
      throw new Error('dsh-grok-build: prompt exceeds the configured aggregate image-byte limit')
    }
    if (index >= 0 && !limits.mediaTypes.includes(ref.mediaType)) {
      throw new Error(`dsh-grok-build: image ${index + 1} uses an unsupported media type`)
    }
  })
  const prompt = []
  let imageIndex = 0
  let verifiedBytes = 0
  for (const block of message.content) {
    abortIfRequested(signal)
    if (block.type === 'text') {
      if (block.text.length > 0) prompt.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'file') {
      prompt.push({ type: 'text', text: `[file attached: ${block.attachment.name}]` })
      continue
    }
    if (block.type !== 'image') continue
    imageIndex += 1
    const stored = await attachments.readImage(block.attachment, signal)
    abortIfRequested(signal)
    if (stored.data.byteLength !== stored.ref.bytes || stored.ref.mediaType !== block.attachment.mediaType) {
      throw new Error(`dsh-grok-build: image ${imageIndex} failed attachment verification`)
    }
    verifiedBytes += stored.data.byteLength
    if (!Number.isSafeInteger(verifiedBytes) || verifiedBytes > limits.maxMessageImageBytes) {
      throw new Error('dsh-grok-build: prompt exceeds the configured aggregate image-byte limit')
    }
    prompt.push({
      type: 'image',
      data: Buffer.from(stored.data.buffer, stored.data.byteOffset, stored.data.byteLength).toString('base64'),
      mimeType: stored.ref.mediaType,
    })
  }
  if (prompt.length === 0) throw new Error('dsh-grok-build: the newest direct human message has no supported content')
  return prompt
}

export class GrokBuildAdapter extends LlmAdapter {
  constructor(host, agents, attachments, sessionProjections, presetIdFor) {
    super()
    this.host = host
    this.agents = agents
    this.attachments = attachments
    this.sessionProjections = sessionProjections
    this.presetIdFor = presetIdFor
    this.dynamicPresenters = new WeakMap()
  }

  providerInfo(provider) {
    return { id: provider, name: 'Grok Build' }
  }

  providerRetryPolicy() {
    return NO_RETRY_POLICY
  }

  async listModels(provider) {
    const models = this.host.models
    if (!Array.isArray(models) || models.length === 0) {
      return [{
        provider,
        id: DEFAULT_GROK_MODEL,
        name: 'Grok 4.6 (DSH gateway)',
        inputModalities: ['text', 'image'],
      }]
    }
    return models.map((model) => {
      const id = model.modelId ?? model.id ?? DEFAULT_GROK_MODEL
      return {
        provider,
        id,
        name: model.name ?? model.displayName ?? id,
        inputModalities: ['text', 'image'],
      }
    })
  }

  async resolveModel(provider, model) {
    const id = resolveGrokModelId(model)
    const known = (await this.listModels(provider)).find((entry) => entry.id === id)
    return {
      provider,
      id,
      name: known?.name ?? `Grok Build ${id}`,
      inputModalities: ['text', 'image'],
      reasoning: {
        efforts: REASONING_EFFORTS.map((effort) => ({
          id: ReasoningEffortId(effort.id),
          name: effort.name,
          description: effort.description,
        })),
      },
    }
  }

  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    }
  }

  async *#titleStream(options) {
    const title = auxiliaryText(options.messages).split(/\s+/).slice(0, 8).join(' ') || 'Grok Build'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: title }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: title } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  ensurePresenter(agent, name) {
    if (GROK_PRESENTER_NAMES.has(name)) return
    let known = this.dynamicPresenters.get(agent)
    if (known === undefined) {
      known = new Set()
      this.dynamicPresenters.set(agent, known)
    }
    if (known.has(name)) return
    try {
      agent.ctx.tools.register(dynamicPresenterDefinition(name))
      known.add(name)
    } catch {
      // Presentation is best-effort; a colliding name keeps the generic card.
    }
  }

  appendToolCall(agent, cursor, callId, name, args) {
    this.ensurePresenter(agent, name)
    try {
      agent.session.append('tool/call', {
        turn: cursor.turn,
        step: cursor.step,
        callId: ToolCallId(callId),
        name,
        arguments: argumentsJson(args),
      })
    } catch {
      // Presentation is best-effort.
    }
  }

  appendToolResult(agent, cursor, callId, text, isError, diffs) {
    try {
      agent.session.append('tool/result', {
        turn: cursor.turn,
        step: cursor.step,
        message: createToolResultMessage({
          callId: ToolCallId(callId),
          content: text.length === 0 ? [] : [{ type: 'text', text }],
          isError,
        }),
        ...diffs.length === 0 ? {} : { meta: { diffs } },
      }, { surfaceOp: 'append' })
    } catch {
      // Presentation is best-effort.
    }
  }

  async *stream(options) {
    if (options.purpose === 'session-title') {
      yield* this.#titleStream(options)
      return
    }
    if (options.purpose !== undefined) {
      throw new Error(`dsh-grok-build: auxiliary ${options.purpose} calls are not routed into the Grok session`)
    }
    const agent = resolveAgent(this.agents, options)
    if (this.presetIdFor(agent) !== GROK_PRESET_ID) {
      throw new Error(`dsh-grok-build: provider ${GROK_PROVIDER} is available only to the ${GROK_PRESET_ID} preset`)
    }
    let prompt
    try {
      prompt = await resolveDirectUserPrompt(options.messages, this.attachments, options.signal)
    } catch (error) {
      if (error.name !== 'AbortError') throw error
      yield {
        type: 'finish',
        reason: {
          kind: 'aborted',
          failure: {
            code: 'aborted',
            message: error instanceof Error ? error.message : 'Grok Build input resolution aborted',
          },
        },
      }
      return
    }

    const cursor = currentCursor(agent, this.sessionProjections)
    const openCalls = new Map()
    let text = ''
    let reasoning = ''
    let blockIndex = 0
    let textStarted = false
    let reasoningStarted = false
    let completed = false
    let pendingUsage

    const flushText = function* flush(kind) {
      if (kind === 'reasoning') {
        if (!reasoningStarted || reasoning.length === 0) return
        yield { type: 'block-end', index: blockIndex, block: { type: 'reasoning', text: reasoning } }
        reasoningStarted = false
        reasoning = ''
        blockIndex += 1
        return
      }
      if (!textStarted || text.length === 0) return
      yield { type: 'block-end', index: blockIndex, block: { type: 'text', text } }
      textStarted = false
      text = ''
      blockIndex += 1
    }

    try {
      if (options.model) {
        try {
          const remoteId = await this.host.ensureAgentSession(agent)
          await this.host.setConfigOption(remoteId, 'model', resolveGrokModelId(options.model))
        } catch {
          // Model selection is best-effort; the Grok session default still runs.
        }
      }
      if (options.reasoningEffort) {
        try {
          const remoteId = await this.host.ensureAgentSession(agent)
          await this.host.setConfigOption(remoteId, 'reasoning_effort', String(options.reasoningEffort))
        } catch {
          // Effort selection is best-effort.
        }
      }

      const stream = this.host.streamTurn(agent, prompt, options.signal)
      let response
      while (true) {
        const next = await stream.next()
        if (next.done) {
          response = next.value
          break
        }
        const update = next.value
        const kind = update?.sessionUpdate
        if (kind === 'agent_thought_chunk' && update.content?.type === 'text') {
          if (textStarted) yield* flushText('text')
          if (!reasoningStarted) {
            yield { type: 'block-start', index: blockIndex, blockType: 'reasoning' }
            reasoningStarted = true
          }
          reasoning += update.content.text
          yield { type: 'reasoning-delta', index: blockIndex, text: update.content.text }
          continue
        }
        if (kind === 'agent_message_chunk' && update.content?.type === 'text') {
          if (reasoningStarted) yield* flushText('reasoning')
          if (!textStarted) {
            yield { type: 'block-start', index: blockIndex, blockType: 'text' }
            textStarted = true
          }
          text += update.content.text
          yield { type: 'text-delta', index: blockIndex, text: update.content.text }
          continue
        }
        if (kind === 'tool_call') {
          const id = update.toolCallId
          if (typeof id !== 'string' || openCalls.has(id)) continue
          const name = toolRegistryName(update.name ?? update.title ?? update.kind, 'grok-tool')
          openCalls.set(id, name)
          this.appendToolCall(agent, cursor, id, name, update.rawInput ?? {})
          continue
        }
        if (kind === 'tool_call_update') {
          const id = update.toolCallId
          if (typeof id !== 'string') continue
          if (!openCalls.has(id) && (update.name || update.title || update.rawInput !== undefined)) {
            const name = toolRegistryName(update.name ?? update.title ?? update.kind, 'grok-tool')
            openCalls.set(id, name)
            this.appendToolCall(agent, cursor, id, name, update.rawInput ?? {})
          }
          if (update.status === 'completed' || update.status === 'failed') {
            const name = openCalls.get(id)
            if (name === undefined) continue
            openCalls.delete(id)
            this.appendToolResult(
              agent,
              cursor,
              id,
              resultTextFromUpdate(update),
              update.status === 'failed',
              diffsFromUpdate(update),
            )
          }
          continue
        }
        if (kind === 'usage_update' && typeof update.used === 'number') {
          pendingUsage = {
            inputTokens: update.used,
            outputTokens: 0,
            ...typeof update.size === 'number' ? { totalTokens: update.size } : {},
          }
        }
      }

      yield* flushText('reasoning')
      yield* flushText('text')
      for (const [id] of openCalls) {
        this.appendToolResult(agent, cursor, id, 'Grok ended the turn without a terminal tool update', true, [])
      }
      if (pendingUsage !== undefined) yield { type: 'usage', usage: pendingUsage }
      completed = true
      if (response?.stopReason === 'max_tokens') {
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      } else if (response?.stopReason === 'cancelled' || options.signal?.aborted) {
        yield {
          type: 'finish',
          reason: {
            kind: 'aborted',
            failure: { code: 'aborted', message: 'Grok Build turn cancelled' },
          },
        }
      } else {
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    } catch (error) {
      if (error?.name === 'AbortError' || options.signal?.aborted) {
        yield* flushText('reasoning')
        yield* flushText('text')
        yield {
          type: 'finish',
          reason: {
            kind: 'aborted',
            failure: {
              code: 'aborted',
              message: error instanceof Error ? error.message : 'Grok Build turn aborted',
            },
          },
        }
        return
      }
      throw error
    }
    if (!completed) throw new Error('dsh-grok-build: Grok turn stream ended without a result')
  }
}

export function createGrokBuildAdapter(host, agents, attachments, sessionProjections, presetIdFor) {
  return new GrokBuildAdapter(host, agents, attachments, sessionProjections, presetIdFor)
}
