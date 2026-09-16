window.__ModuleLoader__.load({ id: 'dsh-pi-collab', factory: require => {
  const { jsx, jsxs } = require('react/jsx-runtime');
  const definition = {
    kind: 'pi-collab-tree', target: 'chat',
    match: event => ['pi-collab/batch', 'pi-collab/task', 'pi-collab/message'].includes(event.type)
      ? { id: event.data.batch, role: event.type === 'pi-collab/batch' ? 'start' : 'update' } : null,
    start: () => ({ tasks: {}, messages: {} }),
    update: (context, match) => {
      const data = match.event.data, state = context.state;
      if (match.event.type === 'pi-collab/task') return { ...state, tasks: { ...state.tasks, [data.id]: data } };
      const messages = { ...state.messages, [data.id]: { ...state.messages[data.id], [data.seq]: data.content } };
      return { ...state, messages };
    },
    buildViewNode: c => !c.start ? null : ({ key: c.key, kind: 'pi-collab-tree', id: c.id, target: 'chat', anchorSeq: c.start.location?.turn?.end?.seq ?? c.start.event.seq, location: c.start.location, visibility: 'visible', data: c.state }),
  };
  const labels = { running: '运行中', stopping: '停止中', completed: '已完成', killed: '已停止', failed: '失败' };
  const roleLabels = { explorer: '调研员', worker: '执行员', 'code-reviewer': '审查员', 'test-runner': '测试员' };
  const textStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '8px 0' };
  const css = `.pi-collab-tree{display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,3fr);gap:20px 36px;padding:16px 0}.pi-collab-root,.pi-collab-child{padding:18px;border-radius:16px;background:color-mix(in srgb,currentColor 5%,transparent);border:1px solid color-mix(in srgb,currentColor 10%,transparent);min-width:0}.pi-collab-root{align-self:center}.pi-collab-children{border-left:2px solid color-mix(in srgb,currentColor 20%,transparent);padding-left:24px;display:grid;gap:16px}.pi-collab-child{position:relative}.pi-collab-child:before{content:'';position:absolute;left:-25px;top:30px;width:24px;border-top:2px solid color-mix(in srgb,currentColor 20%,transparent)}.pi-collab-child summary{cursor:pointer}.pi-collab-meta{opacity:.6;font-size:12px;overflow-wrap:anywhere}@media(max-width:650px){.pi-collab-tree{grid-template-columns:1fr}.pi-collab-children{margin-left:10px}}`;
  function Panel({ node }) {
    const tasks = Object.values(node.data.tasks), messages = node.data.messages;
    const finished = tasks.filter(t => !['running', 'stopping'].includes(t.status)).length;
    return jsxs('section', { 'data-pi-collab': true, children: [
      jsx('style', { children: css }),
      jsx('strong', { children: `多 Agent 协作 · ${tasks.length} 个子 Agent · 已结束 ${finished}/${tasks.length}` }),
      jsxs('div', { className: 'pi-collab-tree', children: [
        jsxs('div', { className: 'pi-collab-root', children: [jsx('strong', { children: '主 Agent' }), jsx('p', { children: `协调 ${tasks.length} 项任务` })] }),
        jsx('div', { className: 'pi-collab-children', children: tasks.map(task => jsxs('details', { className: 'pi-collab-child', children: [
          jsxs('summary', { children: [jsx('strong', { children: roleLabels[task.role] || task.role }), ` · ${labels[task.status] || task.status}`, jsx('div', { children: task.label }), jsx('div', { className: 'pi-collab-meta', children: task.model })] }),
          jsx('p', { style: textStyle, children: task.task }),
          ...Object.entries(messages[task.id] || {}).map(([seq, blocks]) => jsxs('div', { children: blocks.map((block, i) => block.type === 'text'
            ? jsx('p', { style: textStyle, children: block.text }, i)
            : block.type === 'thinking' || block.type === 'reasoning'
              ? jsxs('details', { children: [jsx('summary', { children: '思考' }), jsx('p', { style: textStyle, children: block.text || block.thinking || '' })] }, i) : null) }, seq)),
          !messages[task.id] && task.output ? jsx('p', { style: textStyle, children: task.output }) : null,
          task.status === 'failed' ? jsx('p', { children: task.detail }) : null,
          jsx('small', { className: 'pi-collab-meta', children: `${task.childId || task.id} · ${Math.round(((task.finishedAt || Date.now()) - task.startedAt) / 1000)} 秒` }),
        ] }, task.id)) }),
      ] }),
    ] });
  }
  return { inject: ['uiConversation', 'slots'], apply(ctx) {
    ctx.uiConversation.events.register(definition);
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'pi-collab-tree' }, Panel));
  } };
} });
