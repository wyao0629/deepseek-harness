# dsh-grok-build

[English](README.md) | 中文

在 DeepSeek Harness 中使用 Grok Build 作为 Agent 运行时，而不只是将 Grok 当成模型。DSH 负责会话、轨迹、审批和持久化；Grok Build 负责 Agent 循环、工具、压缩和技能。创建会话时选择 Grok 预设。本包不替换全局 AgentFactory，也不移除 DSH 模型选择器；其他预设保持原样。

## 安装

通过厂商的 `https://x.ai/cli/install.sh` 安装官方 Grok CLI。开发部署使用 `~/.grok/bin/grok`。

在插件目录下，将包添加到 Web profile：

```sh
dsh plugin --profile web add "link:$(pwd)"
```

重启 DSH Web，创建会话并选择 Grok。默认自定义模型为 `dsh-grok-46`，在 `~/.grok/config.toml` 中配置为现有的 OpenAI 兼容网关。内置的 `grok-4.6` 使用官方 x.ai 服务，需要 `grok login` 或官方 API 密钥。

## 认证

Grok Build 按自身文档说明的优先级解析凭据。常见方式包括将认证写入 `~/.grok/auth.json` 的 `grok login`，以及 `XAI_API_KEY` 或 `~/.grok/config.toml` 中自定义端点的 `env_key`。

插件将 DSH 现有的 `XAI_API_KEY`、`TOKENSHOP_API_KEY` 和 `GROK200K_API_KEY` 转发给 Grok 子进程，不另存令牌副本。

## 卸载

```sh
dsh plugin --profile web exec dsh-grok-build remove-preset
dsh plugin --profile web remove dsh-grok-build
```

用户修改过的 `~/.dsh/.agent-presets/grok` 不会被删除。

## 原生命令菜单

本 fork 的命令注册表支持预设切换。`/grok help` 初始化原生连接，随后 Grok ACP 公布的命令会显示在斜杠菜单中，并直接发送给 Grok。全局 DSH 命令使用 `/dsh <command>`。每个会话独立注册目录。首次握手时，帮助文本可能早于命令目录返回。
