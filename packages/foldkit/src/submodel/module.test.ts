import { Effect, Option, Schema } from 'effect'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import * as Command from '../command/index.js'
import { defineView } from '../html/submodel.js'
import { defineMessageUnion } from '../message/index.js'
import * as Update from '../update/index.js'
import { contract, eager, implement, lazy } from './module.js'

const ChildModel = Schema.Struct({ count: Schema.Number })
const ChildMessage = defineMessageUnion({
  ClickedIncrement: {},
  ClickedSave: {},
  CompletedSave: { count: Schema.Number },
})
const OutMessage = defineMessageUnion({
  ChangedCount: { count: Schema.Number },
})
const Input = Schema.Struct({ initial: Schema.Number })
const Counter = contract('Counter', {
  Model: ChildModel,
  Message: ChildMessage,
  Input,
  OutMessage,
})
const Save = Command.define('Save', {
  args: { count: Schema.Number },
  messages: [ChildMessage.CompletedSave],
  execute: ({ count }) => Effect.succeed(ChildMessage.CompletedSave({ count })),
})
const implementation = implement(Counter, {
  init: input => ({ model: { count: input.initial } }),
  update: (model, message) =>
    ChildMessage.match<
      Update.ReturnWithOutMessage<
        typeof ChildModel.Type,
        typeof ChildMessage.Type,
        typeof OutMessage.Type
      >
    >(message, {
      ClickedIncrement: () => ({
        model: { count: model.count + 1 },
        outMessage: OutMessage.ChangedCount({ count: model.count + 1 }),
      }),
      ClickedSave: () => ({ model, commands: [Save({ count: model.count })] }),
      CompletedSave: ({ count }) => ({ model: { count } }),
    }),
  revive: (model, input) => ({ model: { count: model.count + input.initial } }),
  view: defineView<
    typeof ChildModel.Type,
    typeof ChildMessage.Type,
    { readonly input: typeof Input.Type }
  >((model, _inputs, h) =>
    h.button(
      [h.OnClick(ChildMessage.ClickedIncrement())],
      [String(model.count)],
    ),
  ),
})
const buildId = 'test-build'
const makeHost = () =>
  lazy(Counter, { buildId, load: () => Promise.resolve(implementation) })
type Host = ReturnType<typeof makeHost>
type HostModel = Host['Model']['Type']
type HostMessage = Host['Message']['Type']

const finish = async (
  host: Host,
  step: Update.ReturnWithOutMessage<
    HostModel,
    HostMessage,
    typeof OutMessage.Type
  >,
) => host.update(step.model, await Effect.runPromise(step.commands![0]!.effect))

describe('complete Submodel host', () => {
  for (const adapter of ['eager', 'lazy']) {
    it(`${adapter} composes child Messages, Commands and OutMessages through the same parent fold`, async () => {
      const host =
        adapter === 'eager'
          ? eager(Counter, { buildId, implementation })
          : makeHost()
      const ParentModel = Schema.Struct({
        counter: host.Model,
        reported: Schema.Number,
      })
      type ParentModel = typeof ParentModel.Type
      const ParentMessage = defineMessageUnion({
        GotCounterMessage: { message: host.Message },
      })
      type ParentMessage = typeof ParentMessage.Type
      const foldCounter = Update.foldChild({
        update: host.update,
        read: (model: ParentModel) => Option.some(model.counter),
        write: (model, counter) => ({ ...model, counter }),
        toParentMessage: (message: HostMessage): ParentMessage =>
          ParentMessage.GotCounterMessage({ message }),
        foldOutMessage: OutMessage.match<
          Update.Step<ParentModel, ParentMessage>
        >({
          ChangedCount:
            ({ count }) =>
            model => ({ model: { ...model, reported: count } }),
        }),
      })
      const loaded = await finish(host, host.enter({ initial: 4 }, 1))
      const parent = { counter: loaded.model, reported: 0 }
      const incremented = foldCounter(
        parent,
        host.Message.GotChildMessage({
          instance: 1,
          buildId,
          message: ChildMessage.ClickedIncrement(),
        }),
      )
      expect(incremented.model.reported).toBe(5)
      expect(incremented.model.counter).toMatchObject({
        _tag: 'Ready',
        model: { count: 5 },
      })
      const saved = foldCounter(
        incremented.model,
        host.Message.GotChildMessage({
          instance: 1,
          buildId,
          message: ChildMessage.ClickedSave(),
        }),
      )
      const result = await Effect.runPromise(saved.commands![0]!.effect)
      expectTypeOf(result).toEqualTypeOf<ParentMessage>()
      expect(result).toMatchObject({
        _tag: 'GotCounterMessage',
        message: {
          _tag: 'GotChildMessage',
          instance: 1,
          message: { _tag: 'CompletedSave', count: 5 },
        },
      })
    })
  }

  it('keeps enter pure and ignores A → B → A load completions from earlier instances', async () => {
    const load = vi.fn(() => Promise.resolve(implementation))
    const host = lazy(Counter, { buildId, load })
    const first = host.enter({ initial: 1 }, 1)
    const current = host.enter({ initial: 9 }, 3)
    expect(load).not.toHaveBeenCalled()
    const oldCompletion = await Effect.runPromise(first.commands![0]!.effect)
    expect(host.update(current.model, oldCompletion).model).toBe(current.model)
    const ready = await finish(host, current)
    expect(ready.model).toMatchObject({
      _tag: 'Ready',
      instance: 3,
      model: { count: 9 },
    })
    const late = host.Message.GotChildMessage({
      instance: 1,
      buildId,
      message: ChildMessage.CompletedSave({ count: 100 }),
    })
    expect(host.update(ready.model, late).model).toBe(ready.model)
  })

  it('retries failed chunks and rejects a completion from an older attempt', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(implementation)
    const host = lazy(Counter, { buildId, load })
    const first = host.enter({ initial: 2 }, 1)
    const failedCompletion = await Effect.runPromise(first.commands![0]!.effect)
    const failed = host.update(first.model, failedCompletion)
    expect(failed.model).toMatchObject({ _tag: 'Failed', attempt: 0 })
    const retry = host.update(failed.model, host.Message.ClickedRetry())
    expect(retry.model).toMatchObject({ _tag: 'Loading', attempt: 1 })
    expect(host.update(retry.model, failedCompletion).model).toBe(retry.model)
    expect((await finish(host, retry)).model).toMatchObject({
      _tag: 'Ready',
      model: { count: 2 },
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('prefetch does not initialize state or change the admission protocol', async () => {
    const init = vi.fn(implementation.init)
    const host = lazy(Counter, {
      buildId,
      load: () => Promise.resolve({ ...implementation, init }),
    })
    const before = host.enter({ initial: 1 }, 1)
    await Effect.runPromise(host.prefetch())
    expect(init).not.toHaveBeenCalled()
    expect(host.enter({ initial: 1 }, 1).model).toEqual(before.model)
    expect((await finish(host, before)).model._tag).toBe('Ready')
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('preserves the Model reference when an equivalent parent input is rebuilt', async () => {
    const host = makeHost()
    const ready = await finish(host, host.enter({ initial: 2 }, 1))
    expect(host.reflectInput(ready.model, { initial: 2 })).toBe(ready.model)
    const saved = host.update(
      ready.model,
      host.Message.GotChildMessage({
        instance: 1,
        buildId,
        message: ChildMessage.ClickedSave(),
      }),
      { initial: 2 },
    )
    expect(saved.model).toBe(ready.model)
    expect(saved.commands).toHaveLength(1)
  })

  it('revives parked state under a fresh instance and drops its old Command results', async () => {
    const host = makeHost()
    const parked = await finish(host, host.enter({ initial: 4 }, 1))
    const revived = await finish(
      host,
      host.enter({ initial: 2 }, 3, parked.model),
    )
    expect(revived.model).toMatchObject({
      _tag: 'Ready',
      instance: 3,
      model: { count: 6 },
    })
    expect(
      host.update(
        revived.model,
        host.Message.GotChildMessage({
          instance: 1,
          buildId,
          message: ChildMessage.CompletedSave({ count: 0 }),
        }),
      ).model,
    ).toBe(revived.model)
  })

  it('round trips state and requires explicit preparation in a fresh application before replay', async () => {
    const first = makeHost()
    const ready = await finish(first, first.enter({ initial: 7 }, 1))
    const encoded = Schema.encodeSync(first.Model)(ready.model)
    const fresh = makeHost()
    const restored = Schema.decodeSync(fresh.Model)(encoded)
    const message = fresh.Message.GotChildMessage({
      instance: 1,
      buildId,
      message: ChildMessage.ClickedIncrement(),
    })
    expect(() => fresh.update(restored, message)).toThrow('not prepared')
    await Effect.runPromise(fresh.prepare(restored))
    expect(fresh.update(restored, message).model).toMatchObject({
      model: { count: 8 },
    })
    const otherBuild = lazy(Counter, {
      buildId: 'different',
      load: () => Promise.resolve(implementation),
    })
    await expect(
      Effect.runPromise(otherBuild.prepare(restored)),
    ).rejects.toThrow('expected different')
  })
  it('prepares only admitted state and resumes interrupted preparation through a Command', async () => {
    const load = vi.fn(() => Promise.resolve(implementation))
    const host = lazy(Counter, { buildId, load })
    const pending = host.enter({ initial: 8 }, 4)
    const failed = host.update(
      pending.model,
      host.Message.FailedPrepare({
        instance: 4,
        attempt: 0,
        buildId,
        reason: 'offline',
      }),
    )
    await Effect.runPromise(host.prepare(pending.model))
    await Effect.runPromise(host.prepare(failed.model))
    expect(load).not.toHaveBeenCalled()
    expect(host.resume(failed.model)).toEqual({ model: failed.model })
    const resumed = host.resume(pending.model)
    expect(resumed.model).toBe(pending.model)
    const ready = await finish(host, resumed)
    expect(ready.model).toMatchObject({
      _tag: 'Ready',
      instance: 4,
      model: { count: 8 },
    })
    expect(host.resume(ready.model)).toEqual({ model: ready.model })
  })

  it('exposes speculative download failures through the typed Effect error channel', async () => {
    const host = lazy(Counter, {
      buildId,
      load: () => Promise.reject(new Error('offline')),
    })
    const recovered = await Effect.runPromise(
      host
        .prefetch()
        .pipe(Effect.catch(error => Effect.succeed(error.moduleId))),
    )
    expect(recovered).toBe('Counter')
  })
})
