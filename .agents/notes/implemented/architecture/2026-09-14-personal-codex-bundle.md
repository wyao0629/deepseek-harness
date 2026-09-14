# Agent Note: Personal Codex bundle

Status: implemented

English | [中文](2026-09-14-personal-codex-bundle.zh.md)

## Problem

The personal fork needs a reproducible Codex integration without copying machine credentials or coupling its packaging to upstream releases.

## Decision

The [personal installer](../../../../personal/install.mjs) enables the existing dsh-codex package as an out-of-tree profile bundle. The original package identity and prebuilt JavaScript are retained. Provider credentials stay in the runtime data directory. GitHub Actions is disabled for the fork, and publishing code does not deploy the live server.

## Alternatives considered

**An upstream workspace package** would place the personal plugin in official publication and generated catalogs. An independent profile bundle preserves the tested package identity and reduces future merge work.

**Machine configuration snapshots** would couple installation to existing secrets and session paths. The installer instead creates only the required preset and generates local runtime state.

## Consequences

A cloned checkout can recreate the profile after a local build. The compiled Session compatibility patch must be reapplied after builds. Native reverse-import compatibility remains tied to the tested DSH loop version. Installer and plugin tests run locally; disabling Actions intentionally removes automated checks from pushes.
