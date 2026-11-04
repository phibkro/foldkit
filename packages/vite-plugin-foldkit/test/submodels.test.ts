import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, createServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  foldkitSubmodels,
  generateSubmodelCatalog,
  writeSubmodelCatalog,
} from '../src/submodels.js'

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'foldkit-submodels-'))
  temporary.push(root)
  for (const id of ['a', 'b']) {
    mkdirSync(join(root, id))
    writeFileSync(
      join(root, id, 'page.contract.ts'),
      `export const contract = { id: '${id}' }`,
    )
    writeFileSync(
      join(root, id, 'implementation.ts'),
      `export const implementation = { value: '${id}', update: () => '${id}-updated' }`,
    )
  }
  writeFileSync(
    join(root, 'factory.ts'),
    'export const lazy = (contract, options) => ({ id: contract.id, load: options.load })',
  )
  writeFileSync(
    join(root, 'main.ts'),
    "export { createCatalog } from './catalog.generated.ts'",
  )
  const options = {
    directory: root,
    catalog: join(root, 'catalog.generated.ts'),
    factoryModule: './factory.ts',
  }
  writeSubmodelCatalog(options)
  return { root, options }
}

const compile = async (
  root: string,
  options: Parameters<typeof foldkitSubmodels>[0],
) => {
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [foldkitSubmodels(options)],
    build: {
      write: false,
      minify: false,
      lib: { entry: join(root, 'main.ts'), formats: ['es'] },
    },
  })
  const output = Array.isArray(result) ? result[0] : result
  if (!output || !('output' in output)) {
    throw new Error('Expected a completed production build')
  }
  return output.output
}

describe('Submodel catalog compiler', () => {
  it('automatically generates separate implementations and excludes them from the initial static closure', async () => {
    const { root, options } = fixture()
    expect(generateSubmodelCatalog(options).code).toContain(
      './a/implementation.js',
    )
    const output = await compile(root, options)
    const chunks = output.filter(item => item.type === 'chunk')
    const entries = chunks.filter(chunk => chunk.isEntry)
    const visited = new Set<string>()
    const visit = (file: string) => {
      if (visited.has(file)) {
        return
      }
      visited.add(file)
      for (const imported of chunks.find(chunk => chunk.fileName === file)
        ?.imports ?? []) {
        visit(imported)
      }
    }
    entries.forEach(entry => visit(entry.fileName))
    for (const id of ['a', 'b']) {
      const implementation = join(root, id, 'implementation.ts')
      const chunk = chunks.find(item =>
        Object.hasOwn(item.modules, implementation),
      )
      expect(chunk).toBeDefined()
      expect(chunk?.isDynamicEntry).toBe(true)
      expect(visited.has(chunk!.fileName)).toBe(false)
    }
    const manifest = output.find(
      item =>
        item.type === 'asset' && item.fileName === 'foldkit-submodels.json',
    )
    expect(
      manifest?.type === 'asset' && JSON.parse(String(manifest.source)).modules,
    ).toHaveLength(2)
    expect(generateSubmodelCatalog(options).code).toBe(
      generateSubmodelCatalog(options).code,
    )
  })

  it('rejects an implementation that leaks into startup through another import', async () => {
    const { root, options } = fixture()
    writeFileSync(
      join(root, 'main.ts'),
      "export { createCatalog } from './catalog.generated.ts'; export { implementation } from './a/implementation.ts'",
    )
    await expect(compile(root, options)).rejects.toThrow(
      'implementation is in startup chunk',
    )
  })

  it('checks configured implementation filenames outside the default convention', async () => {
    const { root, options: original } = fixture()
    const options = { ...original, implementationFile: 'page.ts' }
    for (const id of ['a', 'b']) {
      writeFileSync(
        join(root, id, 'page.ts'),
        `export const implementation = { value: '${id}' }`,
      )
    }
    writeSubmodelCatalog(options)
    writeFileSync(
      join(root, 'main.ts'),
      "export { createCatalog } from './catalog.generated.ts'; export { implementation } from './a/page.ts'",
    )
    await expect(compile(root, options)).rejects.toThrow(
      'implementation is in startup chunk',
    )
  })

  it('reports missing implementations and stale catalogs with a concrete correction', async () => {
    const { root, options } = fixture()
    writeFileSync(options.catalog, '// stale')
    await expect(compile(root, options)).rejects.toThrow('catalog is stale')
    rmSync(join(root, 'a/implementation.ts'))
    expect(() => generateSubmodelCatalog(options)).toThrow(
      'missing Submodel implementation',
    )
  })

  it('diagnoses a contract importing executable code and cross-route implementation imports', async () => {
    const { root, options } = fixture()
    writeFileSync(
      join(root, 'a/page.contract.ts'),
      "export { implementation as contract } from './implementation.ts'",
    )
    await expect(compile(root, options)).rejects.toThrow(
      'contract imports executable code',
    )
    writeFileSync(
      join(root, 'a/page.contract.ts'),
      "export const contract = { id: 'a' }",
    )
    writeFileSync(
      join(root, 'a/implementation.ts'),
      "import { implementation as other } from '../b/implementation.ts'; export const implementation = { ...other, value: 'a' }",
    )
    await expect(compile(root, options)).rejects.toThrow(
      'Cross-route Submodel import',
    )
  })

  it('gives identical builds the same identity and changes it when an implementation changes', async () => {
    const { root, options } = fixture()
    writeFileSync(
      join(root, 'main.ts'),
      "export { default as buildId } from 'virtual:foldkit-submodels/build-id'; export { createCatalog } from './catalog.generated.ts'",
    )
    const identity = async () =>
      (await compile(root, options))
        .filter(item => item.type === 'chunk' && item.isEntry)
        .map(item => (item.type === 'chunk' ? item.code : ''))
        .join('')
        .match(/[a-f0-9]{64}/)?.[0]
    const first = await identity()
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(await identity()).toBe(first)
    writeFileSync(
      join(root, 'a/implementation.ts'),
      "export const implementation = { value: 'changed' }",
    )
    expect(await identity()).not.toBe(first)
  })
  it('rotates the development identity and reloads after an implementation dependency changes', async () => {
    const { root, options: original } = fixture()
    const options = { ...original, directory: join(root, 'a') }
    writeFileSync(join(root, 'shared.ts'), "export const value = 'before'")
    writeFileSync(
      join(root, 'a/implementation.ts'),
      "import { value } from '../shared.ts'; export const implementation = { value }",
    )
    writeSubmodelCatalog(options)
    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [foldkitSubmodels(options)],
      server: { host: '127.0.0.1', port: 0 },
    })
    try {
      await server.listen()
      const client = server.environments.client!
      const initial = await client.transformRequest(
        'virtual:foldkit-submodels/build-id',
      )
      await client.transformRequest('/a/implementation.ts')
      await client.transformRequest('/shared.ts')
      const send = vi.spyOn(client.hot, 'send')
      const fullReload = (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'full-reload'
      writeFileSync(join(root, 'shared.ts'), "export const value = 'after'")
      server.watcher.emit('change', join(root, 'shared.ts'))
      await vi.waitFor(() =>
        expect(send.mock.calls.some(args => fullReload(args[0]))).toBe(true),
      )
      const changed = await client.transformRequest(
        'virtual:foldkit-submodels/build-id',
      )
      expect(changed?.code).not.toBe(initial?.code)
      expect(changed?.code).toContain('export default')
    } finally {
      await server.close()
    }
  })
})
