# Hervald

Hervald is the agent orchestration OS.

Cursor is obsolete. Pair-programming with one chatbot is a dead end; the future of agent interaction is a fleet of agents running on machines you control, holding persistent memory, and answering to an approval system you own.

Hervald owns mission state, worker orchestration, memory, approvals, and the command-room surface. Connectivity is delegated to infrastructure you already trust: SSH, Tailscale, hosted runtimes, and your own reverse proxy. The mission graph and execution rules stay stable even when the underlying transport changes.

## Quickstart

The installer is hermetic for the Node toolchain. It needs `git`, `curl`, `tar`, and outbound HTTPS; it installs Node `22.12.0` and pnpm `10.23.0` in a local toolchain directory without replacing or relying on your system Node.

### Mac mini / Local workstation

```bash
curl -fsSL https://hervald.gehirn.ai/install.sh | bash
```

The installer clones Hervald, prepares the local app environment file, installs the hermetic toolchain and dependencies, builds the app, boots the shell once, seeds a one-time bootstrap API key, and prints the local sign-in URL.

Continue with the [full quickstart](./docs/getting-started/quickstart.md) to
complete first-run onboarding, provider auth, machine readiness, and the first
useful commander run.

## Bundled Commander Workforce

Fresh Hervald installs include a backend-owned commander marketplace and a
starter workforce:

- Asina: engineering manager for issue triage, code investigation, review,
  orchestration, and release follow-through.
- Einstein: research intelligence analyst for web research, knowledge search,
  domain distillation, and reports.
- Alfred: general assistant for meeting prep, scheduling support, inbox/doc
  triage, and daily follow-through.

Open the Marketplace page or complete first-run onboarding to install the
starter workforce. Packages are inspectable in the bundled commander package
directory; each package contains `COMMANDER.md`, `skills.manifest.json`,
`memory-seed.md`, `onboarding.md`, and examples. The required starter skill dependencies ship in
`agent-skills/hervald-starter/` so a fresh public checkout has the workflows the
bundled commanders advertise.

### EC2

1. Provision a box with working SSH and outbound internet access.
2. Run the same installer command.
3. Put your reverse proxy or private-network path in front of port `20001`.
4. Attach remote workers over SSH or Tailscale once the control plane is up.

### Railway

1. Clone the repo.
2. Run `pnpm install`.
3. Build with `pnpm run build`.
4. Start with `pnpm start`.
5. Keep `AUTH0_*` unset if you want the zero-config API-key path on first boot.

## Tailscale Worker Attach

When the server and workers do not share a flat network:

1. Put the Hervald host and worker host in the same tailnet.
2. Verify ordinary SSH works first.
3. Register the worker from the Machines view.
4. Bootstrap it from the Machines view.

Full guide: [machines and workers](./docs/operate/machines.md).

## Docs

Full documentation lives under [`docs/`](./docs/index.md):

- [Quickstart](./docs/getting-started/quickstart.md)
- [Provider auth](./docs/operate/provider-auth.md)
- [Machines and workers](./docs/operate/machines.md)
- [Command Room](./docs/concepts/command-room.md)
- [Approvals](./docs/concepts/approvals.md)
- [Troubleshooting](./docs/troubleshoot.md)
- [Agent-readable llms.txt](./docs/llms.txt)

## License

Hervald is source-available under the [PolyForm Noncommercial 1.0.0](./LICENSE) license.

- Personal and other noncommercial use is allowed under that license.
- Commercial use requires a separate written agreement.
- See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md) and [NOTICE](./NOTICE).
