# Workspace

Workspace gives a commander and conversation a concrete file target. It powers
file browsing, previews, raw file access, git state, and context insertion.

## Operator Checklist

- Confirm the selected commander and conversation.
- Confirm the workspace target path.
- Use file preview before attaching file context.
- Use git state to distinguish pending changes from committed history.
- If a file opens from chat but not from the workspace panel, verify the target
  id and path are the same.

Source references:

- [Workspace feature guide](../features/workspace.md)
- [Workspace architecture](../architecture/workspace.md)
- [Routes and APIs](../architecture/routes-and-apis.md)
