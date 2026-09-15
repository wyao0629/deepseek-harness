# Agent Note: Native agent timelines

Status: implemented

English | [中文](2026-09-15-native-agent-panels.zh.md)

## Problem

Kimi activity discarded child text deltas, showed only an aggregate count, and disappeared inside the completed Turn process disclosure. Child reasoning stored only in native transcripts was absent. Codex collaboration items appeared as raw tool details with duplicate started/completed rows.

## Decision

Reduce Kimi events by native agent, turn and step. Display each child task, collapsible thinking and separate output alongside actual spawned, running, completed, failed/cancelled and waiting counts. Fetch each child's authoritative transcript once at completion to replace partial streamed text. Only explicitly main-owned deltas enter the main assistant stream. Place the completed activity node at the closed Turn boundary so counts remain visible outside the process disclosure.

Group Codex collaboration states and messages by receiver thread, and deduplicate tool lifecycle phases by item ID. Codex collaboration events do not expose full child reasoning; do not substitute the main agent's reasoning. Grok ACP child reasoning is not adapted by this change.

## Alternatives considered

Repeatedly sending full child transcripts during polling would recreate the prior history bandwidth problem. Counting requested swarm size would misrepresent runs in which the model never invokes delegation. Preserve actual identities and send authoritative child snapshots once.

## Consequences

Existing Kimi event histories can recover separate streamed child output. Complete persisted child thinking is guaranteed for newly completed runs with the new host adapter, not retroactively fetched for every historical run. Missing child snapshot retrieval does not fail an otherwise completed main task; its diagnostic event records the error. Enabling swarm mode does not itself prove that any agents were spawned.

Validation: Kimi unit suite, renderer interleaving and snapshot replacement tests, Codex collaboration projection test, a real two-child Kimi run in the functional-test workspace, and browser reload verification showing two distinct outputs and an unfolded count. The native run that motivated the report contained 85 main steps and zero spawned agents.
