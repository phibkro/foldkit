import { Context, Effect, Option, Schema, Stream } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'

import * as Command from '../command/index.js'
import type { HtmlBuilder } from '../html/index.js'
import { defineView } from '../html/submodel.js'
import { defineMessageUnion } from '../message/index.js'
import * as Scene from '../scene/public.js'
import { modifyFields } from '../struct/index.js'
import * as Subscription from '../subscription/subscription.js'
import * as Update from '../update/index.js'
import { bind, define } from './composition.js'
import { contract, implement, lazy } from './module.js'

const CounterModel = Schema.Struct({ count: Schema.Number })
const CounterMessage = defineMessageUnion({
  ClickedIncrement: {},
  ClickedSave: {},
  CompletedSave: { count: Schema.Number },
})
const CounterOutMessage = defineMessageUnion({
  ReportedCount: { count: Schema.Number },
})
const Save = Command.define('Save', {
  args: { count: Schema.Number },
  messages: [CounterMessage.CompletedSave],
  execute: ({ count }) =>
    Effect.succeed(CounterMessage.CompletedSave({ count })),
})
type CounterReturn = Update.ReturnWithOutMessage<
  typeof CounterModel.Type,
  typeof CounterMessage.Type,
  typeof CounterOutMessage.Type
>
const counterInit = (initial: number): CounterReturn => ({
  model: { count: initial },
  commands: [Save({ count: initial })],
  outMessage: CounterOutMessage.ReportedCount({ count: initial }),
})
const counterUpdate = (
  model: typeof CounterModel.Type,
  message: typeof CounterMessage.Type,
): CounterReturn =>
  CounterMessage.match<CounterReturn>(message, {
    ClickedIncrement: () => ({
      model: modifyFields(model, { count: count => count + 1 }),
      outMessage: CounterOutMessage.ReportedCount({ count: model.count + 1 }),
    }),
    ClickedSave: () => ({ model, commands: [Save({ count: model.count })] }),
    CompletedSave: ({ count }) => ({
      model: modifyFields(model, { count: () => count }),
    }),
  })
const Counter = define({
  Model: CounterModel,
  Message: CounterMessage,
  init: counterInit,
  update: counterUpdate,
  view: (model, h) =>
    h.button(
      [h.OnClick(CounterMessage.ClickedIncrement())],
      [String(model.count)],
    ),
  subscriptions: Subscription.make<
    typeof CounterModel.Type,
    typeof CounterMessage.Type
  >()(entry => ({
    ticks: entry(
      { count: Schema.Number },
      {
        modelToDependencies: model => ({ count: model.count }),
        dependenciesToStream: ({ count }) =>
          Stream.make(CounterMessage.CompletedSave({ count })),
      },
    ),
  })),
})
const ParentModel = Schema.Struct({
  counter: Schema.Option(Counter.Model),
  reported: Schema.Number,
})
type ParentModel = typeof ParentModel.Type
const ParentMessage = defineMessageUnion({
  GotCounterMessage: { message: Counter.Message },
})
type ParentMessage = typeof ParentMessage.Type
const relationship = {
  name: 'counter',
  read: (model: ParentModel) => model.counter,
  write: (model: ParentModel, nextCounter: typeof CounterModel.Type) =>
    modifyFields(model, { counter: () => Option.some(nextCounter) }),
  toParentMessage: (message: typeof CounterMessage.Type): ParentMessage =>
    ParentMessage.GotCounterMessage({ message }),
}
const foldCounterOutMessage = CounterOutMessage.match<
  Update.Step<ParentModel, ParentMessage>
>({
  ReportedCount:
    ({ count }) =>
    model => ({
      model: modifyFields(model, { reported: () => count }),
    }),
})
const makeCounter = () =>
  bind(Counter, { ...relationship, foldOutMessage: foldCounterOutMessage })
const emptyParent = (): ParentModel => ({ counter: Option.none(), reported: 0 })

class StoredCount extends Context.Service<
  StoredCount,
  { readonly value: number }
>()('StoredCount') {}
const ReadStoredCount = Command.define('ReadStoredCount', {
  messages: [CounterMessage.CompletedSave],
  execute: Effect.map(StoredCount, ({ value }) =>
    CounterMessage.CompletedSave({ count: value }),
  ),
})

describe('Submodel composition', () => {
  it('initializes synchronously and folds init/update OutMessages after writing the child', async () => {
    const counter = makeCounter()
    const initialized = counter.init(
      counter => ({ counter: Option.some(counter), reported: 0 }),
      4,
    )
    expect(initialized.model).toEqual({
      counter: Option.some({ count: 4 }),
      reported: 4,
    })
    expect(await Effect.runPromise(initialized.commands![0]!.effect)).toEqual(
      ParentMessage.GotCounterMessage({
        message: CounterMessage.CompletedSave({ count: 4 }),
      }),
    )
    const incremented = counter.update(
      initialized.model,
      CounterMessage.ClickedIncrement(),
    )
    expect(incremented.model).toEqual({
      counter: Option.some({ count: 5 }),
      reported: 5,
    })
    expectTypeOf(incremented).toExtend<
      Update.Return<ParentModel, ParentMessage>
    >()
  })

  it('preserves the parent reference and skips effects for an absent child', () => {
    const counter = makeCounter()
    const model = emptyParent()
    expect(counter.update(model, CounterMessage.ClickedSave())).toEqual({
      model,
    })
    expect(counter.update(model, CounterMessage.ClickedIncrement()).model).toBe(
      model,
    )
    expect(counter.subscriptions(model)).toEqual({})
  })

  it('routes child Commands through the shared parent wrapper', async () => {
    const counter = makeCounter()
    const initialized = counter.enter(emptyParent(), 7)
    const saved = counter.update(
      initialized.model,
      CounterMessage.ClickedSave(),
    )
    const message = await Effect.runPromise(saved.commands![0]!.effect)
    expectTypeOf(message).toEqualTypeOf<ParentMessage>()
    expect(message).toEqual(
      ParentMessage.GotCounterMessage({
        message: CounterMessage.CompletedSave({ count: 7 }),
      }),
    )
  })

  it('reuses lifted entries across model changes and namespaces separate child bindings', async () => {
    const counter = makeCounter()
    const model = counter.enter(emptyParent(), 3).model
    const subscriptions = counter.subscriptions(model)
    const incremented = counter.update(
      model,
      CounterMessage.ClickedIncrement(),
    ).model
    expect(counter.subscriptions(incremented)).toBe(subscriptions)
    const ticks = Object.values(subscriptions)[0]!
    const dependencies = ticks.modelToDependencies(incremented)
    expect(
      await Effect.runPromise(
        Stream.runCollect(
          ticks.dependenciesToStream(dependencies, () => dependencies),
        ),
      ),
    ).toEqual([
      ParentMessage.GotCounterMessage({
        message: CounterMessage.CompletedSave({ count: 4 }),
      }),
    ])
    const sibling = bind(Counter, {
      ...relationship,
      name: 'sibling',
      foldOutMessage: foldCounterOutMessage,
    })
    const siblingSubscriptions = sibling.subscriptions(model)
    expect(
      Object.values(
        Subscription.aggregate(subscriptions, siblingSubscriptions),
      ),
    ).toEqual([ticks, Object.values(siblingSubscriptions)[0]])
    expect(counter.subscriptions(model)).toBe(subscriptions)
  })

  it('renders the bound view and dispatches child clicks through the parent update', () => {
    const counter = makeCounter()
    Scene.scene(
      {
        update: (model: ParentModel, message: ParentMessage) =>
          ParentMessage.match<Update.Return<ParentModel, ParentMessage>>(
            message,
            {
              GotCounterMessage: ({ message }) =>
                counter.update(model, message),
            },
          ),
        view: (model, h) => counter.view(model, h),
      },
      Scene.given(counter.enter(emptyParent(), 2).model),
      Scene.click(Scene.role('button', { name: '2' })),
      Scene.expect(Scene.role('button', { name: '3' })).toExist(),
    )
  })

  it('supports viewless children with typed initialization and per-dispatch arguments', () => {
    const Value = define({
      Model: Schema.Number,
      Message: Schema.Number,
      init: (initial: number) => ({ model: initial }),
      update: (model, message, multiplier: number) => ({
        model: model + message * multiplier,
      }),
    })
    const value = bind(Value, {
      name: 'value',
      read: (model: number) => Option.some(model),
      write: (_model, nextValue) => nextValue,
      toParentMessage: message => message,
    })
    expect(value.init(nextValue => nextValue, 2).model).toBe(2)
    expect(value.update(2, 3, 4).model).toBe(14)
    expectTypeOf(value.update).parameters.toEqualTypeOf<
      [model: number, message: number, multiplier: number]
    >()
    expectTypeOf(Value.Message).toEqualTypeOf<typeof Schema.Number>()
  })

  it('requires a parent handler for child OutMessages', () => {
    // @ts-expect-error A child OutMessage cannot be silently discarded.
    bind(Counter, relationship)
  })

  it('rejects a third-argument view whose inputs have the no-input arity', () => {
    const invalid = {
      Model: Schema.Number,
      Message: Schema.Number,
      init: () => ({ model: 0 }),
      update: (model: number) => ({ model }),
      view: (_model: number, _inputs: void, _h: HtmlBuilder<number>) => null,
    }
    // @ts-expect-error A view without inputs takes its builder as the second argument.
    define(invalid)
  })

  it('rejects restoration hooks that return replacement Models', () => {
    const invalid = {
      Model: Schema.Number,
      Message: Schema.Number,
      init: () => ({ model: 0 }),
      update: (model: number) => ({ model }),
      resumeModel: (model: number) => ({ model: model + 1 }),
    }
    // @ts-expect-error Restoration hooks return Commands, never a replacement Model.
    define(invalid)
  })

  it('preserves required view inputs and parent-owned slot callback routing', () => {
    const WithSlot = define({
      ...Counter,
      view: defineView<
        typeof CounterModel.Type,
        typeof CounterMessage.Type,
        { readonly toView: () => ReturnType<NonNullable<typeof Counter.view>> }
      >((_model, { toView }) => toView()),
    })
    const counter = bind(WithSlot, {
      ...relationship,
      foldOutMessage: foldCounterOutMessage,
    })
    Scene.scene(
      {
        update: (model: ParentModel, message: ParentMessage) =>
          ParentMessage.match<Update.Return<ParentModel, ParentMessage>>(
            message,
            {
              GotCounterMessage: ({ message }) =>
                counter.update(model, message),
            },
          ),
        view: (model, h) =>
          counter.view(model, h, {
            viewInputs: {
              toView: () =>
                h.button(
                  [
                    h.OnClick(
                      ParentMessage.GotCounterMessage({
                        message: CounterMessage.ClickedIncrement(),
                      }),
                    ),
                  ],
                  [String(model.reported)],
                ),
            },
          }),
      },
      Scene.given(counter.enter(emptyParent(), 2).model),
      Scene.click(Scene.role('button', { name: '2' })),
      Scene.expect(Scene.role('button', { name: '3' })).toExist(),
    )
  })

  it('lifts preparation and restored Commands only for a present child', async () => {
    const prepared: Array<number> = []
    const Restorable = define({
      ...Counter,
      prepareModel: (model: typeof CounterModel.Type) =>
        Effect.sync(() => {
          prepared.push(model.count)
        }),
      resumeModel: (model: typeof CounterModel.Type) => [
        Save({ count: model.count }),
      ],
    })
    const counter = bind(Restorable, {
      ...relationship,
      foldOutMessage: foldCounterOutMessage,
    })
    await Effect.runPromise(counter.prepareModel(emptyParent()))
    expect(prepared).toEqual([])
    expect(counter.resumeModel(emptyParent())).toEqual([])
    const model = counter.enter(emptyParent(), 9).model
    await Effect.runPromise(counter.prepareModel(model))
    expect(prepared).toEqual([9])
    expect(
      await Effect.runPromise(counter.resumeModel(model)[0]!.effect),
    ).toEqual(
      ParentMessage.GotCounterMessage({
        message: CounterMessage.CompletedSave({ count: 9 }),
      }),
    )
  })

  it('preserves Command service requirements and parent OutMessages from an OutMessage fold', async () => {
    const ParentOutMessage = defineMessageUnion({
      UpdatedCounter: { count: Schema.Number },
    })
    const counter = bind(Counter, {
      ...relationship,
      foldOutMessage: (
        outMessage: typeof CounterOutMessage.Type,
        {
          liftCommand,
        }: Update.FoldContext<typeof CounterMessage.Type, ParentMessage>,
      ) =>
        CounterOutMessage.match<
          Update.StepWithOutMessage<
            ParentModel,
            ParentMessage,
            typeof ParentOutMessage.Type,
            StoredCount
          >
        >(outMessage, {
          ReportedCount:
            ({ count }) =>
            model => ({
              model,
              commands: [liftCommand(ReadStoredCount())],
              outMessage: ParentOutMessage.UpdatedCounter({ count }),
            }),
        }),
    })
    const initialized = counter.init(
      counter => ({ counter: Option.some(counter), reported: 0 }),
      5,
    )
    expectTypeOf(initialized).toExtend<
      Update.ReturnWithOutMessage<
        ParentModel,
        ParentMessage,
        typeof ParentOutMessage.Type,
        StoredCount
      >
    >()
    const completed = await Effect.runPromise(
      initialized.commands![1]!.effect.pipe(
        Effect.provideService(StoredCount, { value: 12 }),
      ),
    )
    expect(completed).toEqual(
      ParentMessage.GotCounterMessage({
        message: CounterMessage.CompletedSave({ count: 12 }),
      }),
    )
    expect(initialized.outMessage).toEqual(
      ParentOutMessage.UpdatedCounter({ count: 5 }),
    )
    const updated = counter.update(
      initialized.model,
      CounterMessage.ClickedIncrement(),
    )
    expect(updated.outMessage).toEqual(
      ParentOutMessage.UpdatedCounter({ count: 6 }),
    )
  })

  it('uses the same binding for a lazy child and admits it only through its preparation Message', async () => {
    const descriptor = contract('Counter', {
      Model: CounterModel,
      Message: CounterMessage,
      Input: Schema.Number,
      OutMessage: CounterOutMessage,
    })
    const implementation = implement(descriptor, {
      init: counterInit,
      update: counterUpdate,
      view: defineView<
        typeof CounterModel.Type,
        typeof CounterMessage.Type,
        { readonly input: number }
      >((model, _input, h) =>
        h.button(
          [h.OnClick(CounterMessage.ClickedIncrement())],
          [String(model.count)],
        ),
      ),
    })
    const host = lazy(descriptor, {
      buildId: 'build',
      load: () => Promise.resolve(implementation),
    })
    type HostModel = typeof host.Model.Type
    type HostMessage = typeof host.Message.Type
    const child = bind(host, {
      name: 'lazyCounter',
      read: (model: HostModel) => Option.some(model),
      write: (_model, nextCounter) => nextCounter,
      toParentMessage: (message: HostMessage) => message,
      foldOutMessage: CounterOutMessage.match<
        Update.Step<HostModel, HostMessage>
      >({ ReportedCount: () => model => ({ model }) }),
    })
    const started = child.init(nextCounter => nextCounter, 8, 1)
    expect(started.model._tag).toBe('Loading')
    expect(child.subscriptions(started.model)).toEqual({})
    await Effect.runPromise(child.prepareModel(started.model))
    const completion = await Effect.runPromise(
      child.resumeModel(started.model)[0]!.effect,
    )
    const admitted = child.update(started.model, completion)
    expect(admitted.model).toMatchObject({ _tag: 'Ready', model: { count: 8 } })
  })
})
