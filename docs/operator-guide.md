# Hervald Operator Guide

This guide maps the live shell to the current modules and surfaces in `apps/hammurabi`.

## Top-Level Navigation

The primary shell routes are:

- `Command Room`
- `Fleet`
- `Settings`

The secondary routes are:

- `Telemetry Hub`
- `Services Manager`
- `Action Policies`

Legacy `/agents`, `/commanders`, `/quests`, `/sentinels`, and `/workspace` routes redirect into the Hervald shell rather than maintaining separate UIs.

## Command Room

Command Room is the operator center.

- Left column: commanders, approvals, and sentinels.
- Center column: `Chat`, `Quests`, `Sentinels`, `Automation`, and `Identity` tabs.
- Right column: the selected commander's team and worker state.

Use this surface when you want to start a commander, hand off work, inspect the current quest lane, or look at worker ownership from one place.

## Commanders

Commanders are the long-lived operator personas that own work.

- Create them from the Command Room.
- Start them with the provider you want: Claude, Codex, or Gemini.
- Use the `Identity` tab to inspect persona, workflow, and operator-owned metadata.

## Quests

Quests are the explicit work items attached to a commander.

- Add quests from the `Quests` tab.
- Use them to track GitHub issues, manual instructions, or follow-up tasks.
- Keep the quest list operator-readable; it is the contract between you and the commander lane.

## Sentinels

Sentinels are scheduled or persistent watchers tied to a commander.

- Create and edit them from the `Sentinels` tab.
- Seed sentinel memory when you need durable context for repeated checks.
- Use sentinels when you need periodic monitoring rather than one-shot delegation.

## Memory Surfaces

Hervald’s memory model is file-first and layered:

- Durable facts: `.memory/MEMORY.md`
- Active scratchpad: `.memory/working-memory.md`
- Prior execution recall: indexed transcript search

Operators should treat memory as a workflow surface, not a hidden black box. If a commander is carrying important context, make sure it exists in durable memory or working memory rather than only in a transient session.

## Settings and API Keys

The `Settings` route is where you:

- create or revoke API keys
- manage appearance and operator-facing defaults
- confirm the current shell build and identity state

On zero-config first boot, API-key sign-in is the expected path. Add Auth0 later only if you need SSO.

## Telemetry and Services

- `Telemetry Hub` shows ingest and cost state.
- `Services Manager` is the runtime and integration control surface.
- `Action Policies` is where you define what can auto-allow, review, or block.

## Recommended First Operator Loop

1. Sign in with the bootstrap key.
2. Create a permanent API key.
3. Start one commander.
4. Add one quest.
5. Attach one worker over SSH or Tailscale.
6. Verify that telemetry and approvals look correct before scaling out.
