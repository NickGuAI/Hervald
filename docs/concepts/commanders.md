# Commanders

Commanders are durable agent identities. A commander owns its prompt-bearing
identity, conversations, memory, quests, worker relationships, and channel
surface bindings.

Use a commander when you want a stable role that can accumulate context over
time instead of a disposable chat session.

## What A Commander Owns

- Identity: display profile plus runtime instructions.
- Conversations: user-visible chat threads and associated workspace context.
- Memory: durable context that can be loaded into future sessions.
- Quests: explicit work items and acceptance criteria.
- Workers: delegated execution sessions for bounded tasks.
- Channels: external surfaces such as email or WhatsApp when configured.

## Operating Rules

- Edit commander identity through the commander UI or source-backed identity
  surfaces, not by mutating unrelated chat state.
- Treat conversations as separate from provider sessions. A conversation is the
  user-facing thread; a provider session is how a particular CLI/runtime does
  work.
- Keep quests concrete. A quest should have an outcome, acceptance criteria,
  and drift detection.

Source references:

- [Commanders feature guide](../features/commanders.md)
- [Commanders architecture](../architecture/commanders.md)
- [Commander package guide](../guides/commander-packages.md)
