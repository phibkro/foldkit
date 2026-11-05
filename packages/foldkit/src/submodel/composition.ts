import { Effect, Option, Schema } from 'effect'

import * as Command from '../command/index.js'
import type { HtmlBuilder } from '../html/index.js'
import { type SubmodelView, defineView } from '../html/submodel.js'
import * as Subscription from '../subscription/subscription.js'
import * as Update from '../update/index.js'
import type { VNode } from '../vdom.js'

// NOTE: bind checks conditional view-input arity at its public interface.
// TypeScript cannot narrow that conditional when assembling the embed config.
const renderBoundView = <ParentMessage>(
  h: HtmlBuilder<ParentMessage>,
  config: any,
) => h.submodel(config)

/** A child state machine, independent of the parent that embeds it. */
export type Definition<
  ModelSchema extends Schema.Top,
  MessageSchema extends Schema.Top,
  InitArgs extends ReadonlyArray<unknown>,
  UpdateArgs extends ReadonlyArray<unknown>,
  OutMessage = never,
  InitRequirements = never,
  UpdateRequirements = never,
  ViewInputs = void,
  SubscriptionRequirements = never,
  PreparationRequirements = never,
  ResumeRequirements = never,
> = Readonly<{
  Model: ModelSchema
  Message: MessageSchema
  init: (
    ...args: InitArgs
  ) => Update.ReturnWithOutMessage<
    ModelSchema['Type'],
    MessageSchema['Type'],
    OutMessage,
    InitRequirements
  >
  update: (
    model: ModelSchema['Type'],
    message: MessageSchema['Type'],
    ...args: UpdateArgs
  ) => Update.ReturnWithOutMessage<
    ModelSchema['Type'],
    MessageSchema['Type'],
    OutMessage,
    UpdateRequirements
  >
  view?: SubmodelView<ModelSchema['Type'], MessageSchema['Type'], ViewInputs>
  subscriptions?:
    | Subscription.Subscriptions<
        ModelSchema['Type'],
        MessageSchema['Type'],
        SubscriptionRequirements
      >
    | ((
        model: ModelSchema['Type'],
      ) => Subscription.Subscriptions<
        ModelSchema['Type'],
        MessageSchema['Type'],
        SubscriptionRequirements
      >)
  prepareModel?: (
    model: ModelSchema['Type'],
  ) => Effect.Effect<void, never, PreparationRequirements>
  resumeModel?: (
    model: ModelSchema['Type'],
  ) => ReadonlyArray<
    Command.Command<MessageSchema['Type'], never, ResumeRequirements>
  >
}>

/** Defines a synchronous Submodel from its schemas and executable exports.
 * Views and Subscriptions are optional. Initialization and update retain their
 * argument lists; no preparation state or asynchronous work is introduced.
 */
export function define<
  ModelSchema extends Schema.Top,
  MessageSchema extends Schema.Top,
  InitArgs extends ReadonlyArray<unknown>,
  UpdateArgs extends ReadonlyArray<unknown>,
  OutMessage = never,
  InitRequirements = never,
  UpdateRequirements = never,
  SubscriptionRequirements = never,
  PreparationRequirements = never,
  ResumeRequirements = never,
>(
  definition: Omit<
    Definition<
      ModelSchema,
      MessageSchema,
      InitArgs,
      UpdateArgs,
      OutMessage,
      InitRequirements,
      UpdateRequirements,
      void,
      SubscriptionRequirements,
      PreparationRequirements,
      ResumeRequirements
    >,
    'view'
  > &
    Readonly<{
      view: (
        model: ModelSchema['Type'],
        h: HtmlBuilder<MessageSchema['Type']>,
      ) => VNode | null
    }>,
): Definition<
  ModelSchema,
  MessageSchema,
  InitArgs,
  UpdateArgs,
  OutMessage,
  InitRequirements,
  UpdateRequirements,
  void,
  SubscriptionRequirements,
  PreparationRequirements,
  ResumeRequirements
> &
  Readonly<{
    view: SubmodelView<ModelSchema['Type'], MessageSchema['Type'], void>
  }>
export function define<
  ModelSchema extends Schema.Top,
  MessageSchema extends Schema.Top,
  InitArgs extends ReadonlyArray<unknown>,
  UpdateArgs extends ReadonlyArray<unknown>,
  ViewInputs,
  OutMessage = never,
  InitRequirements = never,
  UpdateRequirements = never,
  SubscriptionRequirements = never,
  PreparationRequirements = never,
  ResumeRequirements = never,
>(
  definition: Omit<
    Definition<
      ModelSchema,
      MessageSchema,
      InitArgs,
      UpdateArgs,
      OutMessage,
      InitRequirements,
      UpdateRequirements,
      ViewInputs,
      SubscriptionRequirements,
      PreparationRequirements,
      ResumeRequirements
    >,
    'view'
  > &
    Readonly<{
      view: ((
        model: ModelSchema['Type'],
        viewInputs: ViewInputs,
        h: HtmlBuilder<MessageSchema['Type']>,
      ) => VNode | null) &
        ([ViewInputs] extends [void] ? never : unknown)
    }>,
): Definition<
  ModelSchema,
  MessageSchema,
  InitArgs,
  UpdateArgs,
  OutMessage,
  InitRequirements,
  UpdateRequirements,
  ViewInputs,
  SubscriptionRequirements,
  PreparationRequirements,
  ResumeRequirements
> &
  Readonly<{
    view: SubmodelView<ModelSchema['Type'], MessageSchema['Type'], ViewInputs>
  }>
export function define<
  ModelSchema extends Schema.Top,
  MessageSchema extends Schema.Top,
  InitArgs extends ReadonlyArray<unknown>,
  UpdateArgs extends ReadonlyArray<unknown>,
  OutMessage = never,
  InitRequirements = never,
  UpdateRequirements = never,
  SubscriptionRequirements = never,
  PreparationRequirements = never,
  ResumeRequirements = never,
>(
  definition: Omit<
    Definition<
      ModelSchema,
      MessageSchema,
      InitArgs,
      UpdateArgs,
      OutMessage,
      InitRequirements,
      UpdateRequirements,
      void,
      SubscriptionRequirements,
      PreparationRequirements,
      ResumeRequirements
    >,
    'view'
  > &
    Readonly<{
      view?: (
        model: ModelSchema['Type'],
        h: HtmlBuilder<MessageSchema['Type']>,
      ) => VNode | null
    }>,
): Definition<
  ModelSchema,
  MessageSchema,
  InitArgs,
  UpdateArgs,
  OutMessage,
  InitRequirements,
  UpdateRequirements,
  void,
  SubscriptionRequirements,
  PreparationRequirements,
  ResumeRequirements
>
export function define(definition: any) {
  const { view, ...stateMachine } = definition
  return view === undefined
    ? stateMachine
    : { ...stateMachine, view: defineView(view) }
}

type OutMessageFold<
  ParentModel,
  ParentMessage,
  ChildMessage,
  OutMessage,
  ParentOutMessage,
  OutMessageRequirements,
> = [OutMessage] extends [never]
  ? Readonly<{ foldOutMessage?: never }>
  : Readonly<{
      foldOutMessage: (
        outMessage: OutMessage,
        context: Update.FoldContext<ChildMessage, ParentMessage>,
      ) => Update.StepWithOutMessage<
        ParentModel,
        ParentMessage,
        ParentOutMessage,
        OutMessageRequirements
      >
    }>

/** Binds one child lifetime to a parent's state and Message routing.
 * `name` namespaces its
 * Subscription entries and supplies the default view slot. Return None from
 * `read` while the child is absent. The binding shares this relationship across
 * initialization, update, rendering, and Subscription lifting.
 */
export const bind = <
  ModelSchema extends Schema.Top,
  MessageSchema extends Schema.Top,
  InitArgs extends ReadonlyArray<unknown>,
  UpdateArgs extends ReadonlyArray<unknown>,
  OutMessage,
  InitRequirements,
  UpdateRequirements,
  ViewInputs,
  SubscriptionRequirements,
  PreparationRequirements,
  ResumeRequirements,
  ParentModel,
  ParentMessage,
  ParentOutMessage = never,
  OutMessageRequirements = never,
>(
  child: Definition<
    ModelSchema,
    MessageSchema,
    InitArgs,
    UpdateArgs,
    OutMessage,
    InitRequirements,
    UpdateRequirements,
    ViewInputs,
    SubscriptionRequirements,
    PreparationRequirements,
    ResumeRequirements
  >,
  config: Readonly<{
    name: string
    read: (model: ParentModel) => Option.Option<ModelSchema['Type']>
    write: (model: ParentModel, nextChild: ModelSchema['Type']) => ParentModel
    toParentMessage: (message: MessageSchema['Type']) => ParentMessage
  }> &
    OutMessageFold<
      ParentModel,
      ParentMessage,
      MessageSchema['Type'],
      OutMessage,
      ParentOutMessage,
      OutMessageRequirements
    >,
) => {
  type ChildModel = ModelSchema['Type']
  type ChildMessage = MessageSchema['Type']
  type ChildSubscriptions = Subscription.Subscriptions<
    ChildModel,
    ChildMessage,
    SubscriptionRequirements
  >
  type ParentSubscriptions = Subscription.Subscriptions<
    ParentModel,
    ParentMessage,
    SubscriptionRequirements
  >
  const emptySubscriptions: ParentSubscriptions = {}
  const liftedSubscriptions = new WeakMap<
    ChildSubscriptions,
    ParentSubscriptions
  >()
  const liftSubscriptions = (subscriptions: ChildSubscriptions) => {
    const existing = liftedSubscriptions.get(subscriptions)
    if (existing) {
      return existing
    }
    const lifted = Subscription.lift(subscriptions)({
      read: config.read,
      toParentMessage: config.toParentMessage,
    })
    const namespaced = Object.fromEntries(
      Object.entries(lifted).map(([name, entry]) => [
        JSON.stringify([config.name, name]),
        entry,
      ]),
    )
    liftedSubscriptions.set(subscriptions, namespaced)
    return namespaced
  }
  const foldOutMessage = (
    outMessage: OutMessage,
    context: Update.FoldContext<ChildMessage, ParentMessage>,
  ): Update.StepWithOutMessage<
    ParentModel,
    ParentMessage,
    ParentOutMessage,
    OutMessageRequirements
  > => {
    if (config.foldOutMessage) {
      return config.foldOutMessage(outMessage, context)
    }
    return model => ({ model })
  }

  return {
    init: (
      toParentModel: (nextChild: ChildModel) => ParentModel,
      ...args: InitArgs
    ) =>
      Update.foldChildInit(child.init(...args), {
        toParentModel,
        toParentMessage: config.toParentMessage,
        foldOutMessage,
      }),
    enter: (model: ParentModel, ...args: InitArgs) =>
      Update.foldChildInit(child.init(...args), {
        toParentModel: nextChild => config.write(model, nextChild),
        toParentMessage: config.toParentMessage,
        foldOutMessage,
      }),
    update: (model: ParentModel, message: ChildMessage, ...args: UpdateArgs) =>
      Update.foldChild({
        read: config.read,
        write: config.write,
        toParentMessage: config.toParentMessage,
        update: (childModel: ChildModel, childMessage: ChildMessage) =>
          child.update(childModel, childMessage, ...args),
        foldOutMessage,
      })(model, message),
    view: <ViewMessage>(
      model: ParentModel,
      h: HtmlBuilder<ViewMessage> &
        ([ParentMessage] extends [ViewMessage] ? unknown : never),
      ...args: [ViewInputs] extends [void]
        ? [options?: Readonly<{ slotId?: string }>]
        : [options: Readonly<{ slotId?: string; viewInputs: ViewInputs }>]
    ) => {
      const maybeChild = config.read(model)
      if (Option.isNone(maybeChild) || child.view === undefined) {
        return null
      }
      const options = args[0]
      return renderBoundView(h, {
        slotId: options?.slotId ?? config.name,
        model: maybeChild.value,
        view: child.view,
        toParentMessage: config.toParentMessage,
        ...(options && 'viewInputs' in options
          ? { viewInputs: options.viewInputs }
          : {}),
      })
    },
    subscriptions: (model: ParentModel): ParentSubscriptions => {
      const maybeChild = config.read(model)
      if (Option.isNone(maybeChild) || child.subscriptions === undefined) {
        return emptySubscriptions
      }
      return liftSubscriptions(
        typeof child.subscriptions === 'function'
          ? child.subscriptions(maybeChild.value)
          : child.subscriptions,
      )
    },
    prepareModel: (model: ParentModel) =>
      Option.match(config.read(model), {
        onNone: () => Effect.void,
        onSome: childModel => child.prepareModel?.(childModel) ?? Effect.void,
      }),
    resumeModel: (model: ParentModel) =>
      Command.mapMessages(
        Option.match(config.read(model), {
          onNone: () => [],
          onSome: childModel => child.resumeModel?.(childModel) ?? [],
        }),
        config.toParentMessage,
      ),
  }
}
