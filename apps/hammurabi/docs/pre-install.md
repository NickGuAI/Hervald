# Pre-Install

Read this before you run the installer.

## What Hervald is

Hervald is a self-hosted control plane for agent operations. You run the shell on your own machine, attach worker hosts that hold provider login state (Claude, Codex, Gemini), and use the operator UI to dispatch agent sessions. The shell does not call out to a hosted backend; everything is local to the machines you control.

## What you need on the host

- **Operating system:** macOS 13 or newer, or Linux x86_64 / arm64. Windows works under WSL2 but is not the recommended path.
- **Node.js:** version 20 or newer. The installer can install Node via Homebrew on macOS or `nvm` on Linux if it is missing.
- **pnpm:** version 10 or newer. The installer enables pnpm via `corepack` if it is missing.
- **git, curl, bash:** standard developer toolchain.
- **Disk:** ~2 GB for the repo, dependencies, and runtime data.
- **Memory:** 4 GB free is comfortable; 2 GB is the minimum for a single-commander operator setup.

## What you need for workers

You can run worker agents on the same host as the shell, or on remote machines. Either way, each worker box needs the provider CLI you intend to use:

- **Claude:** `claude` CLI installed and signed in (`claude login`).
- **Codex:** `codex` CLI installed and signed in (`codex login`).
- **Gemini:** `gemini` CLI installed and signed in (`gemini auth login`).

You do not have to install all three. Pick the providers you actually use; Hervald lets you mix per worker.

## Network reachability

Hervald uses SSH (or SSH over a private network like Tailscale) to reach worker hosts. The control plane needs to be able to:

- Open an outbound TCP connection to each worker host on port 22 (or your configured SSH port).
- Forward a few environment variables (`HAMMURABI_INTERNAL_TOKEN`, etc.) over `SendEnv` / `AcceptEnv`.

For worker hosts behind NAT, see the [Tailscale quickstart](./tailscale-quickstart.md).

## Provider login state

Each provider CLI keeps its login token in your home directory (`~/.claude/`, `~/.codex/`, `~/.gemini/`). Hervald reads those tokens at session-start time on the worker box; it does not transmit them off the worker. Keep workers on machines you control.

## Choose your install target

| Target | When to use |
|---|---|
| **Mac mini** | You want a stable always-on workstation at home with local SSD, GUI access, and clean daemonized sessions. |
| **EC2 / VPS** | You want a public, routable control plane that fits a shared-ALB or reverse-proxy deployment. |
| **Railway** | You want the shortest path from repo to running service and are comfortable delegating the machine layer. |

When you have picked a target, continue to the matching install guide.

## Next

- [Installation](./installation.md) — per-target install steps
- [First login](./first-login.md) — bootstrap key and permanent API key
- [First session](./first-session.md) — dispatch your first agent
