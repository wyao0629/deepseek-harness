# dsh-codex 0.4.0

[English](README.md) | 中文

Codex 智能体预设让 DSH 中选择的模型在服务器原生 Codex harness 中运行。DSH 继续管理提供方凭据和对话界面。作为个人独立组合包，插件保留原始包名和预构建 JavaScript，不纳入上游工作区发布或生成的包目录。

## Use

按照[安装指南](../README.zh.md)操作，以 Codex 预设创建 DSH 会话，并正常选择提供方和模型。展开已完成的思考区域，可以查看原生命令与 Codex 会话 ID。

使用服务器上的相同账号执行以下命令，继续关联的原生会话：

```bash
node personal/dsh-codex/lib/resume.mjs <native-session-id>
```

DSH 必须保持运行，因为它提供模型桥接服务。CLI 完成的文本轮次和工具轨迹会在约两秒的扫描后出现在关联的 DSH 会话中。请等待该轮显示后，再从 DSH 继续。每次 DSH 调用都通过新建的 App Server 进程读取原生持久历史。本地桌面 Codex 会话与之独立。

## Configuration and limits

宿主插件在 Cordis 配置中提供 `bridgePort`、`executablePath`、`startupTimeoutMs`、`shutdownGraceMs` 和 `commandOutputLimitBytes`。桥接服务绑定回环地址，并生成自己的本地令牌；实际提供方密钥仍由 DSH 管理。数据位置遵循 `DSH_HOME` 和 `CODEX_HOME`。

已验证 DSH 0.1.5-rc.2 和 Codex 0.154.0。DSH 的 append 元数据需要安装器提供的编译模块补丁。反向导入还使用该版本 DSH 的维护保留期和 `phase.lastTurn` 游标；循环版本不兼容时会停止导入并输出诊断。升级上游后需要重新验证。

反向导入覆盖已完成的文本轮次与工具轨迹，包括存入持久附件库后的 CLI 本地图片和内联图片，但不包括逐 token 输出。不要同时通过两个界面向同一会话发送消息。变更模型或提供方会分叉原生历史，DSH 保留原会话。回退编辑历史可能重建可见上下文。未关联的原生会话不会自动导入。第三方费用面板可能缺少内部 Codex 路由的定价。

## Native controls

权限通过 DSH 的沙箱策略和审批服务解析，包括部署默认值。只读、工作区可写、完全权限、询问和禁止询问均传给原生 Codex。额外可写目录和工作区可写模式的网络访问由明确的会话级 Codex 配置控制，模型不能自行授权。续聊脚本将最近同步的权限、审批策略、推理强度、上下文上限和工作目录传给服务器 CLI。

从 DSH 执行时发起的原生问题与审批会显示在 DSH 问答区，轮次等待回答或取消。自由文本写入 Codex 的 `answers` 数组；超过三个问题时分批询问，不丢弃问题。直接在原生 CLI 中发起的交互仍使用该 CLI 自己的审批和问答界面。

DSH 提交的文件和图片使用持久附件库路径，原生会话续聊仍可读取。文件由原生工具读取，不会静默转换成模型文本。CLI 本地图片和内联图片先存入 DSH 附件库再回写；外部图片 URL 使用可见占位提示，不自动下载。

输入 `/codex help` 查看命令。Codex 预设只在自身范围内替换 `/compact`、`/status`、`/plan`、`/review` 和 `/diff`。`/codex model <provider> <model> [effort]` 和 `/codex effort <value>` 使用 DSH 模型选择；不支持的推理档位会报错。`/codex permissions <mode> [ask|never]`、`/codex network on|off` 和 `/codex add-dir <absolute path>` 设置后续执行权限。`/codex skills` 与 `/codex mcp` 查询原生注册表；`/codex resume` 显示关联的服务器会话。新建、分叉、上传、模型和权限选择继续使用 DSH 控件。终端主题、退出、交互登录等终端专用命令不映射为网页命令。

`/compact` 调用 `thread/compact/start` 并等待原生完成通知，保留 DSH 完整显示历史。`/review [uncommitted|base <branch>|commit <sha>]` 调用 `review/start`。`/plan on|off` 设置 Codex 协作模式。`/status` 和会话提示展示原生 token 用量及有效上下文容量，与 DSH 显示历史的估算分开；Codex 可能在模型配置上限内预留部分容量。DSH 自动历史压缩、编辑历史后的重建与原生压缩仍是不同操作。

## Verification

构建仓库并安装组合包依赖后执行：

```bash
node --test personal/install.test.mjs personal/dsh-codex/test/*.test.mjs
```

测试覆盖提供方路由、工具转换、流式终态失败、回环鉴权、持久化反向导入去重，以及安装器备份幂等性。可选的原生冒烟测试使用模拟提供方，写入 `DSH_CODEX_TEST_ROOT`，默认是调用目录下的 `功能测试/dsh-codex/fixtures`。

## License

适配器基于采用 MIT 许可证的 dsh-plugin-codex 0.1.1。原始声明保留在 [vendor/LICENSE](vendor/LICENSE) 中。
