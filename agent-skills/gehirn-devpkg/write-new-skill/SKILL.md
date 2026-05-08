---
name: write-new-skill
description: >
  Write or rewrite agent skill files so they are outcome-oriented, bounded, and
  easy for another agent to apply. Use when creating a new skill, translating a
  skill, or tightening an existing skill's acceptance criteria, boundaries, or
  output contract.
user-invocable: true
argument-hint: '[skill-path-or-dir]'
disable-model-invocation: false
allowed-tools: Read, Write, Edit, Glob
---

# Write New Skill

Create or rewrite a skill so another agent can use it reliably without hidden
context. Prefer outcome-oriented guidance over rigid step scripting.

## Input

`$ARGUMENTS` - Optional target skill file or directory. If omitted, infer the
target from the user's request and the current workspace context.

## Success Contract

Every skill should make these four items explicit:

- **Goal** - What the skill accomplishes, in one sentence.
- **Acceptance criteria** - Concrete conditions an unfamiliar agent can use to
  decide whether the task is done.
- **Resources and boundaries** - Which tools, files, dependencies, and
  non-negotiable limits apply.
- **Output specification** - What is produced, where it lives, and what format
  or schema it must follow.

If any of these four are missing, the skill is underspecified.

## Authoring Guidance

- Optimize for result certainty, not process certainty.
- Prefer constraints, heuristics, and verification rules over "step 1 / step 2"
  scripts.
- Only make order mandatory when later work truly depends on earlier output.
- Keep `SKILL.md` lean; move detailed discussion to a sibling reference file
  when needed.
- Include real failure modes and repo-specific pitfalls when they are known.
- Do not invent speculative pitfalls just to fill a section.
- Preserve raw error details in troubleshooting guidance.
- Prefer updating an existing skill over creating a near-duplicate.

## Suggested Structure

Use the lightest structure that still makes the skill executable:

- Frontmatter with an accurate `name` and discovery-friendly `description`
- A short overview of what the skill does and when to use it
- Inputs or arguments, if any
- Core instructions or procedure
- Acceptance criteria and output expectations
- Links to deeper references or examples when needed

Exact headings can vary. The contract matters more than the section order.

## Acceptance Criteria

Before finishing, confirm that:

- A new agent can tell what success looks like.
- The skill makes its scope and boundaries explicit.
- The main file is concise and information-dense.
- Any rigid sequencing that remains is genuinely required.
- Every referenced file or path exists.
- Terminology is consistent throughout.
- Supporting docs are linked only when they materially improve execution.

## Output

Write the skill into the **agent-skills source tree** at
`~/App/agent-skills/<package>/<skill-name>/SKILL.md`, NOT directly into
`~/.claude/skills/`. The installer (`cd ~/App/agent-skills && make install`)
copies skills from the source tree into the runtime directories.

Choose the package by purpose:
- `gehirn-devpkg` — developer workflow tools (breakdown, debrief, preflight, etc.)
- `gehirn-legionpkg` — Legion orchestration skills
- `gehirn-salespkg` — sales and outreach skills
- `general-skills` — cross-project general-purpose skills
- `pkos` — KaizenOS / personal-productivity skills

After writing, run `cd ~/App/agent-skills && make install` to deploy.

Keep the main skill concise and move detailed rationale, examples, or edge-case
notes into sibling docs such as `reference.en.md` when helpful.

## Additional Resources

- For the fuller English guide, see [reference.en.md](reference.en.md).
- For the original Chinese draft, see [reference.md](reference.md).
