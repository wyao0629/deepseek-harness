# dsh-grok-build

English | [中文](README.zh.md)

Use Grok Build as the Agent runtime inside DeepSeek Harness, rather than only using Grok as a model. DSH owns conversation, traces, approval and persistence; Grok Build owns the agent loop, tools, compaction and skills. Select the Grok preset when creating a conversation. This package does not replace the global AgentFactory or remove DSH model selection; other presets are unchanged.

## Installation

Install the official Grok CLI using the vendor's installer at `https://x.ai/cli/install.sh`. The development deployment uses `~/.grok/bin/grok`.

From the plugin directory, add the package to the Web profile:

```sh
dsh plugin --profile web add "link:$(pwd)"
```

Restart DSH Web, create a conversation and select Grok. The default custom model is `dsh-grok-46`, configured in `~/.grok/config.toml` to use an existing OpenAI-compatible gateway. The built-in `grok-4.6` uses the official x.ai service and requires `grok login` or an official API key.

## Authentication

Grok Build resolves credentials according to its own documented precedence. Common methods are `grok login`, which writes `~/.grok/auth.json`, and `XAI_API_KEY` or a custom endpoint's `env_key` in `~/.grok/config.toml`.

The plugin forwards DSH's existing `XAI_API_KEY`, `TOKENSHOP_API_KEY` and `GROK200K_API_KEY` to the Grok child process rather than saving another token copy.

## Removal

```sh
dsh plugin --profile web exec dsh-grok-build remove-preset
dsh plugin --profile web remove dsh-grok-build
```

A user-modified `~/.dsh/.agent-presets/grok` is not deleted.

## Native command palette

This fork's command registry supports preset switching. `/grok help` initializes the native connection; commands announced over Grok ACP subsequently appear in the slash menu and dispatch directly to Grok. Global DSH commands use `/dsh <command>`. Each session registers its own catalog. During the first handshake, help text can arrive before the command catalog.
