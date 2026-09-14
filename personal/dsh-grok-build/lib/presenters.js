function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function str(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function resultText(result) {
  return result.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

function firstPath(args) {
  const arguments_ = record(args)
  return str(arguments_?.path)
    ?? str(arguments_?.file_path)
    ?? str(arguments_?.filePath)
    ?? str(arguments_?.target)
    ?? str(arguments_?.filename)
}

function commandOf(args) {
  const arguments_ = record(args)
  return str(arguments_?.command) ?? str(arguments_?.cmd) ?? str(arguments_?.shell)
}

function queryOf(args) {
  const arguments_ = record(args)
  return str(arguments_?.pattern) ?? str(arguments_?.query) ?? str(arguments_?.q)
}

function diffsFromArgs(args) {
  const arguments_ = record(args)
  const path = firstPath(args)
  if (path === undefined) return undefined
  const newText = str(arguments_?.new_string) ?? str(arguments_?.newText) ?? str(arguments_?.content)
  if (typeof newText !== 'string') return undefined
  return [{
    path,
    oldText: str(arguments_?.old_string) ?? str(arguments_?.oldText) ?? null,
    newText,
  }]
}

function terminalCallView(args) {
  const command = commandOf(args)
  if (command === undefined) return undefined
  return {
    card: 'terminal',
    title: command,
    ...str(record(args)?.description) === undefined ? {} : { description: str(record(args).description) },
  }
}

function terminalResultView(_args, result) {
  const output = resultText(result)
  return output.length === 0 ? undefined : { card: 'terminal', output }
}

function readCallView(args) {
  const path = firstPath(args)
  if (path === undefined) return undefined
  const offset = typeof record(args)?.offset === 'number' ? record(args).offset : undefined
  return {
    card: 'generic',
    kind: 'read',
    title: `Read ${path}`,
    locations: [{ path, ...offset === undefined ? {} : { line: offset } }],
  }
}

function diffCallView(args) {
  const path = firstPath(args)
  const diffs = diffsFromArgs(args)
  if (path === undefined) return undefined
  if (diffs === undefined) {
    return {
      card: 'generic',
      kind: 'edit',
      title: `Edit ${path}`,
      locations: [{ path }],
      rawInput: args,
    }
  }
  return {
    card: 'diff',
    title: `Edit ${path}`,
    diffs,
    locations: [{ path }],
  }
}

function diffResultView(args, result) {
  if (result.isError) return undefined
  const diffs = diffsFromArgs(args)
  return diffs === undefined ? undefined : { card: 'diff', diffs }
}

function searchCallView(args) {
  const query = queryOf(args) ?? firstPath(args)
  if (query === undefined) return undefined
  const scope = firstPath(args)
  return {
    card: 'generic',
    kind: 'search',
    title: scope === undefined || scope === query ? query : `${query} · ${scope}`,
    rawInput: args,
  }
}

function fetchCallView(args) {
  const url = str(record(args)?.url)
  if (url === undefined) return undefined
  return {
    card: 'generic',
    kind: 'fetch',
    title: url,
    rawInput: args,
  }
}

function genericCallView(toolName) {
  return (args) => ({
    card: 'generic',
    kind: 'other',
    title: str(record(args)?.description) ?? toolName,
    rawInput: args,
  })
}

function presenterDefinition(name, presentCall, presentResult) {
  return {
    name,
    description: 'Presentation mirror of a Grok Build tool; execution is owned by Grok Build.',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'object', properties: {} },
      render: () => [],
    },
    execute: async () => {
      throw new Error(`dsh-grok-build: Grok Build owns execution of ${name}`)
    },
    ...presentCall === undefined ? {} : { presentCall },
    ...presentResult === undefined ? {} : { presentResult },
  }
}

const STATIC_PRESENTERS = [
  presenterDefinition('run_terminal_command', terminalCallView, terminalResultView),
  presenterDefinition('bash', terminalCallView, terminalResultView),
  presenterDefinition('shell', terminalCallView, terminalResultView),
  presenterDefinition('read_file', readCallView),
  presenterDefinition('read', readCallView),
  presenterDefinition('list_dir', searchCallView),
  presenterDefinition('search_replace', diffCallView, diffResultView),
  presenterDefinition('edit', diffCallView, diffResultView),
  presenterDefinition('write', diffCallView, diffResultView),
  presenterDefinition('grep', searchCallView),
  presenterDefinition('glob', searchCallView),
  presenterDefinition('web_search', searchCallView),
  presenterDefinition('web_fetch', fetchCallView),
  presenterDefinition('todo_write', genericCallView('Update todos')),
  presenterDefinition('spawn_subagent', genericCallView('Subagent')),
]

export const GROK_PRESENTER_NAMES = new Set(STATIC_PRESENTERS.map((definition) => definition.name))

export function grokPresenterDefinitions() {
  return STATIC_PRESENTERS
}

export function dynamicPresenterDefinition(name) {
  return presenterDefinition(name, genericCallView(name))
}

export function toolRegistryName(raw, fallback = 'grok-tool') {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(raw)) return raw
  const sanitized = raw.replaceAll(/[^A-Za-z0-9_-]+/g, '-').replaceAll(/^-+|-+$/g, '')
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(sanitized)) return sanitized
  const prefixed = `g-${sanitized}`.replaceAll(/[^A-Za-z0-9_-]+/g, '-')
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(prefixed) ? prefixed : fallback
}
