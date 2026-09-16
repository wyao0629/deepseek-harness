# Agent Note: Independent PI-style collaboration

Status: implemented

> Superseded product status: the user rejected and archived this prototype on 2026-09-16. The tests below are historical technical evidence, not product acceptance. Source now lives in `personal/archived/dsh-pi-collab`.

English | [中文](2026-09-16-pi-collaboration.zh.md)

## Problem

The existing native-harness cards visualize delegated work but do not offer an independent PI-style collaboration executor in DSH.

## Decision

Add `personal/archived/dsh-pi-collab` as a standalone bundle and preset. PI-Desktop task delegation is the functional reference, not merely a diagram. DSH spawn sessions provide isolated task contexts, model routing and existing permissions. DSH jobs own cancellation, resource cleanup and completion wakeups. Task/Wait/List/Stop wrappers expose the lifecycle without a second LLM execution loop.

## Alternatives considered

A visualization-only adapter would not provide delegation. A second standalone agent loop would duplicate DSH model and permission handling. Reusing DSH spawn and jobs keeps execution and cleanup under the existing owners.

## Consequences

Children share the workspace but not parent conversation history. Concurrency is reserved before asynchronous model validation. Each child is disposed before its job settles. Persisted custom events associate task metadata and committed messages with independent cards. No duplicate whole-history snapshots or token-level journal copies are emitted.

Jobs are process-local, so restart recovery and custom role management remain outside this version. Native Kimi/Codex presets are unchanged. Existing unrelated worktree changes were preserved.

## Validation

Five focused Node tests passed. A real two-child run returned distinct ALPHA/BETA results, a zero-timeout wait preserved execution, a stop killed the selected task, and background completion resumed the parent. Browser inspection confirmed separate reasoning/output and actual task counts in the functional-test workspace.
