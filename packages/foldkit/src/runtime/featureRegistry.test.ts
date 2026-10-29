import { Effect, Option, Schema, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { __htmlBuilder } from '../html/index.js'
import * as ManagedResource from '../managedResource/index.js'
import { defineMessageUnion } from '../message/index.js'
import * as Subscription from '../subscription/subscription.js'
import type * as Update from '../update/index.js'
import { featureRegistry } from './featureRegistry.js'
import { makeApplication } from './makeApplication.js'

const Message = defineMessageUnion({
  Ticked: {},
  AcquiredEngine: {},
  ReleasedEngine: {},
  FailedAcquireEngine: {},
})
type Message = typeof Message.Type

const Model = Schema.Struct({ isEngineOn: Schema.Boolean })
type Model = typeof Model.Type

const h = __htmlBuilder<Message>()

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    Ticked: () => ({ model }),
    AcquiredEngine: () => ({ model }),
    ReleasedEngine: () => ({ model }),
    FailedAcquireEngine: () => ({ model }),
  })

const Engine = ManagedResource.tag<number>()('Engine')

const EngineRequirements = Schema.Option(Schema.Boolean)

const engineCallbacks = {
  resource: Engine,
  modelToMaybeRequirements: (model: Model) =>
    model.isEngineOn ? Option.some(true) : Option.none(),
  acquire: () => Effect.succeed(1),
  release: () => Effect.void,
  onAcquired: () => Message.AcquiredEngine(),
  onReleased: () => Message.ReleasedEngine(),
  onAcquireError: () => Message.FailedAcquireEngine(),
}

let container: HTMLElement

const makeEngineApplication = (
  config: Pick<
    Parameters<typeof makeApplication<Model, Message, never, never>>[0],
    'subscriptions' | 'managedResources'
  >,
) =>
  makeApplication({
    Model,
    init: () => ({ model: { isEngineOn: false } }),
    update,
    view: () => ({ title: 'Engine', body: h.div([], ['Engine']) }),
    container,
    ...config,
  })

let registeredRuntimes: typeof featureRegistry = {}

const clearFeatureRuntimes = (): void => {
  delete featureRegistry.forkSubscriptionFibers
  delete featureRegistry.forkManagedResourceFibers
}

beforeEach(() => {
  registeredRuntimes = { ...featureRegistry }
  clearFeatureRuntimes()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  clearFeatureRuntimes()
  Object.assign(featureRegistry, registeredRuntimes)
  container.remove()
})

describe('feature runtime registration', () => {
  it('throws when Subscriptions were not created with Subscription.make', () => {
    /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
    const subscriptions = {
      tick: Subscription.persistentEntry(Stream.make(Message.Ticked())),
    } as unknown as Subscription.Subscriptions<Model, Message>

    expect(() => makeEngineApplication({ subscriptions })).toThrow(
      /Subscription runtime is not installed.*Subscription\.make/,
    )
  })

  it('throws when ManagedResources were not created with ManagedResource.make', () => {
    /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
    const managedResources = {
      engine: { schema: EngineRequirements, ...engineCallbacks },
    } as unknown as ManagedResource.ManagedResources<Model, Message>

    expect(() => makeEngineApplication({ managedResources })).toThrow(
      /ManagedResource runtime is not installed.*ManagedResource\.make/,
    )
  })

  it('creates the application when Subscriptions come from Subscription.make', () => {
    const subscriptions = Subscription.make<Model, Message>()(() => ({
      tick: Subscription.persistentEntry(Stream.make(Message.Ticked())),
    }))

    expect(() => makeEngineApplication({ subscriptions })).not.toThrow()
  })

  it('creates the application when ManagedResources come from ManagedResource.make', () => {
    const managedResources = ManagedResource.make<Model, Message>()(entry => ({
      engine: entry(EngineRequirements, engineCallbacks),
    }))

    expect(() => makeEngineApplication({ managedResources })).not.toThrow()
  })

  it('creates the application with an empty ManagedResources record', () => {
    expect(() => makeEngineApplication({ managedResources: {} })).not.toThrow()
  })
})
