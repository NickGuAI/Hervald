# Workers

Workers are delegated execution sessions. They let a commander run focused work
on a local or remote machine while the main commander keeps the coordination
thread.

## Worker Lifecycle

1. A commander receives or claims a bounded task.
2. The operator or commander dispatches a worker with a scope, host, base
   branch, and expected artifact.
3. The worker creates or uses an isolated worktree.
4. The worker reports progress and produces an artifact: PR, patch, test
   result, issue update, or investigation report.
5. The commander verifies the artifact before declaring the task complete.

## Host Routing

Host routing is meaningful only when the worker process actually runs on that
host. Verify ordinary SSH, Tailscale, and machine registration before assuming a
worker is on Mac mini, home Mac, EC2, or another machine.

See [machines and workers](../operate/machines.md) for setup commands.

Source references:

- [Commanders architecture](../architecture/commanders.md)
- [Agents architecture](../architecture/agents.md)
- [Routes and APIs](../architecture/routes-and-apis.md)
