import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { expect, it } from 'vitest'

it('emits the registered lazy route outside the routing application startup graph', async () => {
  const root = fileURLToPath(
    new URL('../../../examples/routing/', import.meta.url),
  )
  const result = await build({
    root,
    logLevel: 'silent',
    build: { write: false, minify: false },
  })
  const output = Array.isArray(result) ? result.at(0) : result
  if (!output || !('output' in output)) {
    throw new Error('Expected a completed routing application build')
  }
  const chunks = output.output.filter(item => item.type === 'chunk')
  const startup = new Set<string>()
  const visit = (filename: string) => {
    if (startup.has(filename)) {
      return
    }
    startup.add(filename)
    for (const imported of chunks.find(chunk => chunk.fileName === filename)
      ?.imports ?? []) {
      visit(imported)
    }
  }
  for (const entry of chunks.filter(chunk => chunk.isEntry)) {
    visit(entry.fileName)
  }
  const implementation = fileURLToPath(
    new URL(
      '../../../examples/routing/src/page/nested/implementation.ts',
      import.meta.url,
    ),
  )
  const page = chunks.find(chunk =>
    Object.hasOwn(chunk.modules, implementation),
  )
  expect(page).toBeDefined()
  expect(page?.isDynamicEntry).toBe(true)
  expect(startup.has(page?.fileName ?? '')).toBe(false)
})
