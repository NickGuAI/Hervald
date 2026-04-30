import {
  DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  getClaudeDisableAdaptiveThinkingEnvValue,
  type ClaudeAdaptiveThinkingMode,
} from '../../../claude-adaptive-thinking.js'
import { DEFAULT_CLAUDE_EFFORT_LEVEL, type ClaudeEffortLevel } from '../../../claude-effort.js'
import { CLAUDE_DISABLE_ADAPTIVE_THINKING_ENV } from '../../constants.js'
import {
  ANTHROPIC_MODEL_ENV_KEYS,
  buildLoginShellBootstrap,
  buildUnsetEnvironmentCommand,
  scrubEnvironmentVariables,
  shellEscape,
} from '../../machines.js'
import type { ClaudePermissionMode } from '../../types.js'

export function buildClaudeStreamArgs(
  mode: ClaudePermissionMode,
  resumeSessionId?: string,
  systemPrompt?: string,
  maxTurns?: number,
  effort: ClaudeEffortLevel = DEFAULT_CLAUDE_EFFORT_LEVEL,
  settingsJson?: string,
  model?: string,
): string[] {
  const args = ['-p', '--verbose', '--output-format', 'stream-json', '--input-format', 'stream-json', '--effort', effort]
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt)
  }
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId)
  }
  if (maxTurns !== undefined && maxTurns > 0) {
    args.push('--max-turns', String(maxTurns))
  }
  if (typeof model === 'string' && model.trim().length > 0) {
    args.push('--model', model.trim())
  }
  if (typeof settingsJson === 'string' && settingsJson.trim().length > 0) {
    args.push('--settings', settingsJson)
  }
  return args
}

export interface ClaudeApprovalEnvOptions {
  port?: number | string
  internalToken?: string
  baseUrl?: string
}

export function resolveClaudeApprovalPort(
  env: NodeJS.ProcessEnv,
  override?: number | string,
): string {
  if (override !== undefined && override !== null && String(override).trim().length > 0) {
    return String(override).trim()
  }
  const fromHammurabi = env.HAMMURABI_PORT?.trim()
  if (fromHammurabi) {
    return fromHammurabi
  }
  const fromPort = env.PORT?.trim()
  if (fromPort) {
    return fromPort
  }
  return '20001'
}

/**
 * Force Claude to emit summarized plaintext extended-thinking deltas.
 *
 * Anthropic flipped Opus 4-7 to encrypted-thinking by default ("display omitted"),
 * which makes the assistant envelope ship empty `thinking: ""` plus a signed blob
 * that the UI can't render. Setting `display: "summarized"` on the request body
 * restores plaintext deltas. The CLI exposes this via `CLAUDE_CODE_EXTRA_BODY`.
 *
 * If the caller already set CLAUDE_CODE_EXTRA_BODY (e.g. user override or another
 * harness layer), we deep-merge our `thinking` defaults into the existing JSON
 * rather than clobbering. Caller wins on every other field; caller wins on the
 * `thinking` sub-object too if it's already present (we only fill in defaults).
 */
export function mergeClaudeExtraBody(existing: string | undefined): string {
  const ourDefaults: Record<string, unknown> = {
    thinking: { type: 'adaptive', display: 'summarized' },
  }

  const trimmed = existing?.trim()
  if (!trimmed) {
    return JSON.stringify(ourDefaults)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Caller's value is malformed JSON — replace it with our defaults rather
    // than ship an unparseable env var to the CLI.
    return JSON.stringify(ourDefaults)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return JSON.stringify(ourDefaults)
  }

  const merged: Record<string, unknown> = { ...(parsed as Record<string, unknown>) }
  const callerThinking = merged.thinking
  if (callerThinking && typeof callerThinking === 'object' && !Array.isArray(callerThinking)) {
    merged.thinking = {
      ...(ourDefaults.thinking as Record<string, unknown>),
      ...(callerThinking as Record<string, unknown>),
    }
  } else if (merged.thinking === undefined || merged.thinking === null) {
    merged.thinking = ourDefaults.thinking
  }
  // If caller set thinking to a non-object (string/array/etc), leave it alone —
  // they presumably know what they want and we shouldn't fight that.
  return JSON.stringify(merged)
}

export function buildClaudeSpawnEnv(
  env: NodeJS.ProcessEnv,
  adaptiveThinking: ClaudeAdaptiveThinkingMode = DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  approval: ClaudeApprovalEnvOptions = {},
): NodeJS.ProcessEnv {
  const port = resolveClaudeApprovalPort(env, approval.port)
  const baseUrl = approval.baseUrl?.trim() || env.HAMMURABI_APPROVAL_BASE_URL?.trim() || `http://127.0.0.1:${port}`
  const internalToken = approval.internalToken?.trim() || env.HAMMURABI_INTERNAL_TOKEN?.trim()

  const spawnEnv: NodeJS.ProcessEnv = {
    ...scrubEnvironmentVariables(env, ['CLAUDECODE', ...ANTHROPIC_MODEL_ENV_KEYS]),
    CLAUDECODE: undefined,
    CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: getClaudeDisableAdaptiveThinkingEnvValue(adaptiveThinking),
    CLAUDE_CODE_EXTRA_BODY: mergeClaudeExtraBody(env.CLAUDE_CODE_EXTRA_BODY),
    HAMMURABI_PORT: port,
    HAMMURABI_APPROVAL_BASE_URL: baseUrl,
  }
  if (internalToken) {
    spawnEnv.HAMMURABI_INTERNAL_TOKEN = internalToken
  }
  return spawnEnv
}

export function buildClaudeEnvironmentPrefix(
  adaptiveThinking: ClaudeAdaptiveThinkingMode = DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
): string {
  return `export ${CLAUDE_DISABLE_ADAPTIVE_THINKING_ENV}=${getClaudeDisableAdaptiveThinkingEnvValue(adaptiveThinking)} && ${buildUnsetEnvironmentCommand(['CLAUDECODE', ...ANTHROPIC_MODEL_ENV_KEYS])}`
}

export function buildClaudePtyCommand(
  mode: ClaudePermissionMode,
  effort: ClaudeEffortLevel = DEFAULT_CLAUDE_EFFORT_LEVEL,
  adaptiveThinking: ClaudeAdaptiveThinkingMode = DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
): string {
  const base = `${buildClaudeEnvironmentPrefix(adaptiveThinking)} && claude --effort ${effort}`
  return base
}

export function buildClaudeShellInvocation(
  args: string[],
  adaptiveThinking: ClaudeAdaptiveThinkingMode = DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
): string {
  const envPrefix = `export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=${getClaudeDisableAdaptiveThinkingEnvValue(adaptiveThinking)}; ${buildUnsetEnvironmentCommand(['CLAUDECODE', ...ANTHROPIC_MODEL_ENV_KEYS])};`
  return `${envPrefix} claude ${args.map((arg) => shellEscape(arg)).join(' ')}`
}

const CLAUDE_APPROVAL_HOOK_INLINE_SCRIPT = `
const process=require("node:process");
function emitPreToolUseDecision(decision,reason){const hookSpecificOutput={hookEventName:"PreToolUse",permissionDecision:decision};if(typeof reason==="string"&&reason.trim().length>0){hookSpecificOutput.permissionDecisionReason=reason.trim();}process.stdout.write(JSON.stringify({hookSpecificOutput})+"\\n");process.exit(0);}
function failOpenEnabled(){return process.env.HAMMURABI_APPROVAL_FAIL_OPEN?.trim()==="1";}
function failClosed(reason){if(failOpenEnabled()){process.stderr.write(reason+"\\n");emitPreToolUseDecision("allow",reason);return;}process.stderr.write(reason+"\\n");process.exit(2);}
function defaultBaseUrl(){const explicit=process.env.HAMMURABI_APPROVAL_BASE_URL?.trim();if(explicit){return explicit.replace(/\\/+$/,"");}const port=process.env.HAMMURABI_PORT?.trim()||"20001";return \`http://127.0.0.1:\${port}\`;}
async function readStdin(){const chunks=[];for await(const chunk of process.stdin){chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk)));}return Buffer.concat(chunks).toString("utf8");}
(async()=>{const raw=await readStdin();if(!raw.trim()){process.exit(0);}let payload;try{payload=JSON.parse(raw);}catch{payload=raw;}if(payload&&typeof payload==="object"&&!Array.isArray(payload)&&process.env.HAMMURABI_SESSION_NAME&&typeof payload.hammurabi_session_name!=="string"){payload.hammurabi_session_name=process.env.HAMMURABI_SESSION_NAME;}const headers={"content-type":"application/json"};const internalToken=process.env.HAMMURABI_INTERNAL_TOKEN?.trim();if(internalToken){headers["x-hammurabi-internal-token"]=internalToken;}let response;try{response=await fetch(\`\${defaultBaseUrl()}/api/approval/check\`,{method:"POST",headers,body:typeof payload==="string"?payload:JSON.stringify(payload)});}catch(error){const message=error instanceof Error?error.message:String(error);failClosed(\`approval service unreachable (\${message})\`);return;}if(!response.ok){let errorText="";try{errorText=(await response.text()).trim();}catch{}const detail=errorText?\`: \${errorText}\`:"";failClosed(\`approval service returned HTTP \${response.status}\${detail}\`);return;}let responsePayload;try{responsePayload=await response.json();}catch(error){const message=error instanceof Error?error.message:String(error);failClosed(\`approval response was not valid JSON (\${message})\`);return;}const reason=typeof responsePayload?.reason==="string"&&responsePayload.reason.trim().length>0?responsePayload.reason.trim():undefined;if(responsePayload?.decision==="allow"){emitPreToolUseDecision("allow",reason);return;}process.stderr.write((reason??"Action rejected by Hammurabi policy.")+"\\n");process.exit(2);})().catch((error)=>{const message=error instanceof Error?error.message:String(error);failClosed(\`hook crashed (\${message})\`);});
`.trim()

export function buildClaudeApprovalHookCommand(): string {
  return `node -e ${shellEscape(CLAUDE_APPROVAL_HOOK_INLINE_SCRIPT)}`
}

export function buildClaudeLocalLoginShellSpawn(
  args: string[],
  adaptiveThinking: ClaudeAdaptiveThinkingMode = DEFAULT_CLAUDE_ADAPTIVE_THINKING_MODE,
  cwd?: string,
  envFile?: string,
  shellPath?: string,
): { command: string; args: string[] } {
  const normalizedScript = cwd
    ? `cd ${shellEscape(cwd)} && ${buildClaudeShellInvocation(args, adaptiveThinking)}`
    : buildClaudeShellInvocation(args, adaptiveThinking)
  const script = `${buildLoginShellBootstrap(envFile)}; ${normalizedScript}`
  return {
    command: shellPath?.trim() || '/bin/bash',
    args: ['-lc', script],
  }
}

export function buildClaudeApprovalSettingsJson(): string {
  return JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: buildClaudeApprovalHookCommand(),
            },
          ],
        },
      ],
    },
  })
}
