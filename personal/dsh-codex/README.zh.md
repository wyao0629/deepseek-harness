# dsh-codex 0.3.0

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

反向导入覆盖已完成的文本轮次与工具轨迹，不包括逐 token 输出或 CLI 图片附件。不要同时通过两个界面向同一会话发送消息。变更模型或提供方会分叉原生历史，DSH 保留原会话。回退编辑历史可能重建可见上下文。未关联的原生会话不会自动导入。第三方费用面板可能缺少内部 Codex 路由的定价。

## Verification

构建仓库并安装组合包依赖后执行：

```bash
node --test personal/install.test.mjs personal/dsh-codex/test/bridge.test.mjs personal/dsh-codex/test/sync.test.mjs
```

测试覆盖提供方路由、工具转换、流式终态失败、回环鉴权、持久化反向导入去重，以及安装器备份幂等性。可选的原生冒烟测试使用模拟提供方，写入 `DSH_CODEX_TEST_ROOT`，默认是调用目录下的 `功能测试/dsh-codex/fixtures`。

## License

适配器基于采用 MIT 许可证的 dsh-plugin-codex 0.1.1。原始声明保留在 [vendor/LICENSE](vendor/LICENSE) 中。
