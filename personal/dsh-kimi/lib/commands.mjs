export const commandHelp = {
  help: ['查看中文命令说明与示例', ''],
  kimi: ['查看 Kimi 帮助，或执行子命令；例：/kimi status', 'help 或子命令'],
  status: ['查看原生会话状态、模型、权限和上下文用量', ''],
  usage: ['查看原生会话 Token 用量', ''],
  compact: ['压缩原生上下文；例：/compact 保留数据口径与未完成任务', '可选：需要保留的内容'],
  plan: ['切换规划模式；/plan 切换，/plan on 开启，/plan off 关闭', '可选：on 或 off'],
  swarm: ['调用原生 AgentSwarm；例：/swarm 检查 ETL 并行任务；也支持 on/off', '任务说明，或 on/off'],
  tasks: ['查看原生后台任务及执行状态', ''],
  skills: ['列出原生会话可用技能', ''],
  mcp: ['查看 MCP 服务连接状态', ''],
  resume: ['显示关联的服务器原生会话和 CLI 接续命令', ''],
  model: ['查看或切换模型；例：/model 提供方 模型标识 low', '可选：提供方 模型标识 推理强度'],
  effort: ['设置推理强度；例：/effort high（须模型支持）', '推理强度'],
  version: ['查看服务器 Kimi 版本与能力', ''],
  title: ['查看或修改原生会话标题；例：/title 每日 ETL 排查', '可选：新标题'],
  goal: ['查看、创建或控制原生目标；例：/goal 修复 ETL；支持 status/pause/resume/cancel', '目标描述或 status/pause/resume/cancel'],
};

export function nativePrompt(content) {
  const index = content.findIndex(item => item.type === 'text');
  const match = index < 0 ? null : content[index].text.match(/^\/(swarm|goal)\s+([\s\S]+)$/);
  if (!match) return {content};
  const task = match[2].trim();
  if (!task) throw new Error('请填写任务内容。');
  const next = content.map((item, i) => i === index ? {...item, text:task} : item);
  return {content:next,...(match[1] === 'swarm' ? {swarm_mode:true} : {goal_objective:task})};
}
