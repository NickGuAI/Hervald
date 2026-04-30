const MAX_TASK_COMMENTS = 3

export interface GHIssueComment {
  body: string
  author?: string
}

export interface GHIssue {
  number: number
  title: string
  body: string
  comments?: Array<GHIssueComment | string>
  repo?: string
  repoOwner?: string
  repoName?: string
}

export interface HandoffPackage {
  taskContext: string
  sourceCommanderId: string
}

export interface SubagentResult {
  status: 'SUCCESS' | 'PARTIAL' | 'BLOCKED'
  finalComment: string
  filesChanged: number
  durationMin: number
  subagentSessionId: string
}

export interface SubagentHandoffOptions {}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function safeSnippet(value: string, maxLen: number = 220): string {
  const compacted = compactText(value)
  if (compacted.length <= maxLen) return compacted
  return `${compacted.slice(0, maxLen - 3)}...`
}

export class SubagentHandoff {
  constructor(
    private readonly commanderId: string,
    _basePath?: string,
    _options: SubagentHandoffOptions = {},
  ) {}

  async buildHandoffPackage(task: GHIssue): Promise<HandoffPackage> {
    return {
      taskContext: this.formatTaskContext(task),
      sourceCommanderId: this.commanderId,
    }
  }

  formatAsSystemContext(pkg: HandoffPackage): string {
    return [
      `## Handoff from Commander ${pkg.sourceCommanderId}`,
      '',
      '### Task',
      pkg.taskContext.trim() || '_No task context available._',
      '',
      '### Standing Instructions',
      '- Report key findings back as GH Issue comments as you go',
      '- Report durable conventions or pitfalls back to the commander; the commander owns memory writes',
      '- Tag your final status: SUCCESS | PARTIAL | BLOCKED',
    ].join('\n')
  }

  async processCompletion(
    _task: GHIssue,
    _subagentResult: SubagentResult,
  ): Promise<void> {
    // Journal persistence was intentionally removed. Memory management now
    // belongs to agent + cron + skill orchestration outside the harness.
  }

  private formatTaskContext(task: GHIssue): string {
    const comments = this.extractRecentComments(task.comments)
    const repo = this.resolveRepo(task)
    const lines: string[] = [`**Issue #${task.number}**: ${task.title}`]

    if (repo) {
      lines.push(`Repo: ${repo}`)
    }

    lines.push('', task.body?.trim() ? task.body.trim() : '_No issue body provided._')

    if (comments.length > 0) {
      lines.push('', '**Recent Comments**')
      for (const comment of comments) {
        lines.push(`- ${comment}`)
      }
    }

    return lines.join('\n')
  }

  private resolveRepo(task: GHIssue): string | null {
    if (task.repoOwner && task.repoName) {
      return `${task.repoOwner}/${task.repoName}`
    }

    return task.repo?.trim() || null
  }

  private extractRecentComments(
    comments: Array<GHIssueComment | string> | undefined,
  ): string[] {
    if (!comments?.length) return []

    return comments
      .slice(-MAX_TASK_COMMENTS)
      .map((comment) => {
        if (typeof comment === 'string') return comment.trim()
        const body = comment.body.trim()
        if (!comment.author) return body
        return `${comment.author}: ${body}`
      })
      .map((comment) => safeSnippet(comment))
      .filter((comment) => comment.length > 0)
  }
}
