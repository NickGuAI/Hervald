# Skill Writing Guide (Meta-Skill)

## Metadata

- **Type**: BestPractice
- **Use case**: When creating or rewriting a skill file
- **Created**: 2026-03-29

## What this file is for

Skill files define capabilities for AI agents. A well-written skill helps an
agent complete a task reliably. A poorly written skill either turns the agent
into a rigid checklist runner or leaves out the boundaries and acceptance
criteria that keep the agent from drifting in the wrong direction.

This file defines the core principles, acceptance standards, and known pitfalls
for writing a good skill. It is not a template, and it does not require a fixed
section order.

## Core principles

### Principle 1: Result certainty beats process certainty

The common failure mode is to write a task as a step list: first do this, then
do that, and if X happens do Y. That gives certainty at the process level, which
is basically using natural language as a script. That wastes the agent's
reasoning and tool-using ability. More importantly, procedural writing cannot
cover the long tail of corner cases, and those corner cases are exactly where an
agent should outperform a script.

The alternative is to move certainty from the process to the outcome: define
what the finished state looks like, define how to verify it, and let the agent
decide how to get there.

In practice, every skill file should answer these four questions:

1. **Goal**: What should be accomplished? Say it clearly in one sentence.
2. **Acceptance criteria**: What counts as success? Write this so clearly that
   an agent with no additional context can decide whether it is done. If it
   cannot, the criteria are still too vague.
3. **Available resources**: Which tools, files, and dependencies can the agent
   use, and which boundaries must it obey?
4. **Output specification**: What should be produced, in what format, and where
   should it live?

These four items are the backbone of a skill file. Everything else
(methodological advice, domain knowledge, historical lessons) should support
them.

### Principle 2: Write enabling guidance, not an SOP

The reader of a skill file is a reasoning agent, and its context window is
scarce. Every paragraph in a skill should increase the probability of success,
not consume attention without adding execution value.

Methodology advice is welcome, but it should appear as guidance and constraints,
not as a mandatory script. For example, "group the analysis by industry sector"
is a helpful suggestion because it offers a productive frame. But if one day's
input contains only a single macro event, the agent should be free to skip the
grouping and produce a global analysis instead.

Known pitfalls must be written down, because they are exactly the things an
agent is least likely to infer on its own. One concrete failure record is worth
more than ten generic methodology tips.

Two tests help decide whether a paragraph belongs in a skill file:

1. If you delete it, does the agent become less likely to succeed or produce
   lower-quality work? If not, delete it.
2. Is it describing "how to do it" or "what done looks like"? Prefer the
   latter. Keep the former only when it materially improves success odds.

## What a skill file should contain

Below are the content areas a skill file will usually need. Their order and
exact organization should follow the needs of the skill; do not force the file
into this list mechanically.

**Metadata.** Type (API Guide / Workflow / BestPractice / Tutorial), use case,
output location, and created / updated dates.

**Goal and boundaries.** What the skill does and does not do. Boundaries matter
more than most authors expect: a sharp "does not do X" often prevents drift
better than a vague "does Y."

**Acceptance criteria.** Testable success conditions. When possible, express
them as automated checks (run a script, validate a schema, compare against a
threshold). When automation is not possible, define an audit standard specific
enough that the agent can still self-check during execution.

**Available resources and constraints.** Tool list, file paths, external
dependencies, and non-negotiable restrictions. Be explicit about what can be
used, what is forbidden, and which boundaries cannot be crossed.

**Methodology suggestions.** Frameworks, grouping strategies, prioritization
rules, or analysis lenses the agent may use. Clearly distinguish hard
constraints from optional guidance.

**Known pitfalls.** Failures observed in prior iterations, with the concrete
symptom and how to respond. This is one of the highest-ROI sections in a mature
skill.

One point deserves extra emphasis: **do not invent "possible pitfalls" just to
fill the section.** Known pitfalls should come from real failures, rework,
misjudgments, or repeated iteration. A brand-new skill can omit this section
entirely or include only a brief placeholder. A pitfall belongs in the meta
layer only after it has actually happened and is likely to recur.

**Output specification.** Format, schema, and storage path. If a JSON schema is
involved, a complete example is usually easier for an agent to use than a
purely descriptive schema paragraph.

## Acceptance criteria (for this meta-skill itself)

After writing a skill file, check it against the standards below.

**Outcome orientation.** Does the file include explicit, testable acceptance
criteria? Can a new agent, reading only this skill, determine whether the task
is complete? If not, the criteria are still too vague.

**No redundant procedure.** Does the file contain step-scripted instructions
("first..., second...")? If so, check whether each step is truly required. Most
of the time, you can rewrite it as goals plus constraints. Preserve ordering
only when sequence materially affects the outcome, such as when one step depends
on the output of another.

**Pitfall coverage.** Does the skill record real failure modes? If the skill is
new, this can be empty. Do not predict or fabricate pitfalls just to make the
document look complete; add them after the failures actually happen.

**Boundary clarity.** Are the critical limits clear enough? For example: which
tools are allowed, what counts as out of scope, which artifacts must be written
to disk, and which constraints are non-negotiable. Vague boundaries weaken the
skill.

**Information density.** Is the file reasonably sized? Does every paragraph
increase the probability of task success? If removing a paragraph would not
meaningfully affect the result, consider deleting it.

## Common pitfalls

| Pitfall | Symptom | Response |
|------|------|------|
| Writing the skill as an SOP | The file becomes "step 1, step 2" all the way down and the agent acts mechanically | Rewrite it as goal + constraints + methodology suggestions |
| Vague acceptance criteria | Phrases like "high quality output" or "deep analysis" | Replace with measurable conditions such as "every judgment must cite `item_id`" or "Brier Score beats the naive baseline" |
| Over-constraining the process | The agent is forced into one method and fails as soon as reality differs | Keep hard constraints at the result layer; present methodology as guidance |
| Missing boundary conditions | No guidance for missing data, tool failures, or timeouts | At minimum cover "no data" and "tool unavailable" fallback cases |
| Stuffing in background knowledge | Large blocks of domain exposition consume context window | Keep only background that directly changes execution; point to files for the rest |
| Hiding raw errors | A CLI or tool wraps root-cause details inside "something went wrong" | Pass through raw error details such as HTTP status, response body, and exception type so the agent can debug from the output itself |
| Forgetting to update discovery docs | The new skill exists but is hard to find | Update `agent-skills/index.md` if that index is being used for discovery |

## Relationship to existing skills

Before writing a new skill, check `agent-skills/index.md` to avoid duplicates.
If a similar skill already exists, prefer updating it over creating a new one.

For format references, inspect nearby skills such as
`agent-skills/gehirn-devpkg/preflight/SKILL.md` and
`agent-skills/gehirn-devpkg/extract-skill/SKILL.md`. Treat them as formatting
references only. The core principles in this guide - result certainty and
enabling guidance over SOP - matter more than any exact section layout.
