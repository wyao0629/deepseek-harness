# Personal DSH distribution

English | [中文](README.zh.md)

This directory adds the independently installable [dsh-codex bundle](dsh-codex/README.md) to this fork. Upstream packages and release scripts keep their original layout. Supported deployment: Linux, Node.js 24, pnpm, and Codex CLI 0.154.0 on PATH.

## Install from this fork

Run as the account that will run DSH. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run build
node personal/install.mjs
pnpm dsh --profile web
```

The installer adds the local bundle to the web profile, creates the Codex preset, and applies the required compiled Session event metadata and native command-menu compatibility fixes. Existing installations must match this checkout's commands package version; build this checkout first. It does not start or restart services. Keep the checkout at this path: the profile links its plugin directory. Configure providers and credentials in DSH after launch.

Set `DSH_HOME`, `DSH_PROFILE`, `CODEX_HOME`, or `CODEX_BIN` before installation and launch to select a different data directory, profile, native session directory, or Codex executable. Defaults use the current account; no server address or credentials are included. An overwritten preset or compiled Session/commands module gets one small content-addressed backup under `$DSH_HOME/backups/dsh-codex`.

For an existing installed DSH, provide its exact package manifest and executable:

```bash
DSH_PACKAGE_JSON=/path/to/dsh/package.json DSH_BIN=/path/to/dsh node personal/install.mjs --installed
```

## Update

Pull this fork, install the locked dependencies, build, and run the installer again before restarting DSH. A build replaces the compiled compatibility change, so rerun the installer after every build. Repository updates alone do not update an already-running server.

GitHub Actions is disabled in this personal fork. Keep it disabled before future pushes when no workflows are wanted; commit skip markers alone do not cover every event type. See the [integration decision](../.agents/notes/implemented/architecture/2026-09-14-personal-codex-bundle.md).
