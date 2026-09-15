# Agent Note: Session menu contributions

Status: implemented

English | [中文](2026-09-15-session-menu-actions.zh.md)

## Problem

The session menu lacked directory, direct-link and Markdown copy actions. Copy operations also needed explicit progress and clipboard completion feedback.

## Decision

Expose reversible, observable session-menu descriptors through the existing UiWorkspace service. Components receive descriptors through an injected framework hook and target the clicked row, independently of the active conversation. The personal dsh-session-actions plugin owns copy behavior and URL navigation.

## Validation

Client type checking, workspace bundle build, 85 focused UI tests and four plugin tests passed. The deployed server advertises and serves both updated client bundles. A real functional-test conversation exported the expected user and assistant text. Browser interaction acceptance remains incomplete because browser automation timed out on the hover-only row control.

## Limitations

Markdown includes settled user and assistant text, code blocks and image placeholders; it excludes thought/tool records and in-flight token deltas. Deep links require the plugin at the destination and do not bypass authentication. Pagination uses the opening log cut and reports failures rather than copying a partial transcript.

## Alternatives considered

Hard-coding copy operations in the workspace component would couple the optional plugin to the base menu. DOM injection would bypass the menu lifecycle. Reversible service contributions keep those responsibilities separate.

## Consequences

The plugin requires the personal menu API. Markdown copies display progress, success after clipboard settlement, and errors through the standard Toast. The nested remote.session injection is explicit and covered by the built-entry regression test.
