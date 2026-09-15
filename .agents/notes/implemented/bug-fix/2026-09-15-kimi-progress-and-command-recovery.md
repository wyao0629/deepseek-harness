# Agent Note: Kimi progress and command recovery

Status: implemented

English | [中文](2026-09-15-kimi-progress-and-command-recovery.zh.md)

## Problem

Kimi progress projections copied absent optional fields as undefined. Session persistence rejected them while the independently supervised native task continued. The importer excluded every DSH-origin prompt, losing the eventual answer. Skill discovery also renamed built-ins and discarded dotted subcommands.

## Decision

The progress projection omits absent fields before append. Failed DSH-origin prompts without a saved transcript remain eligible for recovery; the importer writes their final answer once without duplicating the user message. Run errors carry a KIMI_BRIDGE failure code. The client presents a Chinese summary and collapsed diagnostics.

Agent creation loads the native Skill catalog. Built-ins and dotted subcommands retain their native names; external Skills retain both qualified and short forms. Skills use the ordinary DSH prompt queue with native skill metadata and a nonempty prompt body. The shared command grammar accepts dots.

## Alternatives considered

**Stringify before validating.** This silently removes missing fields and concealed the original regression. Tests instead require a lossless JSON round trip.

**Treat a submitted command as successful execution.** Native completion and the DSH history response are checked separately; queue acceptance does not prove execution.

## Consequences

Native execution survives a display-side failure and its completed result can return to DSH. Recovery retains the failed attempt in history. Complete terminal command parity remains unfinished: terminal selectors, authentication and several session controls still need dedicated adapters.
