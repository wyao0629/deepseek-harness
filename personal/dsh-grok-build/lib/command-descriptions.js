const descriptions = {
  'always-approve':'切换原生工具自动审批模式；执行前请确认当前会话权限',
  compact:'压缩原生对话上下文，减少上下文占用',
  context:'查看原生上下文窗口用量与会话统计',
  'deep-research':'开展多 Agent 资料研究并生成带引用的报告；例：/deep-research 调研主题',
  feedback:'发送当前会话的反馈；请先检查是否包含敏感信息',
  goal:'管理原生自主目标；例：/goal 修复 ETL；可查看当前目标状态',
  loop:'按指定间隔反复执行任务；请填写原生 loop 参数',
  'session-info':'查看当前原生会话的模型、轮次及上下文用量',
  workflow:'启动或管理工作流；可列出、暂停、恢复和停止工作流',
};
export const describeCommand = command => descriptions[command.name] ?? `执行 Grok 原生命令 /${command.name}；${command.description || '参数遵循原生命令格式'}`;
