# Approvals

Approvals are the human gate for sensitive or policy-controlled actions. They
separate a provider's proposed action from the operator decision to allow or
deny it.

## Approval Flow

1. A tool or provider action asks for permission.
2. Hervald records the pending approval.
3. The UI shows enough context for the operator to decide.
4. The operator approves or denies.
5. The provider resumes or aborts the action.

## Operating Rules

- Approval state must be visible. Hidden policy decisions are product bugs.
- The pending item should show what will happen, where, and under which
  commander or session.
- Approval policy changes should be tested against the action gate and the UI.

Source references:

- [Approvals feature guide](../features/approvals.md)
- [Policies and approvals architecture](../architecture/policies-approvals.md)
