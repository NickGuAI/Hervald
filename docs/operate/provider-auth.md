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
codex login status
claude auth status
gemini auth status
opencode auth status
```

If status is missing or unknown, run the native provider login command on that
same host, then refresh the Provider Auth panel.

## Codex Invalid Authorize Request

If OpenAI returns `authorize_hydra_invalid_request` during Codex authentication,
the failing path is the retired Hervald-managed Codex OAuth reconnect flow, not
native Codex CLI login. Use native Codex login on the machine that will run
Codex, or reuse a valid Codex `auth.json`; do not treat the OpenAI authorize
error as a missing subscription by itself.

See the
[provider subscription auth comparison](../diagrams/features/providers/provider-subscription-auth-comparison.svg)
for the Hervald, Happy, and Paperclip flow comparison.

Source references:

- [Providers feature guide](../features/providers.md)
- [Agents architecture](../architecture/agents.md)
- [API reference](../reference/api.md)
