# Channels

Channels connect external communication surfaces to commanders. A channel
binding chooses which commander receives inbound messages, and a surface binding
chooses the conversation context.

## Operating Model

- Account binding chooses the commander.
- Surface binding chooses the conversation.
- Adapter runtime owns the external provider connection.
- Commander routes own inbound message ingest and outbound reply dispatch.

Use this distinction when debugging channel pairing: a connected account is not
the same thing as an active conversation binding.

Source references:

- [Channels feature guide](../features/channels.md)
- [Channels architecture](../architecture/channels.md)
- [Channel integration guide](../guides/channel-integration-guide.md)
