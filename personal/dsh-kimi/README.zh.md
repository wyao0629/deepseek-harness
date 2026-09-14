# dsh-kimi 0.1.0

[English](README.md) | 中文

让 DSH 中选择的模型在原生 Kimi Code 0.42.0 中运行。Kimi 负责 Agent 循环、原生工具和 AgentSwarm；DSH 负责密钥、会话展示和用户回答。这是仍在验收中的个人适配，并不代表已覆盖 CLI 的全部能力。

## 部署

使用 Linux 和 Node.js 24。将本目录与 `dsh-codex` 放在同一级目录，复用其中的 Responses 桥接及路由编码。先构建本 fork：其中的 commands 包新增了 `useNativePalette()`。官方未修改的 DSH 包没有这个接口。

安装官方 Kimi Code 二进制，以 DSH 服务账号运行：

```bash
/opt/kimi-code/bin/kimi web --no-open --host 127.0.0.1 --port 18793
```

用独立于浏览器连接的服务管理器托管该进程。默认令牌位于 `$HOME/.kimi-code/server.token`。DSH 插件在本机回环端口 18794 接收模型请求，提供方 API 密钥仍由 DSH 管理。使用其他地址或端口时，通过主插件配置指定 `baseUrl`、`tokenFile`、`bridgePort`、`requestTimeoutMs` 和 `pollMs`。

执行 `dsh plugin --profile web add /absolute/path/personal/dsh-kimi` 安装目录。在 `$DSH_HOME/.agent-presets/kimi` 下创建含有 `name: Kimi` 的 `preset.yml`，以及以下 `agent.cordis.yml`：

```yaml
- id: kimi-route
  name: dsh-kimi/preset-route
```

重启 DSH 后，选择 Kimi 预设创建会话。测试放在“功能测试”工作区。对于 DSH 0.1.5-rc.2，本插件需要与 dsh-codex 相同的可忽略 Session 元数据兼容修复。

## 命令与会话交接

Kimi 预设提供 `/status`、`/usage`、`/compact`、`/plan on|off`、`/swarm on|off`、`/tasks`、`/skills`、`/mcp`、`/resume`、`/model <provider> <model> [effort]` 和 `/effort <value>`。建立原生绑定后，支持用户调用的原生技能显示为 `/skill:<name>`。DSH 全局命令保留在 `/dsh <command>` 下，不会覆盖原生命令。

`/resume` 显示服务器端原生会话 ID。用相同服务器账号接续，在回到 DSH 前退出该 CLI。插件检测 CLI 的活动占用，通过 Kimi 可逆的归档/恢复生命周期刷新空闲会话缓存，并用原生轮次和提问 ID 导入完成的轮次，不将消息数组位置用作同步游标。原生模型调用依赖桥接，因此 DSH 必须保持运行。

原生问题的选项与自定义文本通过 DSH 问题界面回传。原生权限请求单独转发。文件和图片转换为原生提示内容。原生工具及子 Agent 事件保留在会话轨迹内。事件通道停滞时，插件从原生持久化轨迹恢复文字和工具进度，不重复已输出的文字。展开已完成轮次的“已思考”区域，即可查看 Kimi 运行卡片及 AgentSwarm 子 Agent。

## 尚待完成的验收

- 当前仅支持 DSH 完整权限执行。只读和工作区写入模式会被拒绝，直到实现真正隔离的原生工作进程。
- 同一个原生会话不要同时保持两个交互客户端运行。后台任务需要独立的会话所有权管理。
- 首次绑定前的 DSH 历史、编辑历史后的回退，以及完整双向附件处理仍需端到端验收。
- `/compact` 当前报告原生压缩已经启动，完成进度还需要专门的界面适配。
- 原生 API 可能返回空用量汇总。适配器会省略不可用的用量，不将其报告为零 Token；精确费用统计尚未完成。
- 终端界面专用命令及认证流程没有作为 DSH 斜杠命令开放。

## 测试

`node --test personal/dsh-kimi/test/native.test.mjs` 测试协议转换、分页和缓存交接。`test/native-smoke.mjs` 使用真实原生后端和合成模型提供方；`TEST_SWARM=1`、`TEST_QUESTION=1` 和 `TEST_CLI=1` 分别检验原生子 Agent、自定义回答及 CLI 持久化，不消耗外部模型额度。仅在验收服务器运行，测试数据位于 `功能测试/dsh-kimi`。

`TEST_SNAPSHOT=1` 刻意屏蔽事件通道，验证运行中的轮次仍可在完成前呈现进度。它可以与 `TEST_SWARM=1` 组合使用。
