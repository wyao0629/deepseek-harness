# Session actions

English | [中文](README.zh.md)

Open a session row’s ellipsis menu to copy its server working directory, a direct session URL, or the full settled user/assistant Markdown transcript. Code blocks remain intact; tool logs and reasoning are omitted, and images use attachment placeholders. Links contain no access token and retain the server’s normal access checks.

This plugin requires the personal fork’s `uiWorkspace.registerSessionMenuAction` extension. Load the `dsh-session-actions` bundle in the Web profile and refresh the browser. Disabling the plugin withdraws the three actions. Exports paginate at a fixed log cut and fail rather than silently return incomplete history. Clipboard access requires trusted HTTPS.

Build with `node build.mjs`; test with `node --test test/*.test.mjs`.
