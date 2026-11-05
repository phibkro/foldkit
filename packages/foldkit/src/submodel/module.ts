import { Effect, Option, Schema, Stream } from 'effect'

import * as Command from '../command/index.js'
import { type SubmodelView, defineView } from '../html/submodel.js'
import { defineMessageUnion } from '../message/index.js'
import { taggedStruct } from '../schema/index.js'
import * as Subscription from '../subscription/subscription.js'
import type * as Update from '../update/index.js'
import { createModuleLoader } from './moduleLoader.js'

/** An expected module download or preparation failure. */
export class LoadError extends Schema.TaggedError<LoadError>()(
  'Foldkit/Submodel/LoadError',
  { moduleId: Schema.String, reason: Schema.String },
) {}

const protocol = <
  Model,
  ModelEncoded,
  Message,
  MessageEncoded,
  Input,
  InputEncoded,
>(
  schemas: Readonly<{
    Model: Schema.Codec<Model, ModelEncoded>
    Message: Schema.Codec<Message, MessageEncoded, unknown, unknown>
    Input: Schema.Codec<Input, InputEncoded>
  }>,
) => {
  const identity = {
    instance: Schema.Number,
    attempt: Schema.Number,
    buildId: Schema.String,
  }
  const pending = {
    ...identity,
    input: schemas.Input,
    previous: Schema.Option(schemas.Model),
  }
  // Generic schema factories use taggedStruct because their members are assembled here.
  const Loading = taggedStruct('Loading', pending)
  const Failed = taggedStruct('Failed', { ...pending, reason: Schema.String })
  const Ready = taggedStruct('Ready', {
    ...identity,
    input: schemas.Input,
    model: schemas.Model,
  })
  const Model = Schema.Union([Loading, Failed, Ready])
  const Message = defineMessageUnion({
    CompletedPrepare: identity,
    FailedPrepare: { ...identity, reason: Schema.String },
    ClickedRetry: {},
    GotChildMessage: {
      instance: Schema.Number,
      buildId: Schema.String,
      message: schemas.Message,
    },
  })
  return { Model, Message, Loading, Failed, Ready }
}

/** Eager schemas shared by an implementation and its host. */
export interface Contract<
  Id extends string,
  Model,
  ModelEncoded,
  Message,
  MessageEncoded,
  Input,
  InputEncoded,
  OutMessage,
  OutMessageEncoded,
> {
  readonly id: Id
  readonly Model: Schema.Codec<Model, ModelEncoded>
  readonly Message: Schema.Codec<Message, MessageEncoded, unknown, unknown>
  readonly Input: Schema.Codec<Input, InputEncoded>
  readonly OutMessage: Schema.Codec<OutMessage, OutMessageEncoded>
  readonly host: ReturnType<
    typeof protocol<
      Model,
      ModelEncoded,
      Message,
      MessageEncoded,
      Input,
      InputEncoded
    >
  >
}

export const contract = <
  const Id extends string,
  Model,
  ModelEncoded,
  Message,
  MessageEncoded,
  Input,
  InputEncoded,
  OutMessage,
  OutMessageEncoded,
>(
  id: Id,
  schemas: Readonly<{
    Model: Schema.Codec<Model, ModelEncoded>
    Message: Schema.Codec<Message, MessageEncoded, unknown, unknown>
    Input: Schema.Codec<Input, InputEncoded>
    OutMessage: Schema.Codec<OutMessage, OutMessageEncoded>
  }>,
): Contract<
  Id,
  Model,
  ModelEncoded,
  Message,
  MessageEncoded,
  Input,
  InputEncoded,
  OutMessage,
  OutMessageEncoded
> => ({ id, ...schemas, host: protocol(schemas) })

/** The executable child module. Input is supplied by the parent; it is never captured from a previous instance. */
export interface Implementation<
  Model,
  Message,
  Input,
  OutMessage,
  Resources = never,
> {
  readonly init: (
    input: Input,
  ) => Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources>
  readonly update: (
    model: Model,
    message: Message,
    input: Input,
  ) => Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources>
  readonly view: SubmodelView<Model, Message, { readonly input: Input }>
  readonly subscriptions?: Subscription.Subscriptions<
    { readonly model: Model; readonly input: Input },
    Message,
    Resources
  >
  readonly revive?: (
    model: Model,
    input: Input,
  ) => Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources>
}

/** Checks the entire executable module against its eager contract. */
export const implement = <
  Id extends string,
  Model,
  ModelEncoded,
  Message,
  MessageEncoded,
  Input,
  InputEncoded,
  OutMessage,
  OutMessageEncoded,
  Resources = never,
>(
  _contract: Contract<
    Id,
    Model,
    ModelEncoded,
    Message,
    MessageEncoded,
    Input,
    InputEncoded,
    OutMessage,
    OutMessageEncoded
  >,
  implementation: Implementation<Model, Message, Input, OutMessage, Resources>,
) => implementation

/**
 * Creates one application-owned lazy host. Construct a new host for each SSR
 * request or application. Its code cache is immutable within one build.
 *
 * enter and retry always return a preparation Command, even for warm modules.
 * Only a matching completion admits execution. Before restoring or replaying a
 * Ready Model in a fresh host, await prepare(model). No functions enter state.
 */
export const lazy = <
  Id extends string,
  ChildModel,
  ModelEncoded,
  ChildMessage,
  MessageEncoded,
  Input,
  InputEncoded,
  OutMessage,
  OutMessageEncoded,
  Resources = never,
  Module extends Implementation<
    ChildModel,
    ChildMessage,
    Input,
    OutMessage,
    Resources
  > = Implementation<ChildModel, ChildMessage, Input, OutMessage, Resources>,
>(
  child: Contract<
    Id,
    ChildModel,
    ModelEncoded,
    ChildMessage,
    MessageEncoded,
    Input,
    InputEncoded,
    OutMessage,
    OutMessageEncoded
  >,
  options: Readonly<{
    buildId: string
    load: () => Promise<
      Module &
        Implementation<ChildModel, ChildMessage, Input, OutMessage, Resources>
    >
  }>,
) => {
  const { Model, Message, Loading, Failed, Ready } = child.host
  type Model = typeof Model.Type
  type Message = typeof Message.Type
  const identity = {
    instance: Schema.Number,
    attempt: Schema.Number,
    buildId: Schema.String,
  }
  type Return = Update.ReturnWithOutMessage<
    Model,
    Message,
    OutMessage,
    Resources
  >
  const emptySubscriptions: Subscription.Subscriptions<
    Model,
    Message,
    Resources
  > = {}
  const inputEquivalent = Schema.toEquivalence(child.Input)

  const wrap =
    (instance: number) =>
    (message: ChildMessage): Message =>
      Message.GotChildMessage({ instance, buildId: options.buildId, message })

  const prepared = createModuleLoader(async () => {
    const implementation = await options.load()
    // Build the immutable subscription adapters during preparation, not update or render.
    const subscriptions = Subscription.make<Model, Message, Resources>()(
      entry =>
        Object.fromEntries(
          Object.entries(implementation.subscriptions ?? {}).map(
            ([name, inner]) => [
              name,
              entry(
                {
                  active: Schema.Option(
                    Schema.Struct({
                      instance: Schema.Number,
                      inner: inner.dependenciesSchema,
                    }),
                  ),
                },
                {
                  modelToDependencies: state => ({
                    active:
                      state._tag === 'Ready'
                        ? Option.some({
                            instance: state.instance,
                            inner: inner.modelToDependencies({
                              model: state.model,
                              input: state.input,
                            }),
                          })
                        : Option.none(),
                  }),
                  keepAliveEquivalence: (left, right) =>
                    Option.match(left.active, {
                      onNone: () => Option.isNone(right.active),
                      onSome: previous =>
                        Option.isSome(right.active) &&
                        previous.instance === right.active.value.instance &&
                        (
                          inner.keepAliveEquivalence ??
                          Schema.toEquivalence(inner.dependenciesSchema)
                        )(previous.inner, right.active.value.inner),
                    }),
                  dependenciesToStream: ({ active }, readLatest) =>
                    Option.match(active, {
                      onNone: () => Stream.empty,
                      onSome: ({ instance, inner: dependencies }) =>
                        Stream.map(
                          inner.dependenciesToStream(dependencies, () =>
                            Option.match(readLatest().active, {
                              onNone: () => dependencies,
                              onSome: current =>
                                current.instance === instance
                                  ? current.inner
                                  : dependencies,
                            }),
                          ),
                          wrap(instance),
                        ),
                    }),
                },
              ),
            ],
          ),
        ),
    )
    return { implementation, subscriptions }
  })

  const assertBuild = (state: Model) => {
    if (state.buildId !== options.buildId) {
      throw new Error(
        `Submodel ${child.id}: state belongs to build ${state.buildId}, expected ${options.buildId}`,
      )
    }
  }
  const Load = Command.define(`Prepare${child.id}`, {
    args: identity,
    messages: [Message.CompletedPrepare, Message.FailedPrepare],
    execute: stamp =>
      Effect.tryPromise({
        try: prepared.load,
        catch: cause => String(cause),
      }).pipe(
        Effect.as(Message.CompletedPrepare(stamp)),
        Effect.catch(reason =>
          Effect.succeed(Message.FailedPrepare({ ...stamp, reason })),
        ),
      ),
  })
  const start = (
    input: Input,
    instance: number,
    attempt: number,
    previous: Option.Option<ChildModel>,
  ): Return => ({
    model: Loading({
      input,
      instance,
      attempt,
      previous,
      buildId: options.buildId,
    }),
    commands: [Load({ instance, attempt, buildId: options.buildId })],
  })
  const commit = (
    state: Model,
    input: Input,
    step: Update.ReturnWithOutMessage<
      ChildModel,
      ChildMessage,
      OutMessage,
      Resources
    >,
  ): Return => ({
    model:
      state._tag === 'Ready' &&
      state.model === step.model &&
      inputEquivalent(state.input, input)
        ? state
        : Ready({
            instance: state.instance,
            attempt: state.attempt,
            buildId: state.buildId,
            input,
            model: step.model,
          }),
    commands: Command.mapMessages(step.commands ?? [], wrap(state.instance)),
    ...(step.outMessage === undefined ? {} : { outMessage: step.outMessage }),
  })
  const matches = (
    state: Model,
    stamp: {
      readonly instance: number
      readonly attempt: number
      readonly buildId: string
    },
  ) =>
    state.instance === stamp.instance &&
    state.attempt === stamp.attempt &&
    state.buildId === stamp.buildId

  const update = (
    state: Model,
    message: Message,
    input: Input = state.input,
  ): Return => {
    assertBuild(state)
    return Message.match<Return>(message, {
      ClickedRetry: () =>
        state._tag === 'Failed'
          ? start(input, state.instance, state.attempt + 1, state.previous)
          : { model: state },
      FailedPrepare: stamp =>
        state._tag === 'Loading' && matches(state, stamp)
          ? {
              model: Failed({
                instance: state.instance,
                attempt: state.attempt,
                buildId: state.buildId,
                previous: state.previous,
                input,
                reason: stamp.reason,
              }),
            }
          : { model: state },
      CompletedPrepare: stamp => {
        if (state._tag !== 'Loading' || !matches(state, stamp)) {
          return { model: state }
        }
        const implementation = prepared.require().implementation
        const step =
          Option.isSome(state.previous) && implementation.revive
            ? implementation.revive(state.previous.value, input)
            : implementation.init(input)
        return commit(state, input, step)
      },
      GotChildMessage: ({ instance, buildId, message: childMessage }) =>
        state._tag === 'Ready' &&
        state.instance === instance &&
        state.buildId === buildId
          ? commit(
              state,
              input,
              prepared
                .require()
                .implementation.update(state.model, childMessage, input),
            )
          : { model: state },
    })
  }

  const enter = (input: Input, instance: number, previous?: Model): Return => {
    if (previous) {
      assertBuild(previous)
    }
    return start(
      input,
      instance,
      0,
      previous?._tag === 'Ready' ? Option.some(previous.model) : Option.none(),
    )
  }

  const resume = (state: Model): Update.Return<Model, Message, Resources> => {
    assertBuild(state)
    return state._tag === 'Loading'
      ? {
          model: state,
          commands: [
            Load({
              instance: state.instance,
              attempt: state.attempt,
              buildId: state.buildId,
            }),
          ],
        }
      : { model: state }
  }

  const prepare = (state: Model) =>
    Effect.sync(() => assertBuild(state)).pipe(
      Effect.andThen(
        state._tag === 'Ready' ? Effect.promise(prepared.load) : Effect.void,
      ),
    )

  return {
    id: child.id,
    Model,
    Message,
    Prepare: Load,
    init: enter,
    enter,
    update,
    /** Reissues interrupted preparation without changing the host Model. */
    resume,
    /** Supplies preparation Commands to the runtime restoration hook. */
    resumeModel: (state: Model) => resume(state).commands ?? [],
    /** Reads admitted child data and extension metadata without exposing mutable code storage. */
    inspect: (state: Model) => {
      assertBuild(state)
      return state._tag === 'Ready'
        ? Option.some({
            model: state.model,
            implementation: prepared.require().implementation,
          })
        : Option.none()
    },
    /** Mirrors parent-owned input while loading; it does not initialize a child. */
    reflectInput: (state: Model, input: Input): Model => {
      assertBuild(state)
      return inputEquivalent(state.input, input) ? state : { ...state, input }
    },
    /** Warms code only; it cannot admit or initialize an active child. */
    prefetch: () =>
      Effect.tryPromise({
        try: prepared.load,
        catch: cause =>
          new LoadError({ moduleId: child.id, reason: String(cause) }),
      }),
    /** Loads admitted code before synchronous rendering or replay. */
    prepare,
    /** Supplies the runtime preparation barrier. */
    prepareModel: prepare,
    subscriptions: (state: Model) => {
      assertBuild(state)
      return state._tag === 'Ready'
        ? prepared.require().subscriptions
        : emptySubscriptions
    },
    view: defineView<Model, Message, { readonly input: Input }>(
      (state, { input }, h) => {
        assertBuild(state)
        if (state._tag === 'Loading') {
          return h.div([h.Role('status')], ['Loading…'])
        }
        if (state._tag === 'Failed') {
          return h.div(
            [h.Role('alert')],
            [
              'Unable to load this page. ',
              h.button([h.OnClick(Message.ClickedRetry())], ['Retry']),
            ],
          )
        }
        return h.submodel({
          slotId: `${child.id}:${state.instance}`,
          model: state.model,
          view: prepared.require().implementation.view,
          viewInputs: { input },
          toParentMessage: wrap(state.instance),
        })
      },
    ),
  }
}

/** The eager adapter follows exactly the same admission protocol as a lazy module. */
export const eager = <
  Id extends string,
  Model,
  ModelEncoded,
  Message,
  MessageEncoded,
  Input,
  InputEncoded,
  OutMessage,
  OutMessageEncoded,
  Resources = never,
>(
  child: Contract<
    Id,
    Model,
    ModelEncoded,
    Message,
    MessageEncoded,
    Input,
    InputEncoded,
    OutMessage,
    OutMessageEncoded
  >,
  options: Readonly<{
    buildId: string
    implementation: Implementation<Model, Message, Input, OutMessage, Resources>
  }>,
) =>
  lazy(child, {
    buildId: options.buildId,
    load: () => Promise.resolve(options.implementation),
  })
