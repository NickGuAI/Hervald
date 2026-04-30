# First Login

After the installer prints the local URL and a one-time bootstrap key, log in and create a permanent API key. This is the only manual step before you can dispatch agents.

## Open the shell

Open the URL the installer printed, usually:

```
http://localhost:20001
```

If you ran the installer on a remote host, replace `localhost` with the hostname or IP that is reachable from your browser.

## Find the bootstrap key

The installer writes a single-use bootstrap key to:

```
~/.hammurabi/bootstrap-key.txt
```

Copy the file's contents. The key looks like a long random string and is intentionally URL-safe.

## Sign in

Paste the bootstrap key into the API-key field on the sign-in page. You should land on the operator dashboard.

## Create a permanent key

The bootstrap key is a single-use credential intended only for first boot. Replace it with a permanent key:

1. Open **Settings** in the operator UI.
2. Click **API Keys**.
3. Click **Create new key** and give it a label like `operator-laptop` or `home-mac-mini`.
4. Copy the new key into your password manager or a `.env` file your tooling reads.

Once you have a permanent key, rotate or revoke the bootstrap key:

```bash
hammurabi auth revoke --key bootstrap
```

You can also revoke from the Settings UI by clicking the **bootstrap** entry and selecting **Revoke**.

## Lost the bootstrap key

If `~/.hammurabi/bootstrap-key.txt` was deleted before you signed in, restart the server with bootstrap seeding enabled:

```bash
HAMMURABI_BOOTSTRAP=1 pnpm --filter hammurabi start
```

The server will print a new key on startup and write it back to the bootstrap-key file.

## Next

- [Connect a provider](./provider-auth-setup.md) — wire up Claude, Codex, or Gemini
- [First session](./first-session.md) — dispatch your first agent
