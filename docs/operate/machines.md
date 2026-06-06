# Machines And Workers

Machines are the hosts available for worker execution. A machine can be local,
reachable over SSH, or reachable through a private network such as Tailscale.

## Setup Sequence

1. Verify ordinary SSH to the host.
2. Confirm the host has the provider CLIs needed for the work.
3. Register the host in Hervald.
4. Bootstrap the host.
5. Dispatch a small worker and verify the log shows the expected host.

Use the Machines view to add the host, confirm the SSH settings, and run the
bootstrap flow.

## Troubleshooting

- If the host is not listed, registration did not persist or the active server
  is reading a different machine registry.
- If dispatch reports `host: null`, routing was dropped before execution.
  Treat that as a routing bug and do not claim the worker ran on the target
  host.
- If SSH works but provider auth fails, authenticate the provider on the worker
  host.

Related docs:

- [Workers concept](../concepts/workers.md)
- [Troubleshooting](../troubleshoot.md)
