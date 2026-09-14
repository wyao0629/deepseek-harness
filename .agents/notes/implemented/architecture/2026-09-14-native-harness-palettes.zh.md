# Agent Note：原生 Harness 菜单与 Kimi 协议基础

Status: implemented

[English](2026-09-14-native-harness-palettes.md) | 中文

## 问题

原生 Codex、Grok 和 Kimi 会话需要在 DSH 内展示各自的命令。Kimi AgentSwarm 必须由原生 Harness 执行，同时由 DSH 保留提供方配置和交互界面。

## 决策

为作用域命令层增加 `commands.useNativePalette()`。原生菜单通过 `/dsh` 保留全局控制；由于常驻预设作用域由多个会话共享，会话技能目录使用精确的 Agent 作用域。允许冒号名称以支持原生技能命名空间。

个人 Kimi 插件调用经认证的 Kimi Code 0.42 原生 REST/WebSocket 后端，并复用个人 Codex Responses 桥接。真实提供方密钥留在 DSH。原生提问的选项标识和自定义回答通过 DSH userQuestions 进行转换。

完成的 CLI 轮次通过原生轮次及提问标识定位。常驻 Kimi Web 会话不会自动加载 CLI 写入的变更。CLI 退出且原生会话空闲后，通过可逆的归档/恢复刷新该会话缓存。冷启动轨迹缺少正文时，通过规范消息补全；消息数组位置不作为持久游标。同一会话不支持两个交互客户端同时占用。

## 备选方案

旧版 Python Kimi CLI 的 Wire 接口不提供所需的原生 AgentSwarm 实现。单用 ACP 不能提供全部所需的丰富原生交互事件。让模型调用进入 DSH 工具循环则会改变预期的原生执行行为。

## 影响与剩余工作

命令注册表的改动已经实现并测试。Kimi 原生协议基础已部署验收，但尚不等于完整 CLI 能力。只读/工作区沙箱工作进程、既有历史重建与回退、完整压缩界面、准确用量归属，以及最终附件/重连覆盖，仍在插件 README 中列为明确缺口。仓库不保存提供方密钥或机器专用订阅。测试使用“功能测试”工作区；按用户要求推送代码时，GitHub Actions 必须保持关闭。
