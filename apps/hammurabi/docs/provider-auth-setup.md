# Provider Auth Setup

Use the Hervald **Add Worker** wizard when possible. The in-product flow now guides worker auth for Claude, Codex, and Gemini and verifies each provider before you dispatch the first session.

If you need the manual fallback, the worker auth model is:

## Claude

1. SSH to the worker.
2. Run `claude setup-token`.
3. Save the returned token into the worker env file as `CLAUDE_CODE_OAUTH_TOKEN`.
4. Verify with:

```sh
claude --version
test -n "$CLAUDE_CODE_OAUTH_TOKEN" || claude auth status
```

Reference: https://docs.anthropic.com/en/docs/claude-code/setup-token

## Codex

Choose one path:

- API key:
  1. Save `OPENAI_API_KEY` in the worker env file.
  2. Verify with `codex --version && test -n "$OPENAI_API_KEY"`.
- Device auth:
  1. Ensure `cli_auth_credentials_store = "file"` in `~/.codex/config.toml`.
  2. Run `codex login --device-auth` on the worker.
  3. Verify with `codex --version && codex login status`.

Reference: https://developers.openai.com/codex

## Gemini

1. Save `GEMINI_API_KEY` in the worker env file.
2. Set `GEMINI_FORCE_FILE_STORAGE=1`.
3. Verify with:

```sh
gemini --version
test -n "$GEMINI_API_KEY" || test -n "$GOOGLE_API_KEY"
```

Reference: https://github.com/google-gemini/gemini-cli
