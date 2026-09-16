# Archive and handoff

English | [中文](ARCHIVE.zh.md)

Status: archived, unfinished, not accepted. Archived at the user's request on 2026-09-16.

## Intended product

The user wants the PI subagent extension as an ordinary DSH capability plugin: models can use collaboration during normal work, without switching to a special harness or agent preset. Future work must identify the exact local PI extension referred to as pi-sunagent/pi-subagents and inventory its real execution, coordination, configuration and interaction behavior before implementing a complete functional port.

## Why this prototype was rejected

It adds a dedicated “多 Agent 协作” preset. Only that preset gets Task/TaskWait/TaskList/TaskStop. It implements a limited four-role task facade rather than the requested extension. Earlier work was influenced by the unrelated Kimi/Codex CLI harness integration and initially selected PI-Desktop's builtin Task implementation as its reference. Passing synthetic and real execution tests proved only those limited mechanisms, not conformance with the user's requirements.

## Disposition

Keep source, tests and prior technical findings here for reference. Remove the bundle, dependency link and generated pi-collab preset from the active server DSH profile. Preserve existing conversations and all unrelated plugins. Do not continue or reinstall this prototype without a new request.

## Future acceptance criteria

- Usable as a normal DSH feature without a mandatory dedicated agent preset.
- Functional parity is established against the exact intended PI extension, not assumed from its diagram or another similarly named package.
- Real delegation, coordination, per-agent context and results match the reference behavior; visualization accompanies actual execution.
- Document any DSH or native-harness capability boundary rather than silently substituting a different execution architecture.

No replacement implementation is included in this archive operation.
