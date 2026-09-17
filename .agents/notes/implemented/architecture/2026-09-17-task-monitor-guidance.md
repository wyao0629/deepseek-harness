# Agent Note: Task monitor model guidance

Status: implemented

English | [中文](2026-09-17-task-monitor-guidance.zh.md)

## Problem

The task-monitor plugin registers one native systemPrompt.context contribution named task-monitor:usage. Tool descriptions alone do not explain how natural scheduling requests map to task ownership and model waiting. Runtime-context snapshots expose this guidance to existing sessions on subsequent model requests and record model-visible text through the host pipeline.

## Decision

The guidance specifies intent, preparation, execution, waiting, cancellation and business validation. It does not intercept shell commands or guarantee model compliance. Native CLI loops remain outside its scope. Registration is disposed with the plugin; host snapshot handling owns deduplication and context rebuilding.

## Alternatives considered

Tool descriptions alone omit workflow guidance. Appending chat reminders every turn grows history unnecessarily. Native context snapshots use the existing host lifecycle.

## Consequences

Validation: seven focused plugin tests cover waiting, recovery, receipt identity and guidance registration/disposal. Production acceptance uses the existing 功能测试 session without executing a business task.
