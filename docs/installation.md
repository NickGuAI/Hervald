# Hervald Installation

Use the installer if you want the shortest path to a running local shell:

```bash
curl -fsSL https://hervald.gehirn.ai/install.sh | bash
```

That path installs dependencies, prepares `apps/hammurabi/.env`, starts the server once with bootstrap seeding enabled, and prints the local sign-in URL plus the one-time API key.

## Prerequisites

- Git
- Curl
- Node.js 20 or newer
- A shell that can run `bash`

The installer will try to help with Node and pnpm if they are missing.

## Mac Mini

1. Clone the repo or run the installer directly.
2. If you cloned the repo, run `bash apps/hammurabi/install.sh`.
3. Open the local URL printed by the installer, usually `http://localhost:20001`.
4. Sign in with the bootstrap API key from `~/.hammurabi/bootstrap-key.txt`.
5. Create a permanent API key in Settings, then rotate or revoke the bootstrap key.

This is the cleanest setup when the same machine also has Claude, Codex, or Gemini already authenticated.

## EC2 / VPS

1. Provision a box with outbound internet access and working SSH.
2. Clone the repo.
3. Run `bash apps/hammurabi/install.sh`.
4. Expose port `20001` through your preferred reverse proxy or private network path.
5. If worker machines are separate, register them with `hammurabi machine add ...` and bootstrap them over SSH.

Use this target when you want a stable always-on control plane and predictable SSH reachability to worker machines.

## Railway

1. Clone the repo and connect it to your Railway project.
2. Run `pnpm install` at the workspace root.
3. Build with `pnpm --filter hammurabi run build`.
4. Start the app with `pnpm --filter hammurabi start`.
5. Leave `AUTH0_*` unset if you want API-key-only first boot.
6. Attach real workers over SSH or Tailscale once the control plane is reachable.

Railway is a good fit for hosting the shell. It is not a replacement for the worker machines that hold provider login state.

## After First Boot

1. Confirm you can open the shell and sign in.
2. Create a permanent API key in Settings.
3. Run `hammurabi onboard` on operator machines if you want managed telemetry config for Claude, Codex, or Cursor.
4. Attach additional workers with direct SSH or the Tailscale path.

## Related Docs

- [Architecture Overview](./architecture-overview.md)
- [Tailscale Quickstart](./tailscale-quickstart.md)
- [Provider Auth Setup](./provider-auth-setup.md)
