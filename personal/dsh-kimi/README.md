# dsh-kimi 0.1.0

English | [中文](README.zh.md)

Run the model selected in DSH through native Kimi Code 0.42.0. Kimi owns the agent loop, native tools and AgentSwarm; DSH owns credentials, conversation display and interactive answers. This is a personal integration under active acceptance, not a claim of complete CLI parity.

## Deployment

Use Linux and Node.js 24. Keep this directory beside `dsh-codex`, whose Responses bridge and route codec are shared. Build this fork first: its commands package adds `useNativePalette()`. The official unmodified DSH package does not provide that API.

Install the official Kimi Code binary, then run it as the DSH service account:

```bash
/opt/kimi-code/bin/kimi web --no-open --host 127.0.0.1 --port 18793
```

Keep this process supervised independently of browser connections. Its default token is `$HOME/.kimi-code/server.token`. The DSH plugin uses loopback port 18794 for model requests; provider API keys remain in DSH. Configure `baseUrl`, `tokenFile`, `bridgePort`, `requestTimeoutMs` and `pollMs` through the host bundle config when using other paths or ports.

Install the directory with `dsh plugin --profile web add /absolute/path/personal/dsh-kimi`. Under `$DSH_HOME/.agent-presets/kimi`, create `preset.yml` containing `name: Kimi` and `agent.cordis.yml` containing:

```yaml
- id: kimi-route
  name: dsh-kimi/preset-route
```

Restart DSH and create a conversation with the Kimi preset. Tests belong in the `功能测试` workspace. This bundle needs the same ignorable Session metadata compatibility fix as dsh-codex on DSH 0.1.5-rc.2.

## Commands and session handoff

The Kimi preset exposes `/status`, `/usage`, `/compact`, `/plan on|off`, `/swarm on|off`, `/tasks`, `/skills`, `/mcp`, `/resume`, `/model <provider> <model> [effort]` and `/effort <value>`. Native Skills load when the agent is created. Built-ins and dotted subcommands keep their CLI names; external Skills provide `/skill:<name>` and `/<name>`. Skill commands enter the normal prompt queue and carry native skill metadata. Global DSH commands remain under `/dsh <command>`; they do not silently replace native commands.

The command menu includes Chinese descriptions and examples, with `/help`, `/version`, `/title` and `/goal` controls. `/plan` without arguments toggles the native mode. `/swarm <task>` enters the ordinary DSH prompt queue and sets the native prompt's swarm mode, so its user message, streaming answer and child-agent trace stay in the conversation. `/goal <objective>` uses the native goal objective; status, pause, resume and cancel are supported. These additions are not full TUI command parity. Blank sessions can query `/status` without a preliminary model call. The Chinese preset metadata is shipped in `preset/kimi`.

`/resume` gives the server-side native session ID. Continue with the same server account, then exit that CLI before resuming in DSH. The plugin detects active CLI ownership, refreshes the idle native cache through Kimi's reversible archive/restore lifecycle, and imports completed turns using durable native turn and prompt IDs. Message-array offsets are not synchronization cursors. DSH must stay running because native model requests use its bridge.

Native question choices and free text return through DSH's question UI. Native approval requests are forwarded separately. Files and images are converted into native prompt content. Native tool and child-agent events are retained in the session trace. When the event channel stalls, persisted native transcript snapshots recover text and tool progress without repeating previously emitted text. Expand the completed turn’s thinking area to inspect the Chinese Kimi run summary and its AgentSwarm children. Internal IDs remain inside collapsed diagnostics. Failed DSH runs can recover their completed native answer without repeating the original user message.

## Known acceptance gaps

- Only DSH full-access mode can execute currently. Read-only and workspace-write modes are rejected until a genuinely isolated native worker is implemented.
- Do not keep two interactive clients open on the same native session. Background tasks need separate session ownership.
- Existing DSH history before the first Kimi binding, edited-history rewind, and fully bidirectional attachment handling still require end-to-end acceptance.
- `/compact` currently reports that native compaction started; completion progress needs a dedicated UI adapter.
- The native API may return an empty usage aggregate. The adapter omits unavailable usage instead of claiming zero tokens; exact cost accounting is pending.
- Terminal-only UI commands and authentication flows are not exposed as DSH slash commands.

## Tests

`node --test personal/dsh-kimi/test/native.test.mjs` tests protocol mapping, pagination and cache handoff. `test/native-smoke.mjs` uses the real native backend with a synthetic model provider; `TEST_SWARM=1`, `TEST_QUESTION=1` and `TEST_CLI=1` exercise native child agents, custom answers and CLI persistence without external model charges. Run it only on the acceptance host; its fixtures live under `功能测试/dsh-kimi`.

`TEST_SNAPSHOT=1` deliberately silences the event channel and verifies that a running turn still projects progress before completion. It can be combined with `TEST_SWARM=1`.
