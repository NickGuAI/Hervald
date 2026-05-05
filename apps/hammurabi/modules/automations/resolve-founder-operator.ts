import { defaultOperatorStorePath, OperatorStore } from '../operators/store.js'

export async function resolveFounderOperatorId(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const storePath = defaultOperatorStorePath(env)
  const store = new OperatorStore(storePath)
  const operator = await store.getFounder()
  if (!operator) {
    throw new Error(`Founder operator not found in "${storePath}"`)
  }

  return operator.id
}
