# Troubleshooting

Use this page when a fresh Hervald install or first commander run fails before a
useful response.

## Installer Fails

Check:

```bash
command -v git
command -v curl
command -v tar
```

Recovery:

- Install the missing tool.
- Confirm outbound HTTPS works.
- Rerun the installer.

## Browser Cannot Reach Hervald

Check:

```bash
curl -fsS http://localhost:20001/api/health
```

Recovery:

- Restart the Hervald process.
- Confirm the printed URL and port.
- Check reverse proxy or private-network routing if you are not using local
  access.

## API Key Is Stale

Recovery:

- Clear the stored browser key from the landing page or browser storage.
- Use the newest bootstrap key printed by the running server.
- If Auth0 is configured, complete the hosted sign-in path instead.

## Provider Auth Is Missing

Run the provider's native status command on the same host that will run work:

```bash
codex auth status
claude auth status
gemini auth status
opencode auth status
```

Recovery:

- Log in through the provider CLI on that host.
- Refresh the Provider Auth panel.
- Do not authenticate against a parallel Hervald OAuth flow unless the provider
  implementation explicitly supports it.

## Machine Routing Is Missing

Check:

```bash
ssh <machine>
```

Recovery:

- Fix SSH or Tailscale first.
- Re-register or bootstrap the machine.
- If dispatch reports `host: null`, do not assume the worker ran on that host.

## Docs Or README Links Are Missing

Recovery:

- Ensure the public docs index and `llms.txt` exist.
- Ensure release sync copies the public docs subset to root `docs/`.
- Re-run the public release sync before publishing.
