import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, '..')
const adaptersRoot = path.join(appRoot, 'modules', 'agents', 'adapters')
const generatedRoot = path.join(appRoot, 'modules', 'agents', 'providers', '.generated')
const generatedFile = path.join(generatedRoot, 'registered.ts')
const generatedLoadersFile = path.join(generatedRoot, 'registered-loaders.ts')

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function collectAdapterIds(fileName) {
  const entries = await readdir(adaptersRoot, { withFileTypes: true })
  const ids = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    if (await fileExists(path.join(adaptersRoot, entry.name, fileName))) {
      ids.push(entry.name)
    }
  }

  return ids.sort((left, right) => left.localeCompare(right))
}

function renderImportMap(constName, ids, fileName) {
  const lines = ids.map((id) => (
    `  ${JSON.stringify(id)}: () => import('../../adapters/${id}/${fileName}.js'),`
  ))

  return [
    `export const ${constName} = {`,
    ...lines,
    '} as const',
  ].join('\n')
}

function renderSideEffectImports(ids, fileName) {
  return ids.map((id) => `import '../../adapters/${id}/${fileName}.js'`).join('\n')
}

async function main() {
  const [providerIds, machineAdapterIds] = await Promise.all([
    collectAdapterIds('provider.ts'),
    collectAdapterIds('machine-adapter.ts'),
  ])

  const contents = [
    '// generated; do not edit',
    '',
    renderSideEffectImports(providerIds, 'provider'),
    providerIds.length > 0 ? '' : '',
    renderSideEffectImports(machineAdapterIds, 'machine-adapter'),
    '',
  ].join('\n')
  const loaderContents = [
    '// generated; do not edit',
    '',
    renderImportMap('adapterImports', providerIds, 'provider'),
    '',
    renderImportMap('machineAdapterImports', machineAdapterIds, 'machine-adapter'),
    '',
  ].join('\n')

  await mkdir(generatedRoot, { recursive: true })
  await Promise.all([
    writeFile(generatedFile, contents, 'utf8'),
    writeFile(generatedLoadersFile, loaderContents, 'utf8'),
  ])
}

await main()
