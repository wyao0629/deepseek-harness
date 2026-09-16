# dsh-pi-collab

English | [中文](README.zh.md)

Independent multi-agent collaboration for DSH, modeled on the local PI-Desktop task lifecycle. It uses DSH child sessions and background jobs; it does not embed the PI-Desktop runtime or replace native Kimi/Codex harnesses.

## Use

Select **多 Agent 协作** when creating a session, select a configured DSH model, and describe the work to delegate. For example: “Ask a researcher to inspect the code and a reviewer to identify risks independently, then summarize both results.” Each task receives its explicit brief, not the parent's conversation history.

The model can use these tools:

| Tool | Behavior |
| --- | --- |
| `TaskCatalog` | List researcher, worker, reviewer and test-runner roles. |
| `Task` | Start a background child; at most four active children per parent. Optional provider/model and reasoning effort use existing DSH routes. |
| `TaskList` | Show this parent's tasks and child session identifiers. |
| `TaskWait` | Wait for all or a minimum number of results; timeout does not cancel children. |
| `TaskStop` | Cancel selected tasks, or this parent's tasks when IDs are omitted. |

DSH's job controller delivers completion notices and resumes the parent. Child execution uses the existing permission and workspace mechanisms. Task cards show real status, model, separate reasoning and output; messages update when each child model step commits, not on every token.

## Deployment and boundaries

This is a profile bundle: `cordis.patch.yml` mounts the host installer, which creates the `pi-collab` agent preset on first activation. The preset mounts `dsh-pi-collab/tools` alongside standard DSH tools and its background-job controller. It requires the host's `spawn` provider, jobs, tools and LLM services. Browser code uses DSH's client module loader.

The current server deployment links this directory into the web profile, declares the bundle in the profile manifest, and shares the installed DSH dependencies. Existing presets are never overwritten automatically.

Task controls are process-local. Persisted conversation cards survive reloads, but in-flight jobs do not resume after a server restart. Roles are currently the four bundled definitions; custom role editing, nested delegation and steering a running child are not implemented. Use this preset for DSH-native model execution; native Kimi and Codex presets retain their own collaboration mechanisms.

## Validation

Run `node --test personal/dsh-pi-collab/test/*.test.mjs` from the repository root. Five tests cover independent results, concurrent limits, ownership, timeout, cancellation, startup failure, resource disposal and isolated UI reduction. The server functional-test workspace also contains **独立多 Agent 协作验收 0916**, verifying two actual child results, cancellation and automatic parent wakeup. Browser inspection verified the task tree and separate child output.
