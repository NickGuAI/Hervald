# Command Room

Command Room is the main operating surface. It composes commander selection,
chat, queued messages, worker blocks, quests, workspace files, approvals,
channels, and settings.

Command Room does not own most durable state. It reads and coordinates state
owned by the agents, commanders, conversations, workspace, approvals,
automations, channels, and settings modules.

## What To Check First

- Selected commander: confirms which identity receives the message.
- Conversation: confirms which thread and workspace context are active.
- Provider/model: confirms the runtime used for new work.
- Queue: confirms whether a message is sent now or held for later.
- Workspace: confirms the target path used for file browsing and context.
- Worker blocks: confirms delegated work appears under the correct worker.

Source references:

- [Command Room architecture](../architecture/command-room.md)
- [Frontend surfaces](../architecture/frontend-surfaces.md)
- [Workspace](../operate/workspace.md)
