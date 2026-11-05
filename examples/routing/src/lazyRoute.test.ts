import { Array, Effect, Option, Schema } from 'effect'
import { fromString } from 'foldkit/url'
import { describe, expect, it, vi } from 'vitest'

import { NestedPage } from './lazyPage'
import {
  AppRoute,
  Message,
  Model,
  init,
  prepareModel,
  resumeModel,
  update,
} from './main'
import { implementation } from './page/nested/implementation'
import { Message as NestedMessage } from './page/nested/page.contract'

const url = (path: string) =>
  Option.getOrThrow(fromString(`https://example.com${path}`))
const nestedPath = '/nested/route/is/very/nested'
const navigate = (model: Model, path: string) =>
  update(model, Message.ChangedUrl({ url: url(path) }))
const complete = async (navigation: ReturnType<typeof init>) => {
  const preparation = Option.getOrThrow(
    Array.findFirst(
      navigation.commands ?? [],
      command => command.name === NestedPage.Prepare.name,
    ),
  )
  return update(navigation.model, await Effect.runPromise(preparation.effect))
}
const increment = (model: Model) => {
  const nested = Option.getOrThrow(model.maybeNestedPage)
  return update(
    model,
    Message.GotNestedMessage({
      message: NestedPage.Message.GotChildMessage({
        instance: nested.instance,
        buildId: nested.buildId,
        message: NestedMessage.ClickedIncrement(),
      }),
    }),
  )
}

describe('lazy route lifecycle', () => {
  it('returns loading state on cold entry and admits the page only after completion', async () => {
    const cold = init(url(nestedPath))
    expect(cold.model.route).toEqual(AppRoute.Nested())
    expect(Option.getOrThrow(cold.model.maybeNestedPage)._tag).toBe('Loading')
    const loaded = await complete(cold)
    expect(Option.getOrThrow(loaded.model.maybeNestedPage)).toMatchObject({
      _tag: 'Ready',
      model: { visits: 0 },
    })
  })

  it('prefetch warms code without creating or initializing a page Model', async () => {
    const initialize = vi.spyOn(implementation, 'init')
    try {
      const home = init(url('/')).model
      const prefetched = update(home, Message.FocusedNestedLink())
      expect(prefetched.model).toBe(home)
      await Effect.runPromise(
        Effect.all(
          Array.map(prefetched.commands ?? [], command => command.effect),
        ),
      )
      expect(initialize).not.toHaveBeenCalled()
      expect(Option.isNone(prefetched.model.maybeNestedPage)).toBe(true)
      await complete(navigate(home, nestedPath))
      expect(initialize).toHaveBeenCalledTimes(1)
    } finally {
      initialize.mockRestore()
    }
  })

  it('ignores a pending completion after leaving and after a new visit starts', async () => {
    const first = init(url(nestedPath))
    const preparation = Option.getOrThrow(
      Array.findFirst(
        first.commands ?? [],
        command => command.name === NestedPage.Prepare.name,
      ),
    )
    const oldCompletion = await Effect.runPromise(preparation.effect)
    const away = navigate(first.model, '/').model
    expect(update(away, oldCompletion).model).toBe(away)
    const current = navigate(away, nestedPath)
    expect(current.model.nestedInstance).toBe(2)
    expect(update(current.model, oldCompletion).model).toEqual(current.model)
    expect(
      Option.getOrThrow((await complete(current)).model.maybeNestedPage)._tag,
    ).toBe('Ready')
  })

  it('parks child state, revives it on re-entry and rejects a prior instance Message', async () => {
    const ready = await complete(init(url(nestedPath)))
    const edited = increment(ready.model)
    const previous = Option.getOrThrow(edited.model.maybeNestedPage)
    const away = navigate(edited.model, '/').model
    expect(increment(away).model).toBe(away)
    const revisited = await complete(navigate(away, nestedPath))
    expect(Option.getOrThrow(revisited.model.maybeNestedPage)).toMatchObject({
      _tag: 'Ready',
      instance: 2,
      model: { visits: 1 },
    })
    const late = Message.GotNestedMessage({
      message: NestedPage.Message.GotChildMessage({
        instance: previous.instance,
        buildId: previous.buildId,
        message: NestedMessage.ClickedIncrement(),
      }),
    })
    expect(update(revisited.model, late).model).toEqual(revisited.model)
  })

  it('resumes restored Loading state and prepares serialized parked Ready state', async () => {
    const loading = init(url(nestedPath)).model
    const decoded = Schema.decodeSync(Schema.toCodecJson(Model))(
      Schema.encodeSync(Schema.toCodecJson(Model))(loading),
    )
    const resumed = { model: decoded, commands: resumeModel(decoded) }
    expect(
      Option.getOrThrow((await complete(resumed)).model.maybeNestedPage)._tag,
    ).toBe('Ready')
    const ready = (await complete(init(url(nestedPath)))).model
    const parked = navigate(ready, '/').model
    const restored = Schema.decodeSync(Schema.toCodecJson(Model))(
      Schema.encodeSync(Schema.toCodecJson(Model))(parked),
    )
    await Effect.runPromise(prepareModel(restored))
    expect(resumeModel(restored)).toEqual([])
    expect(Option.getOrThrow(restored.maybeNestedPage)._tag).toBe('Ready')
  })
})
