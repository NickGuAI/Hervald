# Tailscale Quickstart

Use this when a worker is behind NAT and SSH is not directly reachable from the Hammurabi host.

## Guided Flows

- CLI worker setup: run `hammurabi onboard` on the worker itself and accept the Tailscale pairing step. The CLI checks whether `tailscale` is already installed, offers the platform-specific install command, runs `sudo tailscale up`, and prints the detected MagicDNS hostname for the next step.
- Hervald worker registration: open Command Room, choose `Add Worker`, select `Behind NAT - use Tailscale`, run the shown install/auth commands on the worker, then verify the hostname before registering it.

## Manual Fallback

### macOS

```bash
brew install tailscale
sudo tailscale up
```

### Linux

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

After the worker joins your tailnet, capture its MagicDNS hostname:

```bash
tailscale status --json
```

Register the worker with Hammurabi:

```bash
hammurabi machine add --id <id> --label <label> --tailscale-hostname <magicdns-hostname>
```

Hammurabi verifies the hostname with `tailscale ping` before it writes the machine registry entry.
