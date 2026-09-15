# Agent Note: Workspace deletion approval

Status: implemented

English | [中文](2026-09-15-workspace-delete-guard.zh.md)

## Problem

The existing hook bridges can continue after checker failures, and no workspace deletion policy was mounted. The user wants ordinary work to remain convenient with one identity.

## Decision

Use a separate personal plugin on the DSH tools pre-execution and final guard seams. Keep one execution identity. Ask only for detected deletion calls, fail closed on checker errors, and never convert a per-call approval into a session-wide grant. Do not alter the existing compatibility hook packages.

## Validation

Seven targeted tests pass. A standard-preset session in the functional-test workspace reached the browser waiting-for-answer state for the harmless `rm --version` probe. Cancellation finished the test without a deletion. The browser completion path remains unverified after automation timeouts. The deployment used live profile patch loading and a small dedicated backup, without restarting DSH.

## Deferred work

Native harness execution can bypass DSH tools. Kimi currently auto-approves native requests under its never-ask policy. Codex, Kimi, Grok Build and Claude must each receive pre-execution integration and child/direct-CLI acceptance tests before claiming coverage. Do not remove that limitation by changing a UI label. Directory placement enforcement and natural-language grant reuse need separate implementation; the delivered detector is not a sandbox.

## Alternatives considered

Changing all native harnesses now was explicitly deferred. Replacing the shared hook bridge behavior would affect unrelated hooks; a separate plugin limits the change.

## Consequences

Detected deletions pause on errors, while ordinary calls keep running. Coverage is intentionally limited to the DSH tool chain.

## Handoff

See the [plugin documentation](../../../../personal/dsh-workspace-guard/README.md) for exact current behavior, failure handling and the follow-up checklist. Preserve the user's single-identity preference and keep ordinary development operations free of approval dialogs. Do not push credentials or raw conversation logs.
