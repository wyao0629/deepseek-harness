# Agent Note: Personal Codex bundle

Status: implemented

[English](2026-09-14-personal-codex-bundle.md) | 中文

## Problem

个人 fork 需要可重复安装的 Codex 集成，同时避免复制机器凭据或将插件打包与上游发布绑定。

## Decision

[个人安装器](../../../../personal/install.mjs) 将已有 dsh-codex 包启用为独立的 profile 组合包，保留原始包标识和预构建 JavaScript。提供方凭据留在运行时数据目录中。该 fork 关闭 GitHub Actions，发布代码不会部署正在运行的服务器。

## Alternatives considered

**上游工作区包**会把个人插件纳入官方发布和生成的目录。独立的 profile 组合包保留已验证的包标识，并减少后续合并工作。

**机器配置快照**会让安装依赖现有密钥和会话路径。安装器仅创建必要预设，并生成本机运行时状态。

## Consequences

克隆仓库并完成本地构建后，可以重建 profile。每次构建后都需要重新应用编译产物的 Session 兼容补丁。原生会话反向导入仍依赖已验证的 DSH 循环版本。安装器和插件测试在本地执行；关闭 Actions 意味着推送不运行自动检查。

0.4 版本加入原生命令分发、DSH 有效权限解析、持久附件路径、问题分批与自由文本编码、原生上下文提示以及 CLI 权限参数。恢复旧轮次后延迟到达的用量通知不能绑定新注册的压缩操作；没有响应轮次 ID 的操作只能由轮次开始通知绑定。原生压缩保留 DSH 显示历史并更新原有原生检查点。测试必须放在功能测试工作区，区分真实提供方验收与确定性的协议测试。
