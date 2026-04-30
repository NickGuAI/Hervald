# Troubleshoot

Common issues and where to look first.

## Install / first boot

### `command not found: pnpm` after the installer ran

The installer attempts to enable pnpm via `corepack`. On older Node installs `corepack` may not be on `PATH`. Fix:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

Then re-run `bash apps/hammurabi/install.sh`.

### `EADDRINUSE: address already in use :::20001`

Another process is using port 20001. Find it and decide whether to stop it:

```bash
lsof -i :20001
```

Or run Hervald on a different port:

```bash
PORT=20002 pnpm --filter hammurabi start
```

### Bootstrap key missing

The installer printed the bootstrap key on first boot and wrote it to `~/.hammurabi/bootstrap-key.txt`. If the file is gone, restart with bootstrap seeding:

```bash
HAMMURABI_BOOTSTRAP=1 pnpm --filter hammurabi start
```

## Sign-in

### `401 Unauthorized` after pasting the API key

The key is correct but the request did not carry it. Most often this is a stale browser session. Hard-refresh with `Cmd+Shift+R` (macOS) or `Ctrl+Shift+R` (Linux/Windows). If you set up Auth0, double-check that the audience and domain match between backend and frontend `.env`.

### Browser shows "API key required" but you pasted one

The first request fired before the key was stored in `localStorage`. Hard-refresh after pasting the key.

## Workers / SSH

### `Permission denied (publickey)` when attaching a worker

The worker host does not have your operator SSH public key in its `~/.ssh/authorized_keys`. Add it:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@worker-host
```

Or paste the key by hand if `ssh-copy-id` is not available.

### `sshd: skipped: no-sudo` when running `hammurabi machine bootstrap`

The bootstrap step that updates the worker's `sshd_config` requires `sudo` without a password prompt. On macOS, add a `NOPASSWD` rule for your user, or run the listed `sudo tee -a /etc/ssh/sshd_config` commands manually as a sudo user.

### Worker shows `connected` but provider auth fails

The provider CLI on the worker is not signed in. SSH into the worker and run:

```bash
claude login    # or codex login, gemini auth login
```

Then re-trigger auth verification from the operator UI: **Workers** → the worker → **Verify auth**.

## Provider events

### Agent message streams but no tool runs ever happen

Check the action-policy gate. If your policy is set to `review` for all tools, every tool call sits in the approval queue waiting for you. Open **Approvals** in the UI to clear the queue, or relax the policy to `auto` for safe actions.

### Approval queue grows but nothing dequeues

The approval daemon may have lost its connection to the provider. Restart the session: **Sessions** → kill → **Resume from previous session**.

## Logs

The shell writes structured logs to:

- macOS / Linux: `~/.hammurabi/logs/server.log`
- Per-session events: `~/.hammurabi/agents/stream-sessions.json`
- Approval audit: `~/.hammurabi/policies/audit.jsonl`

For real-time debugging, run the server in the foreground and tail stdout:

```bash
pnpm --filter hammurabi start 2>&1 | tee /tmp/hervald-debug.log
```

## Where to ask

If something breaks in a way these notes don't cover, open an issue on [the public repo](https://github.com/NickGuAI/Hervald/issues) with:

- the install command you ran,
- the exact error message,
- the contents of `~/.hammurabi/logs/server.log` from the time of the failure (redact API keys before pasting).

## Next

- [Operator guide](./operator-guide.md) — module surface
- [Approval routing](./approval-routing.md) — policy semantics
