import { extractApprovalContext } from './context-extractor.js'
import { findFirstMatchingGlob } from './glob.js'
import {
  BUILT_IN_ACTIONS,
  INTERNAL_EDIT_IN_CWD_ACTION,
  INTERNAL_SAFE_BASH_ACTION,
  INTERNAL_SAFE_MCP_ACTION,
  SAFE_BASH_PATTERNS,
} from './registry.js'
import {
  extractCommandText,
  extractToolPath,
  isPathWithinCwd,
  normalizeMatcherToken,
} from './shared.js'
import type {
  ActionCategoryDefinition,
  ActionPolicyRecord,
  ActionPolicyValue,
  EffectiveActionPolicyView,
  ResolveActionPolicyInput,
  ResolvedActionPolicy,
} from './types.js'

const POLICY_RANK: Record<ActionPolicyValue, number> = {
  auto: 0,
  review: 1,
  block: 2,
}

const REVIEW_REQUIRED_UNMATCHED_MCP_SERVERS = new Set([
  normalizeMatcherToken('codex_apps'),
  normalizeMatcherToken('opencode'),
])

function stricterPolicy(a: ActionPolicyValue, b: ActionPolicyValue): ActionPolicyValue {
  return POLICY_RANK[a] >= POLICY_RANK[b] ? a : b
}

function getPolicyRecord(
  policyView: EffectiveActionPolicyView,
  actionId: string,
): ActionPolicyRecord | null {
  return policyView.records.find((record) => record.actionId === actionId) ?? null
}

function parseMcpToolIdentity(toolName: string): {
  server: string
  tool?: string
  exactTokens: string[]
  reviewRequiredWhenUnmatched: boolean
} | null {
  const trimmed = toolName.trim()
  if (trimmed.startsWith('mcp__')) {
    const stripped = trimmed.slice(5)
    const separatorIndex = stripped.indexOf('__')
    if (separatorIndex === -1) {
      const server = normalizeMatcherToken(stripped)
      return {
        server,
        exactTokens: [normalizeMatcherToken(`mcp__${stripped}`)],
        reviewRequiredWhenUnmatched: REVIEW_REQUIRED_UNMATCHED_MCP_SERVERS.has(server),
      }
    }

    const rawServer = stripped.slice(0, separatorIndex)
    const rawTool = stripped.slice(separatorIndex + 2)
    const server = normalizeMatcherToken(rawServer)
    const tool = normalizeMatcherToken(rawTool)
    return {
      server,
      tool,
      exactTokens: [
        normalizeMatcherToken(`mcp__${rawServer}__${rawTool}`),
        normalizeMatcherToken(`${rawServer}/${rawTool}`),
      ],
      reviewRequiredWhenUnmatched: REVIEW_REQUIRED_UNMATCHED_MCP_SERVERS.has(server),
    }
  }

  const slashIndex = trimmed.indexOf('/')
  if (slashIndex === -1) {
    return null
  }
  const server = normalizeMatcherToken(trimmed.slice(0, slashIndex))
  const tool = normalizeMatcherToken(trimmed.slice(slashIndex + 1))
  if (!server || !tool) {
    return null
  }
  return {
    server,
    tool,
    exactTokens: [
      normalizeMatcherToken(trimmed),
      normalizeMatcherToken(`mcp__${trimmed.slice(0, slashIndex)}__${trimmed.slice(slashIndex + 1)}`),
    ],
    reviewRequiredWhenUnmatched: REVIEW_REQUIRED_UNMATCHED_MCP_SERVERS.has(server),
  }
}

function isBackgroundSeparator(command: string, index: number): boolean {
  const previous = command[index - 1]
  const next = command[index + 1]
  return next !== '&'
    && previous !== '>'
    && previous !== '<'
    && next !== '>'
}

function splitCompoundCommand(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaped = false

  const pushSegment = () => {
    const trimmed = current.trim()
    if (trimmed.length > 0) {
      segments.push(trimmed)
    }
    current = ''
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (escaped) {
      current += character
      escaped = false
      continue
    }

    if (character === '\\' && quote !== '\'') {
      current += character
      escaped = true
      continue
    }

    if (quote) {
      current += character
      if (character === quote) {
        quote = null
      }
      continue
    }

    if (character === '"' || character === '\'') {
      current += character
      quote = character
      continue
    }

    if (character === '&' && command[index + 1] === '&') {
      pushSegment()
      index += 1
      continue
    }

    if (character === '|' && command[index + 1] === '|') {
      pushSegment()
      index += 1
      continue
    }

    if (
      character === ';'
      || character === '|'
      || character === '\n'
      || character === '\r'
      || (character === '&' && isBackgroundSeparator(command, index))
    ) {
      pushSegment()
      continue
    }

    current += character
  }

  pushSegment()
  return segments
}

function tokenizeShellSegment(segment: string): string[] | null {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaped = false

  for (const character of segment) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }

    if (character === '\\' && quote !== '\'') {
      escaped = true
      continue
    }

    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        current += character
      }
      continue
    }

    if (character === '"' || character === '\'') {
      quote = character
      continue
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += character
  }

  if (escaped || quote) {
    return null
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

function hasUnsupportedShellSyntax(segment: string): boolean {
  return segment.includes('$(')
    || segment.includes('`')
    || segment.includes('<(')
    || segment.includes('>(')
}

function isFdRedirect(token: string): boolean {
  return /^(?:\d+)?[<>]&\d+$/.test(token)
}

function isRedirectOperator(token: string): boolean {
  return /^(?:(?:\d+)?<>|(?:\d+)?>|(?:\d+)?>>|(?:\d+)?<|&>)$/.test(token)
}

function getInlineRedirectTarget(token: string): string | null {
  if (isFdRedirect(token)) {
    return null
  }

  const match = token.match(/^(?:(?:\d+)?<>|(?:\d+)?>|(?:\d+)?>>|(?:\d+)?<|&>)(.+)$/)
  return match?.[1] ?? null
}

function splitShellArgvAndRedirects(tokens: string[]): {
  argv: string[]
  redirectPaths: string[]
} | null {
  const argv: string[] = []
  const redirectPaths: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token || token === '&' || token === '&&' || token === '||' || token === ';' || token === '|') {
      return null
    }
    if (token.startsWith('<<')) {
      return null
    }

    if (isFdRedirect(token)) {
      continue
    }

    if (isRedirectOperator(token)) {
      const target = tokens[index + 1]
      if (!target || isRedirectOperator(target) || isFdRedirect(target) || target.startsWith('<<')) {
        return null
      }
      if (!/^&\d+$/.test(target)) {
        redirectPaths.push(target)
      }
      index += 1
      continue
    }

    const inlineRedirectTarget = getInlineRedirectTarget(token)
    if (inlineRedirectTarget !== null) {
      if (!inlineRedirectTarget || inlineRedirectTarget.startsWith('&')) {
        return null
      }
      redirectPaths.push(inlineRedirectTarget)
      continue
    }

    if (token.includes('>') || token.includes('<')) {
      return null
    }

    argv.push(token)
  }

  return { argv, redirectPaths }
}

function hasUnsafePathExpansion(pathArg: string): boolean {
  return /[$*?\[\]{}]/.test(pathArg)
}

function isPathLikeToken(token: string): boolean {
  return token === '.'
    || token === '..'
    || token.startsWith('/')
    || token.startsWith('~/')
    || token.startsWith('./')
    || token.startsWith('../')
}

function validatePathArgs(
  paths: string[],
  cwd: string | undefined,
  allowlist: string[],
): boolean {
  const filtered = paths.filter((entry) => entry && entry !== '-')
  if (filtered.length === 0) {
    return true
  }
  if (!cwd) {
    return false
  }

  return filtered.every((pathArg) => {
    return !hasUnsafePathExpansion(pathArg)
      && isPathWithinCwd(pathArg, cwd, { allowlist })
  })
}

const HEAD_TAIL_VALUE_FLAGS = new Set(['-n', '-c', '--lines', '--bytes'])
const GREP_PATTERN_FLAGS = new Set(['-e', '--regexp'])
const GREP_PATTERN_FILE_FLAGS = new Set(['-f', '--file'])
const GREP_VALUE_FLAGS = new Set([
  '-A',
  '-B',
  '-C',
  '-m',
  '--after-context',
  '--before-context',
  '--context',
  '--max-count',
  '--label',
  '--include',
  '--exclude',
  '--exclude-dir',
  '--include-dir',
])
const WC_PATH_VALUE_FLAGS = new Set(['--files0-from'])
const TEST_PATH_FLAGS = new Set([
  '-b',
  '-c',
  '-d',
  '-e',
  '-f',
  '-g',
  '-G',
  '-h',
  '-k',
  '-L',
  '-O',
  '-p',
  '-r',
  '-s',
  '-S',
  '-u',
  '-w',
  '-x',
])
const TEST_BINARY_PATH_OPERATORS = new Set(['-ef', '-nt', '-ot'])
const DATE_PATH_VALUE_FLAGS = new Set(['-f', '--file'])
const GIT_PATH_VALUE_FLAGS = new Set(['--output'])
const FIND_LEADING_OPTIONS_WITH_VALUES = new Set(['-D'])
const FIND_REVIEW_REQUIRED_ACTIONS = new Set([
  '-delete',
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
])
const FIND_REVIEW_REQUIRED_OPTIONS = new Set([
  '-H',
  '-L',
  '-follow',
  '-files0-from',
])
const FIND_PATH_VALUE_PREDICATES = new Set([
  '-anewer',
  '-cnewer',
  '-newer',
  '-samefile',
])
const FIND_VALUE_PREDICATES = new Set([
  '-amin',
  '-atime',
  '-cmin',
  '-context',
  '-ctime',
  '-fstype',
  '-gid',
  '-group',
  '-ilname',
  '-iname',
  '-inum',
  '-ipath',
  '-iregex',
  '-links',
  '-lname',
  '-maxdepth',
  '-mindepth',
  '-mmin',
  '-mtime',
  '-name',
  '-path',
  '-perm',
  '-printf',
  '-regex',
  '-regextype',
  '-size',
  '-type',
  '-uid',
  '-used',
  '-user',
  '-wholename',
  '-xtype',
])
const FIND_NO_VALUE_PREDICATES = new Set([
  '-a',
  '-and',
  '-d',
  '-daystart',
  '-depth',
  '-empty',
  '-executable',
  '-false',
  '-help',
  '-ignore_readdir_race',
  '-ls',
  '-mount',
  '-noignore_readdir_race',
  '-noleaf',
  '-not',
  '-o',
  '-or',
  '-P',
  '-print',
  '-print0',
  '-prune',
  '-quit',
  '-readable',
  '-true',
  '-version',
  '-writable',
  '-xdev',
])

function optionName(token: string): string {
  const equalsIndex = token.indexOf('=')
  return equalsIndex === -1 ? token : token.slice(0, equalsIndex)
}

function collectNonOptionPathArgs(args: string[], valueFlags: Set<string> = new Set()): string[] {
  const paths: string[] = []
  let endOfOptions = false

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!endOfOptions && token === '--') {
      endOfOptions = true
      continue
    }

    if (!endOfOptions && token.startsWith('-') && token !== '-') {
      const flag = optionName(token)
      if (valueFlags.has(flag) && !token.includes('=')) {
        index += 1
      }
      continue
    }

    paths.push(token)
  }

  return paths
}

function collectPathOptionValues(args: string[], pathValueFlags: Set<string>): string[] {
  const paths: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    const flag = optionName(token)
    if (!pathValueFlags.has(flag)) {
      continue
    }
    if (token.includes('=')) {
      paths.push(token.slice(token.indexOf('=') + 1))
    } else if (args[index + 1]) {
      paths.push(args[index + 1])
      index += 1
    }
  }
  return paths
}

function collectGrepPathArgs(args: string[]): string[] {
  const paths: string[] = []
  let patternProvided = false
  let recursive = false
  let endOfOptions = false

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!endOfOptions && token === '--') {
      endOfOptions = true
      continue
    }

    if (!endOfOptions && token.startsWith('-') && token !== '-') {
      const flag = optionName(token)
      const shortFlagGroup = token.startsWith('-') && !token.startsWith('--')
      if (
        flag === '--recursive'
        || (shortFlagGroup && [...token.slice(1)].some((entry) => entry === 'r' || entry === 'R'))
      ) {
        recursive = true
      }
      if (GREP_PATTERN_FLAGS.has(flag)) {
        patternProvided = true
        if (!token.includes('=')) {
          index += 1
        }
        continue
      }
      if (GREP_PATTERN_FILE_FLAGS.has(flag)) {
        patternProvided = true
        if (token.includes('=')) {
          paths.push(token.slice(token.indexOf('=') + 1))
        } else if (args[index + 1]) {
          paths.push(args[index + 1])
          index += 1
        }
        continue
      }
      if (GREP_VALUE_FLAGS.has(flag) && !token.includes('=')) {
        index += 1
      }
      continue
    }

    if (!patternProvided) {
      patternProvided = true
      continue
    }
    paths.push(token)
  }

  if (recursive && paths.length === 0) {
    paths.push('.')
  }

  return paths
}

function isFindExpressionToken(token: string): boolean {
  return token === '('
    || token === ')'
    || token === '!'
    || token === ','
    || token.startsWith('-')
}

function collectFindPathArgs(args: string[]): string[] | null {
  const paths: string[] = []
  let index = 0

  while (index < args.length) {
    const token = args[index]
    if (token === '--') {
      index += 1
      break
    }
    if (FIND_REVIEW_REQUIRED_OPTIONS.has(token)) {
      return null
    }
    if (FIND_LEADING_OPTIONS_WITH_VALUES.has(token)) {
      if (!args[index + 1]) {
        return null
      }
      index += 2
      continue
    }
    if (token.startsWith('-D') || /^-O\d*$/u.test(token)) {
      index += 1
      continue
    }
    if (isFindExpressionToken(token)) {
      break
    }
    paths.push(token)
    index += 1
  }

  const parsedPaths = paths.length > 0 ? paths : ['.']

  while (index < args.length) {
    const token = args[index]

    if (token === '(' || token === ')' || token === '!' || token === ',') {
      index += 1
      continue
    }

    if (FIND_REVIEW_REQUIRED_ACTIONS.has(token) || FIND_REVIEW_REQUIRED_OPTIONS.has(token)) {
      return null
    }

    if (FIND_PATH_VALUE_PREDICATES.has(token)) {
      if (!args[index + 1]) {
        return null
      }
      parsedPaths.push(args[index + 1])
      index += 2
      continue
    }

    if (FIND_VALUE_PREDICATES.has(token)) {
      if (!args[index + 1]) {
        return null
      }
      index += 2
      continue
    }

    if (FIND_NO_VALUE_PREDICATES.has(token)) {
      index += 1
      continue
    }

    if (/^-newer[a-z]{2}$/iu.test(token)) {
      if (!args[index + 1]) {
        return null
      }
      parsedPaths.push(args[index + 1])
      index += 2
      continue
    }

    if (token.startsWith('-')) {
      return null
    }

    if (!isPathLikeToken(token)) {
      return null
    }

    if (index > 0 && args[index - 1] !== '--') {
      return null
    }

    if (isFindExpressionToken(token)) {
      break
    }
    parsedPaths.push(token)
    index += 1
  }

  return parsedPaths
}

function collectTestPathArgs(commandName: string, args: string[]): string[] | null {
  const testArgs = commandName === '['
    ? args.at(-1) === ']'
      ? args.slice(0, -1)
      : null
    : args
  if (!testArgs) {
    return null
  }

  const paths: string[] = []
  for (let index = 0; index < testArgs.length; index += 1) {
    if (TEST_PATH_FLAGS.has(testArgs[index]) && testArgs[index + 1]) {
      paths.push(testArgs[index + 1])
      index += 1
      continue
    }
    if (TEST_BINARY_PATH_OPERATORS.has(testArgs[index])) {
      if (index === 0 || !testArgs[index + 1]) {
        return null
      }
      paths.push(testArgs[index - 1], testArgs[index + 1])
      index += 1
    }
  }
  return paths
}

function collectPackageManagerPathArgs(args: string[]): string[] {
  return args.filter(isPathLikeToken)
}

function collectGitPathArgs(args: string[]): string[] {
  const optionPaths = collectPathOptionValues(args, GIT_PATH_VALUE_FLAGS)
  const doubleDashIndex = args.indexOf('--')
  if (doubleDashIndex !== -1) {
    return [
      ...optionPaths,
      ...args.slice(doubleDashIndex + 1),
    ]
  }
  return [
    ...optionPaths,
    ...args.filter(isPathLikeToken),
  ]
}

function collectSafeCommandPathArgs(commandName: string, args: string[]): string[] | null {
  switch (commandName.toLowerCase()) {
    case 'cat':
    case 'stat':
    case 'file':
      return collectNonOptionPathArgs(args)
    case 'head':
    case 'tail':
      return collectNonOptionPathArgs(args, HEAD_TAIL_VALUE_FLAGS)
    case 'wc':
      return [
        ...collectNonOptionPathArgs(args),
        ...collectPathOptionValues(args, WC_PATH_VALUE_FLAGS),
      ]
    case 'ls': {
      const paths = collectNonOptionPathArgs(args)
      return paths.length > 0 ? paths : ['.']
    }
    case 'grep':
      return collectGrepPathArgs(args)
    case 'find':
      return collectFindPathArgs(args)
    case 'which':
      return args.filter(isPathLikeToken)
    case 'test':
    case '[':
      return collectTestPathArgs(commandName, args)
    case 'npm':
    case 'pnpm':
      return collectPackageManagerPathArgs(args)
    case 'git':
      return collectGitPathArgs(args)
    case 'pwd':
      return []
    case 'date':
      return collectPathOptionValues(args, DATE_PATH_VALUE_FLAGS)
    case 'echo':
    case 'printf':
    case 'true':
    case 'false':
    case 'gh':
    case 'node':
      return []
    default:
      return null
  }
}

function isSafeBashSegment(segment: string, cwd: string | undefined, allowlist: string[]): boolean {
  if (hasUnsupportedShellSyntax(segment) || !SAFE_BASH_PATTERNS.some((pattern) => pattern.test(segment))) {
    return false
  }

  const tokens = tokenizeShellSegment(segment)
  if (!tokens || tokens.length === 0) {
    return false
  }

  const parsed = splitShellArgvAndRedirects(tokens)
  if (!parsed || parsed.argv.length === 0) {
    return false
  }

  const [commandName, ...args] = parsed.argv
  const commandPathArgs = collectSafeCommandPathArgs(commandName, args)
  if (!commandPathArgs) {
    return false
  }

  return validatePathArgs(
    [...commandPathArgs, ...parsed.redirectPaths],
    cwd,
    allowlist,
  )
}

function isSafeBashCommand(command: string, cwd: string | undefined, allowlist: string[]): boolean {
  const segments = splitCompoundCommand(command)
  if (segments.length === 0) {
    return false
  }
  return segments.every((segment) => isSafeBashSegment(segment, cwd, allowlist))
}

function findSafeBashPattern(command: string): string | undefined {
  for (const segment of splitCompoundCommand(command)) {
    const pattern = SAFE_BASH_PATTERNS.find((candidate) => candidate.test(segment))
    if (pattern) {
      return pattern.toString()
    }
  }
  return undefined
}

function matchAction(
  toolName: string,
  toolInput: unknown,
  actions: ActionCategoryDefinition[],
  sessionCwd?: string,
  policyView?: EffectiveActionPolicyView,
): {
  action: ActionCategoryDefinition | null
  matchedBy: 'mcp' | 'bash' | 'tool' | 'fallback'
  matchedPattern?: string
  reviewRequired?: boolean
} {
  const mcpIdentity = parseMcpToolIdentity(toolName)
  if (mcpIdentity) {
    for (const action of actions) {
      if (
        action.id === INTERNAL_EDIT_IN_CWD_ACTION.id
        || action.id === INTERNAL_SAFE_BASH_ACTION.id
        || action.id === INTERNAL_SAFE_MCP_ACTION.id
      ) {
        continue
      }
      for (const matcher of action.matchers.mcpTools ?? []) {
        const normalizedMatcher = normalizeMatcherToken(matcher)
        if (mcpIdentity.exactTokens.includes(normalizedMatcher)) {
          return {
            action,
            matchedBy: 'mcp',
            matchedPattern: matcher,
          }
        }
      }
    }
  }

  if (mcpIdentity) {
    for (const action of actions) {
      if (
        action.id === INTERNAL_EDIT_IN_CWD_ACTION.id
        || action.id === INTERNAL_SAFE_BASH_ACTION.id
        || action.id === INTERNAL_SAFE_MCP_ACTION.id
      ) {
        continue
      }
      for (const server of action.matchers.mcpServers) {
        if (normalizeMatcherToken(server) === mcpIdentity.server) {
          return {
            action,
            matchedBy: 'mcp',
            matchedPattern: server,
          }
        }
      }
    }
  }

  const command = toolName === 'Bash' ? extractCommandText(toolInput) : undefined
  if (command) {
    const segments = splitCompoundCommand(command)
    for (const segment of segments) {
      for (const action of actions) {
        if (
          action.id === INTERNAL_EDIT_IN_CWD_ACTION.id
          || action.id === INTERNAL_SAFE_BASH_ACTION.id
          || action.id === INTERNAL_SAFE_MCP_ACTION.id
        ) {
          continue
        }
        for (const pattern of action.matchers.bashPatterns) {
          if (pattern.test(segment)) {
            return {
              action,
              matchedBy: 'bash',
              matchedPattern: pattern.toString(),
            }
          }
        }
      }
    }
  }

  if (sessionCwd && (toolName === 'Edit' || toolName === 'Write')) {
    const targetPath = extractToolPath(toolInput)
    const editPolicyRecord = policyView
      ? getPolicyRecord(policyView, INTERNAL_EDIT_IN_CWD_ACTION.id)
      : null
    if (targetPath && isPathWithinCwd(targetPath, sessionCwd, {
      allowlist: editPolicyRecord?.allowlist ?? [],
    })) {
      return {
        action: actions.find((candidate) => candidate.id === INTERNAL_EDIT_IN_CWD_ACTION.id) ?? INTERNAL_EDIT_IN_CWD_ACTION,
        matchedBy: 'tool',
        matchedPattern: targetPath,
      }
    }
  }

  if (command) {
    const safeBashPolicyRecord = policyView
      ? getPolicyRecord(policyView, INTERNAL_SAFE_BASH_ACTION.id)
      : null
    if (isSafeBashCommand(command, sessionCwd, safeBashPolicyRecord?.allowlist ?? [])) {
      return {
        action: actions.find((candidate) => candidate.id === INTERNAL_SAFE_BASH_ACTION.id) ?? INTERNAL_SAFE_BASH_ACTION,
        matchedBy: 'bash',
        matchedPattern: findSafeBashPattern(command),
      }
    }
  }

  if (mcpIdentity) {
    if (mcpIdentity.reviewRequiredWhenUnmatched) {
      return {
        action: null,
        matchedBy: 'fallback',
        matchedPattern: toolName,
        reviewRequired: true,
      }
    }
    return {
      action: actions.find((candidate) => candidate.id === INTERNAL_SAFE_MCP_ACTION.id) ?? INTERNAL_SAFE_MCP_ACTION,
      matchedBy: 'mcp',
      matchedPattern: mcpIdentity.server,
    }
  }

  return {
    action: null,
    matchedBy: 'fallback',
  }
}

function getBasePolicy(
  policyView: EffectiveActionPolicyView,
  action: ActionCategoryDefinition | null,
): { record: ActionPolicyRecord | null; policy: ActionPolicyValue } {
  if (!action) {
    return {
      record: null,
      policy: policyView.fallbackPolicy,
    }
  }

  const record = getPolicyRecord(policyView, action.id)
  return {
    record,
    policy: record?.policy ?? policyView.fallbackPolicy,
  }
}

function buildSkillResolution(
  input: ResolveActionPolicyInput,
  skillPolicy: ActionPolicyValue,
): ResolvedActionPolicy {
  const label = input.session?.currentSkillName?.trim()
    ? input.session.currentSkillName.trim()
    : input.session?.currentSkillId?.trim()
      ? `/${input.session.currentSkillId.trim()}`
      : 'Skill Invocation'
  const action: ActionCategoryDefinition = {
    id: input.session?.currentSkillId?.trim()
      ? `skill:${input.session.currentSkillId.trim()}`
      : 'skill:current',
    label,
    group: 'Skills',
    primaryTargetLabel: 'Skill',
    primaryTargetKey: 'skill',
    matchers: {
      mcpServers: [],
      bashPatterns: [],
    },
  }

  return {
    action,
    record: {
      actionId: action.id,
      policy: skillPolicy,
      allowlist: [],
      blocklist: [],
    },
    decision: skillPolicy,
    basePolicy: skillPolicy,
    matchedBy: 'skill',
    context: {
      summary: label,
      details: {
        Skill: label,
      },
    },
  }
}

export function resolveActionPolicy(input: ResolveActionPolicyInput): ResolvedActionPolicy {
  const actions = input.actions ?? BUILT_IN_ACTIONS
  const skillPolicy = input.session?.currentSkillPolicy ?? undefined

  const matched = matchAction(input.toolName, input.toolInput, actions, input.session?.cwd, input.policyView)
  const base = getBasePolicy(input.policyView, matched.action)
  const context = extractApprovalContext(matched.action, input.toolName, input.toolInput)
  const targetValue = context.primaryTarget?.value

  let actionDecision: ActionPolicyValue = base.policy
  let actionMatchedPattern: string | undefined = matched.matchedPattern
  if (base.record && targetValue) {
    const blockedBy = findFirstMatchingGlob(targetValue, base.record.blocklist)
    if (blockedBy) {
      actionDecision = 'block'
      actionMatchedPattern = blockedBy
    } else {
      const allowedBy = findFirstMatchingGlob(targetValue, base.record.allowlist)
      if (allowedBy) {
        actionDecision = 'auto'
        actionMatchedPattern = allowedBy
      }
    }
  }
  if (!matched.action) {
    actionDecision = input.policyView.fallbackPolicy
  }
  if (matched.reviewRequired) {
    actionDecision = stricterPolicy('review', actionDecision)
  }

  if (skillPolicy) {
    const decision = stricterPolicy(skillPolicy, actionDecision)
    if (decision === actionDecision && decision !== skillPolicy) {
      return {
        action: matched.action,
        record: base.record,
        decision,
        basePolicy: base.policy,
        matchedBy: matched.matchedBy,
        matchedPattern: actionMatchedPattern,
        context,
      }
    }

    const skillResolution = buildSkillResolution(input, skillPolicy)
    return {
      ...skillResolution,
      decision,
      basePolicy: skillPolicy,
    }
  }

  return {
    action: matched.action,
    record: base.record,
    decision: actionDecision,
    basePolicy: base.policy,
    matchedBy: matched.matchedBy,
    matchedPattern: actionMatchedPattern,
    context,
  }
}
