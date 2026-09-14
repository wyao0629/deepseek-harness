# dsh-codex 0.4.0

English | [中文](README.zh.md)

The Codex agent preset runs the model selected in DSH inside the server's native Codex harness. DSH remains the provider credential owner and conversation interface. The original package name and prebuilt JavaScript are retained as a personal out-of-tree bundle, outside upstream workspace publication and generated package catalogs.

## Use

Follow the [installation guide](../README.md), create a DSH conversation with the Codex preset, and select a provider/model normally. Expand the completed thought section for native commands and the Codex session ID.

To continue the linked native session, run as the same server account:

```bash
node personal/dsh-codex/lib/resume.mjs <native-session-id>
```

DSH must remain running because it serves the model bridge. Completed CLI text turns and tool traces appear in the linked DSH conversation after the roughly two-second scan. Wait for that turn to appear before continuing in DSH. Each DSH invocation reads native persisted history through a fresh App Server process. Local desktop Codex sessions are independent.

## Configuration and limits

The host plugin exposes `bridgePort`, `executablePath`, `startupTimeoutMs`, `shutdownGraceMs`, and `commandOutputLimitBytes` in its Cordis config. The bridge binds loopback and generates its own local token; actual provider keys remain in DSH. Data locations follow `DSH_HOME` and `CODEX_HOME`.

Validated against DSH 0.1.5-rc.2 and Codex 0.154.0. DSH append metadata needs the installer's compiled-module patch. Reverse import also uses this DSH version's maintenance reservation and `phase.lastTurn` cursor; incompatible loop versions stop import with a diagnostic. Revalidate after upstream upgrades.

Reverse import covers completed text turns and tool traces, including local/data-URL CLI images after durable attachment admission, but not partial token streaming. Do not send simultaneous turns through both interfaces. Model/provider changes fork native history, while DSH retains the conversation. Rewinding edited history can rebuild visible context. Unlinked native conversations are not automatically imported. Third-party cost panels may lack prices for the internal Codex route.

## Native controls

DSH permissions resolve through its sandbox policy and approval services, including deployment defaults. Read-only, workspace-write, full access, ask, and never are passed to native Codex. Additional writable roots and workspace-write network access are explicit per-session Codex controls; a model cannot grant these to itself. The resume helper carries the last synchronized mode, approval policy, reasoning effort, context limit, and cwd into the server CLI.

Native questions and approvals raised by DSH execution appear in the DSH question composer and suspend the turn until answered or cancelled. Free-text answers are encoded in Codex's `answers` arrays; requests with more than three questions are batched without dropping questions. Direct native CLI interactions still use that CLI's own approval/question UI.

Files and images submitted in DSH use durable attachment-store paths, so native resume can read them later. File contents are read by native tools, not silently parsed as model text. CLI local and inline images are admitted into the DSH attachment store before reverse import; remote image URLs are represented by a visible placeholder without downloading them.

Use `/codex help` for the available command surface. The Codex preset overrides `/compact`, `/status`, `/plan`, `/review`, and `/diff` only for that preset. `/codex model <provider> <model> [effort]` and `/codex effort <value>` use DSH model selection; unsupported effort settings report an error. `/codex permissions <mode> [ask|never]`, `/codex network on|off`, and `/codex add-dir <absolute path>` configure subsequent execution. `/codex skills` and `/codex mcp` query native registries; `/codex resume` identifies the linked server session. DSH continues to own new-session, fork, upload, model, and permission controls. Terminal-only commands such as terminal theme, quit, or interactive login are not browser commands.

`/compact` calls `thread/compact/start` and awaits the native terminal notification; it retains the full DSH display history. `/review [uncommitted|base <branch>|commit <sha>]` calls `review/start`. `/plan on|off` sets Codex collaboration mode. `/status` and conversation notices expose native token usage and effective context capacity separately from DSH's display-history estimate. Codex may reserve capacity below the configured model limit. Automatic DSH history compaction and edited-history rebasing remain separate operations from native compaction.

## Verification

After building the repository and installing the bundle dependencies:

```bash
node --test personal/install.test.mjs personal/dsh-codex/test/*.test.mjs
```

The tests cover provider routing, tool conversion, terminal streaming failures, loopback authorization, persistent reverse-import deduplication, and installer backup idempotence. The optional native smoke uses a fake provider and writes under `DSH_CODEX_TEST_ROOT`, defaulting to a `功能测试/dsh-codex/fixtures` directory under the invoking directory.

## License

The adapter derives from MIT-licensed dsh-plugin-codex 0.1.1. Its upstream notice is retained in [vendor/LICENSE](vendor/LICENSE).
