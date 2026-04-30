# First Session

This page takes you from a freshly installed Hervald to your first agent session producing a real event in the session log. Allow about 5 minutes.

## Prerequisites

- The shell is running and you have a permanent API key. See [First login](./first-login.md).
- At least one provider CLI is installed and signed in on the same host as the shell, or on a remote worker you have already attached. See [Provider auth setup](./provider-auth-setup.md).

## 1. Create a commander

A **commander** is the named persona that owns a body of work. Commanders persist across sessions and accumulate memory.

In the operator UI:

1. Open **Commanders**.
2. Click **New commander**.
3. Give it a name (`Engineering Lead`, `Personal Operator`, anything stable).
4. Choose the provider that will run this commander's main session (Claude, Codex, or Gemini).
5. Save.

You can also create one from the CLI:

```bash
hammurabi commanders create --name "Engineering Lead" --provider claude
```

The CLI prints the new commander's UUID. Keep it; later commands accept either the name or the UUID.

## 2. Start the commander session

A commander runs as a long-lived agent session that you talk to over the operator chat surface.

1. Open the commander you just created.
2. Click **Start session**.
3. The session opens with an empty chat window.

The session is now live. The status badge at the top should read `running`.

## 3. Send the first message

Type a real task into the chat. Something concrete works best for verification:

```
List the files in the current working directory.
```

The agent will respond. You should see:

- A streaming assistant response.
- A tool-use event in the session log (the agent ran `ls` or equivalent).
- A tool-result event with the directory contents.

If the agent asks for approval before running the tool, that is the action-policy gate working. Click **Approve** and the run continues.

## 4. Verify the event in the log

Open **Sessions** → your session → **Events** tab. You should see a chronological list with:

- `user_message`
- `assistant_message`
- `tool_use`
- `tool_result`
- (optional) `approval_requested`, `approval_granted`

Each event has a timestamp and is searchable.

## 5. Dispatch a worker (optional)

A worker is a one-off agent session for a focused task, owned by a commander.

```bash
hammurabi workers dispatch \
  --commander "Engineering Lead" \
  --task "Open a draft PR that fixes the lint error in src/utils.ts" \
  --provider claude
```

The worker spawns its own session, runs the task, and exits. You can watch its events under **Workers** in the UI.

## What you have now

- A signed-in operator surface.
- A live commander session producing real provider events.
- A working approval flow.

This is the verification target for any deploy. If the steps above work end-to-end, the install is complete.

## Next

- [Tailscale quickstart](./tailscale-quickstart.md) — attach a NAT-bound worker
- [Operator guide](./operator-guide.md) — the full module surface
- [Approval routing](./approval-routing.md) — policy-driven approvals
- [Architecture overview](./architecture-overview.md) — what runs where
