# Provider Auth

Hervald uses provider CLIs on the host where work runs. The product should
surface provider readiness, but the actual login belongs to the original
provider tool.

## Supported Providers

- Codex
- Claude Code
- Gemini CLI
- OpenCode

## Authentication Contract

- Authenticate on the host that will run the provider.
- Use the provider's native auth command and status command.
- Refresh Hervald provider status after logging in.
- Do not replace provider-native OAuth or local credential stores with a
  parallel Hervald-only credential flow unless that provider explicitly
  supports it.

Common checks:

```bash
codex auth status
claude auth status
gemini auth status
opencode auth status
```

If status is missing or unknown, run the native provider login command on that
same host, then refresh the Provider Auth panel.

Source references:

- [Providers feature guide](../features/providers.md)
- [Agents architecture](../architecture/agents.md)
- [API reference](../reference/api.md)
