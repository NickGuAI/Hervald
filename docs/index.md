# Hervald Docs

Hervald is the operating system for a personal agent fleet: commanders,
workers, channels, workspace context, approvals, provider credentials, and
memory in one operator-controlled runtime.

Use these docs in this order when you are setting up or operating the product.

## Start Here

1. [Quickstart](getting-started/quickstart.md): install Hervald and reach the
   first useful commander chat.
2. [Provider auth](operate/provider-auth.md): connect Codex, Claude Code,
   Gemini CLI, or OpenCode on the host that runs the provider.
3. [Machines and workers](operate/machines.md): attach local or remote machines
   for worker execution.
4. [Troubleshooting](troubleshoot.md): recover from missing CLIs, stale API
   keys, unavailable machines, and docs/install drift.
5. [llms.txt](llms.txt): compact agent-readable map of the public docs.

## Core Concepts

- [Commanders](concepts/commanders.md): durable agent identities, memory,
  conversations, quests, and worker ownership.
- [Workers](concepts/workers.md): delegated execution sessions on local or
  remote machines.
- [Command Room](concepts/command-room.md): the main operating surface for
  chat, queue, workspace, quests, and approvals.
- [Approvals](concepts/approvals.md): human-gated action policy and pending
  tool decisions.

## Operate Hervald

- [Provider auth](operate/provider-auth.md)
- [Machines and workers](operate/machines.md)
- [Workspace](operate/workspace.md)
- [Channels](operate/channels.md)

## Reference

- [CLI reference](reference/cli.md)
- [API reference](reference/api.md)
- [Naming policy](reference/naming.md)
