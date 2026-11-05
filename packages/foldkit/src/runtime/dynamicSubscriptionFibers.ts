import {
  Cause,
  Effect,
  Fiber,
  Option,
  PubSub,
  Ref,
  Schema,
  Scope,
  Stream,
} from 'effect'

import type {
  Subscription,
  Subscriptions,
} from '../subscription/subscription.js'

/**
 * Reconciles the selected entries on every Model change. Each named entry keeps
 * its own dependency reference and fiber, so a change to one does not restart
 * its siblings. Removed/replaced entries finish cleanup before replacements run.
 */
export const forkDynamicSubscriptionFibers = <Model, Message, Services>(
  config: Readonly<{
    select: (model: Model) => Subscriptions<Model, Message, Services>
    staticSubscriptions: Subscriptions<Model, Message, Services>
    initModel: Model
    modelPubSub: PubSub.PubSub<Model>
    runtimeScope: Scope.Scope
    enqueueMessageEffect: (message: Message) => Effect.Effect<void>
    provideAllResources: <A>(
      effect: Effect.Effect<A, never, Services>,
    ) => Effect.Effect<A>
    crashWith: (
      cause: Cause.Cause<never>,
      message: Option.Option<Message>,
    ) => Effect.Effect<void>
  }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    type Entry = Subscription<Model, Message, unknown, Services>
    type Running = {
      readonly entry: Entry
      readonly latest: Ref.Ref<unknown>
      readonly equivalent: (left: unknown, right: unknown) => boolean
      readonly fiber: Fiber.Fiber<void>
    }
    const running = new Map<string, Running>()
    const modelSubscription = yield* PubSub.subscribe(config.modelPubSub).pipe(
      Effect.provideService(Scope.Scope, config.runtimeScope),
    )
    const reconcile = (model: Model) =>
      Effect.gen(function* () {
        const selected = config.select(model)
        for (const [key, active] of running) {
          if (selected[key] !== active.entry) {
            yield* Fiber.interrupt(active.fiber)
            running.delete(key)
          }
        }
        for (const [key, entry] of Object.entries(selected)) {
          if (Object.hasOwn(config.staticSubscriptions, key)) {
            throw new Error(
              `Dynamic Subscriptions: duplicate static key "${key}"`,
            )
          }
          const dependencies = entry.modelToDependencies(model)
          const active = running.get(key)
          if (active) {
            const previous = Ref.getUnsafe(active.latest)
            yield* Ref.set(active.latest, dependencies)
            if (active.equivalent(previous, dependencies)) {
              continue
            }
            yield* Fiber.interrupt(active.fiber)
          }
          const latest =
            active?.latest ?? (yield* Ref.make<unknown>(dependencies))
          const equivalent =
            entry.keepAliveEquivalence ??
            Schema.toEquivalence(entry.dependenciesSchema)
          const fiber = yield* Effect.forkIn(config.runtimeScope)(
            entry
              .dependenciesToStream(dependencies, () => Ref.getUnsafe(latest))
              .pipe(
                Stream.runForEach(config.enqueueMessageEffect),
                config.provideAllResources,
                Effect.catchCause(cause =>
                  config.crashWith(cause, Option.none()),
                ),
              ),
          )
          running.set(key, { entry, latest, equivalent, fiber })
        }
      })
    yield* reconcile(config.initModel)
    yield* Effect.forkIn(config.runtimeScope)(
      Stream.fromSubscription(modelSubscription).pipe(
        Stream.runForEach(reconcile),
        Effect.catchCause(cause => config.crashWith(cause, Option.none())),
      ),
    )
  })
