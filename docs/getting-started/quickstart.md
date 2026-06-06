# Hervald Quickstart

This guide takes a clean machine from install to the first useful commander
interaction. The endpoint is not "the app built"; the endpoint is a commander
chat or worker action that proves Hervald can operate on your machine.

## 1. Install

Run the installer on the machine that will host the control plane:

```bash
curl -fsSL https://hervald.gehirn.ai/install.sh | bash
```

The installer prepares a hermetic Node/pnpm toolchain, clones the public
Hervald repo, writes the local env file, installs dependencies, builds the app,
starts the shell once, creates a bootstrap API key, and prints the local sign-in
URL.

Verification:

- The command exits successfully.
- The output includes a local URL and bootstrap key or sign-in instructions.
- The Hervald process exposes `/api/health`.

## 2. Open Hervald

Open the URL printed by the installer. On first boot, Hervald may use the
zero-config API-key path if Auth0 is not configured. Hosted or production
deployments may redirect through Auth0.

Verification:

- The browser reaches the Hervald shell.
- The first-run screen appears, or the main Command Room appears if setup was
  already completed.
- If the browser reports a stale API key, clear the stored key from the landing
  page and use the current bootstrap key from the installer output.

## 3. Complete First Run

Follow the First Run flow:

1. Confirm the founder and organization profile.
2. Seed Gaia when prompted.
3. Install or intentionally skip the starter workforce.
4. Review provider readiness.
5. Review machine readiness.

Partial setup is valid. Unchecked providers and machines remain unavailable
until you return and verify them.

Verification:

- The First Run screen marks setup complete or intentionally skipped.
- At least one commander is visible in the Command Room or Org view.
- Provider and machine warnings are explicit instead of silent failures.

## 4. Connect Provider Auth

Hervald uses provider CLIs on the host where the provider runs. Authenticate the
original provider tool, then refresh Hervald provider status.

Common paths:

```bash
codex auth status
claude auth status
gemini auth status
opencode auth status
```

If a provider is not authenticated, run that provider's native login command on
the same host. For example, Claude Code authentication belongs to Claude Code;
Hervald only reports and uses that local status.

Verification:

- The Provider Auth panel shows at least one provider as ready, or the missing
  provider has explicit login steps.
- The connected provider is available when starting a commander or worker.

See [provider auth](../operate/provider-auth.md) for the detailed contract.

## 5. Attach Or Verify A Machine

For local work, the host that runs Hervald can also run workers. For remote work,
attach a machine over SSH or Tailscale after ordinary SSH works.

Verification:

- The Machines view shows the intended host.
- The machine is reachable over SSH before it is used for worker dispatch.
- Worker logs show commands executing on the expected host.

See [machines and workers](../operate/machines.md) for host routing details.

## 6. Start The First Useful Commander Run

Open Command Room, select a commander, and send a small, verifiable task:

```text
Read the current workspace README and summarize the setup command.
```

For worker orchestration, dispatch a bounded task that can report a concrete
artifact, such as a file path, issue URL, or test command result.

Verification:

- The chat receives a response from the selected commander.
- If a worker is used, its output is visible under the correct worker block.
- Workspace context, file links, or command results match the selected target.

## Recovery Map

| Symptom | Check | Recovery |
|---|---|---|
| Installer cannot run | `git`, `curl`, `tar`, outbound HTTPS | Install the missing tool and rerun the installer. |
| Browser cannot reach app | `/api/health`, process logs, port `20001` | Restart Hervald and confirm the printed URL. |
| API key rejected | local browser storage, latest installer output | Clear the stale key and use the current bootstrap key. |
| Provider unavailable | native provider auth status on that host | Run the provider login command on the provider host. |
| Machine unavailable | ordinary SSH, Tailscale status, machine registry | Fix SSH/Tailscale first, then bootstrap the machine. |
| Docs link missing | Docs index and `llms.txt` | Sync the public docs tree before publishing. |

Next: read [Commanders](../concepts/commanders.md), [Command Room](../concepts/command-room.md),
and [Workspace](../operate/workspace.md).
