import { defaultOperatorStorePath, OperatorStore } from '../operators/store.js'

export class MissingFounderOperatorError extends Error {
  constructor(public readonly storePath: string) {
    super(`Founder operator not found in "${storePath}"`)
    this.name = 'MissingFounderOperatorError'
  }
}

export function isMissingFounderOperatorError(error: unknown): error is MissingFounderOperatorError {
  return error instanceof MissingFounderOperatorError
}

export async function resolveFounderOperatorId(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const storePath = defaultOperatorStorePath(env)
  const store = new OperatorStore(storePath)
  const operator = await store.getFounder()
  if (!operator) {
    throw new MissingFounderOperatorError(storePath)
  }

  return operator.id
}
