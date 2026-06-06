# API Reference

Hervald exposes an authenticated HTTP and WebSocket API for the browser shell,
provider sessions, workspace access, approvals, settings, skills, channels, and
telemetry.

The browser UI is the supported operator surface. Direct API use is for
integrations that have an explicit API key or hosted auth session.

High-level API families:

- Commander, conversation, and worker orchestration.
- Provider auth status and provider session control.
- Workspace file browsing, content preview, upload, and download.
- Approval policy decisions and pending action review.
- Channel pairing and channel-message ingress.
- Settings, skills, telemetry, and onboarding state.
