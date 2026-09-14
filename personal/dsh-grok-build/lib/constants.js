export const GROK_PRESET_ID = 'grok'
export const GROK_PROVIDER = 'grok-build'
export const DEFAULT_GROK_MODEL = 'dsh-grok-46'
export const PRESET_FINGERPRINT = 'Shipped by dsh-grok-build'

/** Map a DSH picker id onto a Grok Build catalog id. */
export function resolveGrokModelId(model) {
  if (typeof model !== 'string' || model.length === 0) return DEFAULT_GROK_MODEL
  if (model === 'grok-4.6' || model === 'grok-4.5' || model === 'grok-4') return DEFAULT_GROK_MODEL
  return model
}

export const NO_RETRY_POLICY = Object.freeze({
  mode: 'normal',
  maxRetries: 0,
  retryableCodes: Object.freeze([]),
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  jitterRatio: 0.1,
})

export const REASONING_EFFORTS = Object.freeze([
  { id: 'low', name: 'Low', description: 'Grok Build low reasoning effort' },
  { id: 'medium', name: 'Medium', description: 'Grok Build medium reasoning effort' },
  { id: 'high', name: 'High', description: 'Grok Build high reasoning effort' },
  { id: 'xhigh', name: 'xHigh', description: 'Grok Build extra-high reasoning effort' },
])
