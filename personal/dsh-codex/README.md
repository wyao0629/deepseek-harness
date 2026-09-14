# dsh-codex 0.3.0

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

Reverse import covers completed text turns and tool traces, not partial token streaming or CLI image attachments. Do not send simultaneous turns through both interfaces. Model/provider changes fork native history, while DSH retains the conversation. Rewinding edited history can rebuild visible context. Unlinked native conversations are not automatically imported. Third-party cost panels may lack prices for the internal Codex route.

## Verification

After building the repository and installing the bundle dependencies:

```bash
node --test personal/install.test.mjs personal/dsh-codex/test/bridge.test.mjs personal/dsh-codex/test/sync.test.mjs
```

The tests cover provider routing, tool conversion, terminal streaming failures, loopback authorization, persistent reverse-import deduplication, and installer backup idempotence. The optional native smoke uses a fake provider and writes under `DSH_CODEX_TEST_ROOT`, defaulting to a `功能测试/dsh-codex/fixtures` directory under the invoking directory.

## License

The adapter derives from MIT-licensed dsh-plugin-codex 0.1.1. Its upstream notice is retained in [vendor/LICENSE](vendor/LICENSE).
