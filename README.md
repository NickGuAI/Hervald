# Hervald

Hervald is the agent orchestration OS.

Cursor is obsolete. Pair-programming with one chatbot is a dead end; the future of agent interaction is a fleet of agents running on machines you control, holding persistent memory, and answering to an approval system you own.

Hervald owns mission state, worker orchestration, memory, approvals, and the command-room surface. Connectivity is delegated to infrastructure you already trust: SSH, Tailscale, hosted runtimes, and your own reverse proxy. The mission graph and execution rules stay stable even when the underlying transport changes.

The product-facing brand is Hervald. Internal code paths still use the Hammurabi engine names: `apps/hammurabi`, `hammurabi-cli`, `~/.hammurabi`, and `HAMMURABI_*`.

## Quickstart

The installer is hermetic for the Node toolchain. It needs `git`, `curl`, `tar`, and outbound HTTPS; it installs Node `22.12.0` and pnpm `10.23.0` under `~/.hammurabi/toolchain` without replacing or relying on your system Node.

### Mac mini / Local workstation

```bash
curl -fsSL https://hervald.gehirn.ai/install.sh | bash
```

The installer clones Hervald, prepares `apps/hammurabi/.env`, installs the hermetic toolchain and dependencies, builds the app, boots the shell once, seeds a one-time bootstrap API key, and prints the local sign-in URL.

### EC2

1. Provision a box with working SSH and outbound internet access.
2. Run the same installer command.
3. Put your reverse proxy or private-network path in front of port `20001`.
4. Attach remote workers over SSH or Tailscale once the control plane is up.

### Railway

1. Clone the repo.
2. Run `pnpm install`.
3. Build with `pnpm --filter hammurabi run build`.
4. Start with `pnpm --filter hammurabi start`.
5. Keep `AUTH0_*` unset if you want the zero-config API-key path on first boot.

## Tailscale Worker Attach

When the server and workers do not share a flat network:

1. Put the Hervald host and worker host in the same tailnet.
2. Verify ordinary SSH works first.
3. Register the worker with `hammurabi machine add ...`.
4. Bootstrap it with `hammurabi machine bootstrap ...`.

Full guide: [Tailscale quickstart](https://hervald.gehirn.ai/docs/tailscale-quickstart).

## Docs

Full documentation lives at [hervald.gehirn.ai/docs](https://hervald.gehirn.ai/docs):

- [Architecture overview](https://hervald.gehirn.ai/docs/architecture)
- [Installation](https://hervald.gehirn.ai/docs/installation)
- [Provider auth setup](https://hervald.gehirn.ai/docs/provider-auth-setup)
- [Operator guide](https://hervald.gehirn.ai/docs/operator-guide)
- [Approval routing](https://hervald.gehirn.ai/docs/approval-routing)
- [Troubleshoot](https://hervald.gehirn.ai/docs/troubleshoot)

## License

Hervald is source-available under the [PolyForm Noncommercial 1.0.0](./LICENSE) license.

- Personal and other noncommercial use is allowed under that license.
- Commercial use requires a separate written agreement.
- See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md) and [NOTICE](./NOTICE).
