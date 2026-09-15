# DSH workspace deletion guard

English | [中文](README.zh.md)

## Scope

This optional personal plugin asks before detected file-deletion tool calls in the DSH tool pipeline. Ordinary development calls continue without a question. It uses the existing execution identity and does not change model settings or native harness adapters.

## Operation

The deployed Web Profile resolves this directory as `dsh-workspace-guard` and inserts the `workspace-delete-guard` row from `cordis.patch.yml`. The supplied `policy.json` requires per-call approval. The deployment used a profile node_modules symlink and a live profile patch; no service restart was needed. A future installation must mount the row: merely pulling the repository does not enable it.

For a detected deletion, the question displays the complete tool arguments and working directory. Choose the explicit allow option to authorize that invocation, or refuse. Approval is bound to that invocation and its arguments, never an entire session. Ordinary natural-language permission is not automatically converted into a grant in this version; the user answers the dedicated question. Calls too large to display must be split.

Unreadable or malformed policy, unavailable question service, cancellation, or changed arguments denies the detected deletion. A final monotonic guard prevents a later pre-tool listener from overriding the denial. This does not protect against unloading the plugin or changing its source with the shared account.

## Evidence

Seven Node tests cover ordinary calls with missing configuration, failure denial, explicit authorization, parameter changes, cancellation, and known deletion patterns. The deployed standard-preset acceptance session reached a visible waiting-for-answer state for `rm --version`; the test was then cancelled without deleting files. Browser allow/refuse completion was not verified because automation timed out. Authorized execution is covered by the automated test, not claimed as browser acceptance.

## Limitations and deferred work

Detection recognizes direct deletion tool names, patch file removal, common shell cleanup commands, and selected inline script calls. It is not a shell parser or an operating-system boundary. It can miss aliases, encoded commands, external scripts, and destructive behavior of other tools; text matching can also request approval for harmless commands such as the version probe. Writing a document that mentions a deletion command is not itself intercepted.

Native Codex, Kimi, Grok Build and Claude execution paths are not certified by this change. The existing Kimi adapter can approve native requests automatically under its never-ask policy. Keep daily work on the DSH standard/native mode while that integration is deferred. Workspace placement enforcement, grant reuse from explicit user instructions, and complete context-rule injection are also not implemented here.

The follow-up must map each native pre-execution seam, apply the same policy before native auto-approval, bind grants to exact operations, cover children and direct CLI usage separately, and test refusal, cancellation, disconnection and restart. Do not infer coverage from an approval button alone.

## Runtime records

The session receives `workspace-guard/decision` events containing tool name, call id, decision reason and an input hash; the plugin does not duplicate raw arguments into these events. DSH may still retain arguments in its normal tool history. Checker failures emit a generic server warning. Acceptance files and the one small profile backup are under the functional-test workspace, grouped by project and date.
