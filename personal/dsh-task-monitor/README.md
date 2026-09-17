# DSH task monitor

English | [中文](README.zh.md)

Runs scheduled commands as independent systemd services and suspends the standard DSH agent before its next model request while registered jobs are running. Monitoring reads local state every five seconds without invoking a model. Completion, nonzero exit, cancellation, interruption and timeout produce one result notification. Requires Linux, systemd, and the existing harness account permission to launch its services via sudo.

Tools: `task_monitor_start(command, cwd?, timeout_seconds?)`, `task_monitor_status()`, `task_monitor_cancel(job_id)`. Default deadline is 24 hours, maximum seven days. Jobs use the harness account and explicit project environment files; model credentials are not inherited. State and logs live in `~/.dsh/task-monitor/<job-id>/`.

Stop in DSH cancels the agent wait, not the job. Stop first and send a cancellation request to cancel a running job. Job completion can wake that session later. A DSH restart preserves jobs; a host reboot interrupts them and does not blindly rerun ETL. Delivery acknowledgement follows session persistence; restored idle inbox notifications are requeued by stable identity. Exit zero is process success, not proof of complete database publication.

This only gates registered jobs and standard DSH model steps. Existing Bash background commands and external native CLI loops are not intercepted. No generic detection of a silent job being stuck: its configured deadline decides timeout. Status is available through the status tool and systemd/Cockpit; this release has no custom live web dashboard.

Tests: `node --test test/*.test.mjs`. Real deployment acceptance uses only the 功能测试 workspace. No model settings are modified. Uninstalling the plugin stops monitoring but deliberately leaves independent jobs running; cancel jobs explicitly before uninstalling if desired.

The plugin contributes Chinese usage guidance through the native DSH runtime context. Existing and new sessions receive it on their next model request, with snapshots recorded and managed by DSH. Guidance covers scheduling intent, preparation, start, waiting, status, cancellation, and business validation. It does not append a chat message on every step or execute commands from keywords alone.
