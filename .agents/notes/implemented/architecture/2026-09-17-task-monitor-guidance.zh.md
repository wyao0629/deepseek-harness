# Agent Note: 调度监控模型使用指引

Status: implemented

[English](2026-09-17-task-monitor-guidance.md) | 中文

## Problem

调度监控插件注册名为 task-monitor:usage 的原生 systemPrompt.context。仅有工具描述不足以说明自然语言调度请求、任务归属和模型等待之间的关系。已有会话在后续模型请求中获取运行时上下文快照，模型可见内容由宿主记录。

## Decision

指引包含意图识别、准备、执行、等待、取消和业务验收。它不拦截普通 Shell 命令，也不保证模型一定遵守。原生 CLI 循环不在控制范围内。插件卸载时注销贡献，快照去重与上下文重建由宿主管理。

## Alternatives considered

仅靠工具描述缺少流程指引，每轮追加聊天提醒则会不断增加历史。原生上下文快照复用宿主生命周期。

## Consequences

验证：七项插件测试覆盖等待、恢复、通知识别和指引注册与注销。线上验收在已有“功能测试”会话中进行，不执行业务任务。
