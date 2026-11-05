import { describe, expect, it } from 'vitest'

import { createModuleLoader } from './moduleLoader.js'

describe('module preparation barrier', () => {
  it('coalesces prefetch and navigation and makes the module available only after completion', async () => {
    let finish: (module: { readonly name: string }) => void = () => {}
    let calls = 0
    const cache = createModuleLoader(() => {
      calls += 1
      return new Promise<{ readonly name: string }>(resolve => {
        finish = resolve
      })
    })
    expect(() => cache.require()).toThrow('not prepared')
    const first = cache.load()
    expect(cache.load()).toBe(first)
    await Promise.resolve()
    expect(() => cache.require()).toThrow('not prepared')
    finish({ name: 'route' })
    await first
    expect(cache.require().name).toBe('route')
    await cache.load()
    expect(calls).toBe(1)
  })

  it('retries synchronous and asynchronous failures', async () => {
    let attempts = 0
    const cache = createModuleLoader(() => {
      attempts += 1
      if (attempts === 1) {
        throw new Error('sync')
      }
      if (attempts === 2) {
        return Promise.reject(new Error('async'))
      }
      return Promise.resolve('ready')
    })
    await expect(cache.load()).rejects.toThrow('sync')
    await expect(cache.load()).rejects.toThrow('async')
    expect(() => cache.require()).toThrow('not prepared')
    await cache.load()
    expect(cache.require()).toBe('ready')
  })

  it('isolates app instances and requires preparation before replay in a new app', async () => {
    const firstApp = createModuleLoader(() => Promise.resolve('first'))
    const secondApp = createModuleLoader(() => Promise.resolve('second'))
    await firstApp.load()
    expect(() => secondApp.require()).toThrow('not prepared')
    await secondApp.load()
    expect(firstApp.require()).toBe('first')
    expect(secondApp.require()).toBe('second')
  })
})
