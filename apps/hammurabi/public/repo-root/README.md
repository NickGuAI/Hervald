# Hervald

Hervald owns orchestration; connectivity is delegated.

![Hervald launch architecture](https://raw.githubusercontent.com/NickGuAI/Hervald/main/docs/diagrams/launch-architecture.svg)

Hervald is the public entry point for the Hammurabi engine. The product-facing brand is Hervald. The internal code paths stay `apps/hammurabi`, `hammurabi-cli`, `~/.hammurabi`, and `HAMMURABI_*`.

## Quickstart

### Mac mini

```bash
curl -fsSL https://hervald.gehirn.ai/install.sh | bash
```

The installer prepares `apps/hammurabi/.env`, boots the shell once, seeds a one-time bootstrap API key, and prints the local sign-in URL.

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

Full guide: [docs/tailscale-quickstart.md](./docs/tailscale-quickstart.md)

## Docs

- [Architecture Overview](./docs/architecture-overview.md)
- [Installation](./docs/installation.md)
- [Provider Auth Setup](./docs/provider-auth-setup.md)
- [Operator Guide](./docs/operator-guide.md)
- [Canonical Architecture Report](https://www.nickgu.me/reports/hammurabi-daemon-vs-ssh-2026)

## License

Hervald is source-available under the [PolyForm Noncommercial 1.0.0](./LICENSE) license.

- Personal and other noncommercial use is allowed under that license.
- Commercial use requires a separate written agreement.
- See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md) and [NOTICE](./NOTICE).
