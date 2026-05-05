import * as ReactModule from './node_modules/react/index.js'

export * from './node_modules/react/index.js'
export default ReactModule

async function flushMessageChannel(): Promise<void> {
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(undefined)
  })
}

export async function act<T>(callback: () => T | Promise<T>): Promise<T> {
  const result = await callback()
  await Promise.resolve()
  await Promise.resolve()
  await flushMessageChannel()
  return result
}
