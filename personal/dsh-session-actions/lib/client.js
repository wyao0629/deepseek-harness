window.__ModuleLoader__.load({id:'dsh-session-actions',factory:()=>{
/** Copyable links never include authentication query parameters. */
function sessionLink(base, sessionId) {
  const url = new URL(base)
  url.search = ''
  url.hash = ''
  url.searchParams.set('dshSession', sessionId)
  return url.href
}

/** Export settled user/assistant text, preserving authored Markdown and code. */
function markdown(records, title, link) {
  const rows = []
  const seen = new Set()
  for (const record of [...records].sort((a, b) => a.event.seq - b.event.seq)) {
    const event = record.event
    if (seen.has(event.seq)) continue
    seen.add(event.seq)
    if (!['user/message', 'assistant/message'].includes(event.type)) continue
    const message = event.type === 'user/message' ? event.data : event.data.message
    const body = (message?.content ?? []).map(block => {
      if (block.type === 'text') return block.text
      if (block.type === 'image') return '[图片附件]'
      return ''
    }).filter(Boolean).join('\n\n')
    if (body) rows.push(`## ${event.type === 'user/message' ? '用户' : '助手'}\n\n${body}`)
  }
  return `# ${title.replace(/[\r\n]+/g, ' ')}\n\n会话链接：${link}\n\n${rows.join('\n\n---\n\n')}\n`
}

/** Read a fixed history cut without navigating or touching the running turn. */
async function readConversation(remote, sessionId, signal) {
  const address = { kind: 'session', sessionId }
  const followAbort = new AbortController()
  let snapshot
  try {
    for await (const frame of remote.session.follow({ address, maxMessages: 100 }, AbortSignal.any([signal, followAbort.signal]))) {
      if (frame.type === 'snapshot') { snapshot = frame; break }
    }
  } finally { followAbort.abort() }
  if (!snapshot) throw new Error('未能读取会话历史，请检查连接后重试。')
  const records = [...snapshot.records]
  let hasMore = snapshot.hasMore
  let beforeSeq = records[0]?.event.seq
  while (hasMore) {
    if (!Number.isInteger(beforeSeq)) throw new Error('会话历史分页缺少游标，已停止复制，避免导出不完整内容。')
    const result = await remote.session.page({ address, throughSeq: snapshot.cursor, beforeSeq, maxMessages: 100 }, signal)
    if (!result.ok) throw new Error(result.error.message)
    const page = result.value
    const next = page.records[0]?.event.seq
    if (page.hasMore && (!Number.isInteger(next) || next >= beforeSeq)) throw new Error('会话历史分页没有前进，请重试。')
    records.push(...page.records)
    beforeSeq = next
    hasMore = page.hasMore
  }
  return records
}

/** Keep clipboard activation on browsers that require a gesture-bound write. */
async function copyText(value) {
  if (!navigator.clipboard) throw new Error('剪贴板不可用，请通过受信任的 HTTPS 地址打开页面。')
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': Promise.resolve(value).then(text => new Blob([text], { type: 'text/plain' })) })])
  } else {
    await navigator.clipboard.writeText(await value)
  }
}

function applyActions(ctx) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())
  const summary = id => {
    const value = ctx.sessions.list.getSnapshot().byId[id]
    if (!value) throw new Error('找不到这条会话，请刷新列表。')
    return value
  }
  const link = id => sessionLink(window.location.href, id)
  const actions = [
    { id: 'dsh-session-actions.cwd', label: '复制工作目录', run: id => {
      const cwd = summary(id).cwd
      if (!cwd) throw new Error('这条会话没有工作目录。')
      return copyText(cwd)
    } },
    { id: 'dsh-session-actions.link', label: '复制深度链接', run: id => copyText(link(id)) },
    { id: 'dsh-session-actions.markdown', label: '复制为 Markdown', feedback: { pending: '正在读取会话并复制 Markdown…', success: 'Markdown 已复制到剪贴板' }, run: id => {
      const title = summary(id).title || '未命名会话'
      return copyText(readConversation(ctx.remote, id, AbortSignal.any([lifetime.signal, AbortSignal.timeout(120000)])).then(records => markdown(records, title, link(id))))
    } },
  ]
  for (const action of actions) ctx.effect(() => ctx.uiWorkspace.registerSessionMenuAction(action))
  const target = new URL(window.location.href).searchParams.get('dshSession')
  if (target) {
    let done = false
    const open = () => {
      const list = ctx.sessions.list.getSnapshot()
      if (done || list.phase !== 'ready') return
      done = true
      if (list.byId[target]) ctx.uiWorkspace.openSession(target)
      else window.alert('链接对应的会话不存在，或当前访问身份无法读取。')
    }
    ctx.effect(() => ctx.sessions.list.subscribe(open))
    open()
  }
}

return {inject:['uiWorkspace','sessions','remote','remote.session'],apply:applyActions};
}});
