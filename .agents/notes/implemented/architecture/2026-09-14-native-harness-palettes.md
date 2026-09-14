# Agent Note: Native Harness palettes and Kimi protocol foundation

Status: implemented

English | [中文](2026-09-14-native-harness-palettes.zh.md)

## Problem

Native Codex, Grok and Kimi sessions need their own command discovery inside DSH. Kimi AgentSwarm must execute in the native harness, with DSH retaining the provider configuration and interaction surface.

## Decision

Add `commands.useNativePalette()` to scoped command layers. A native palette retains global controls under `/dsh`; child-agent skill catalogs use exact agent scopes because standing preset scopes are shared. Colon-bearing names support native skill namespaces.

The personal Kimi bundle calls the authenticated native Kimi Code 0.42 REST/WebSocket backend and reuses the personal Codex Responses bridge. Actual provider credentials stay in DSH. Native questions map option identifiers and custom answers through DSH userQuestions.

Completed CLI turns are keyed by native turn plus prompt identifiers. A warm Kimi Web session does not automatically reload CLI changes. Once the CLI exits and the native session is idle, reversible archive/restore refreshes that session cache. Canonical messages hydrate missing text in cold transcript frames; array offsets are never durable cursors. Same-session simultaneous interactive ownership is unsupported.

## Alternatives considered

The older Python Kimi CLI Wire interface does not expose the desired native AgentSwarm implementation. ACP alone does not expose all required rich native interaction events. Running model calls in DSH's tool loop would change the intended native execution behavior.

## Consequences

The command registry change is implemented and tested. Kimi's native protocol foundation is deployed for acceptance; this is not full CLI parity. Read-only/workspace sandbox workers, existing-history rebase and rewind, complete compaction UI, accurate usage attribution, and final attachment/reconnection coverage remain explicit gaps in the bundle README. No provider keys or machine-specific subscriptions belong in this repository. Tests use the functional-test workspace, and GitHub Actions must remain disabled for user-requested code pushes.
