import { Array, Context, Effect, Schema, pipe } from 'effect'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import * as Command from '../command/index.js'
import { defineMessageUnion } from '../message/index.js'
import { modifyFields } from '../struct/index.js'
import * as Update from '../update/index.js'
import { defineRouteUnion } from './index.js'
import { int, literal, mapTo, root, slash } from './parser.js'
import { catalog, register } from './registration.js'
import * as Transition from './transition.js'

const AppRoute = defineRouteUnion({
  Home: {},
  Person: { personId: Schema.Number },
  NotFound: { path: Schema.String },
})
type AppRoute = typeof AppRoute.Type
const Model = Schema.Struct({ events: Schema.Array(Schema.String) })
type Model = typeof Model.Type
const Message = defineMessageUnion({
  CompletedPrefetch: {},
  CompletedRecord: { event: Schema.String },
})
type Message = typeof Message.Type
const Record = Command.define('Record', {
  args: { event: Schema.String },
  messages: [Message.CompletedRecord],
  execute: ({ event }) => Effect.succeed(Message.CompletedRecord({ event })),
})
const Prefetch = Command.define('Prefetch', {
  messages: [Message.CompletedPrefetch],
  execute: Effect.succeed(Message.CompletedPrefetch()),
})
const homeRouter = pipe(root, mapTo(AppRoute.Home))
const personRouter = pipe(
  literal('people'),
  slash(int('personId')),
  mapTo(AppRoute.Person),
)
const registerRoute = register<Model, Message>()
const record =
  (event: string): Update.Step<Model, Message> =>
  model => ({
    model: modifyFields(model, { events: events => [...events, event] }),
    commands: [Record({ event })],
  })
const person = registerRoute(personRouter, {
  tag: 'Person',
  entered: route => record(`enter:${route.personId}`),
  stayed: ({ previousRoute, nextRoute }) =>
    record(`stay:${previousRoute.personId}:${nextRoute.personId}`),
  exited: route => record(`exit:${route.personId}`),
  prefetch: () => [Prefetch()],
})
const home = registerRoute(homeRouter, {
  tag: 'Home',
  entered: () => record('enter:home'),
  exited: () => record('exit:home'),
})
const routes = catalog(person, home)

const eventsFromCommands = async (
  commands: ReadonlyArray<Command.Command<Message>> | undefined,
) =>
  Effect.runPromise(
    Effect.all(Array.map(commands ?? [], command => command.effect)),
  )

describe('route registration', () => {
  it('preserves URL builders, ordered complete parsing and inferred route unions', async () => {
    expect(person.router({ personId: 7 })).toBe('/people/7')
    expect(person.router).toBe(personRouter)
    const parsed = await Effect.runPromise(routes.parse(['people', '7']))
    expect(parsed).toEqual([AppRoute.Person({ personId: 7 }), []])
    expectTypeOf(parsed).toEqualTypeOf<
      [
        typeof AppRoute.Home.Type | typeof AppRoute.Person.Type,
        ReadonlyArray<string>,
      ]
    >()
    await expect(
      Effect.runPromise(routes.parse(['people', '7', 'extra'])),
    ).rejects.toThrow()
  })

  it('uses cold entry and same-tag stay callbacks with typed payloads', () => {
    const cold = routes.transition(
      Transition.coldLoad(AppRoute.Person({ personId: 1 })),
    )({ events: [] })
    expect(cold.model.events).toEqual(['enter:1'])
    const stayed = routes.transition(
      Transition.make(
        AppRoute.Person({ personId: 1 }),
        AppRoute.Person({ personId: 2 }),
      ),
    )(cold.model)
    expect(stayed.model.events).toEqual(['enter:1', 'stay:1:2'])
  })

  it('threads exit Model changes and Commands into entry regardless of parser order', async () => {
    const navigation = routes.transition(
      Transition.make<AppRoute>(
        AppRoute.Home(),
        AppRoute.Person({ personId: 3 }),
      ),
    )({ events: [] })
    expect(navigation.model.events).toEqual(['exit:home', 'enter:3'])
    expect(await eventsFromCommands(navigation.commands)).toEqual([
      Message.CompletedRecord({ event: 'exit:home' }),
      Message.CompletedRecord({ event: 'enter:3' }),
    ])
  })

  it('does nothing for unregistered routes or omitted callbacks', () => {
    const model = { events: [] }
    const unknown = AppRoute.NotFound({ path: '/missing' })
    expect(routes.transition(Transition.coldLoad(unknown))(model).model).toBe(
      model,
    )
    expect(
      registerRoute(homeRouter, { tag: 'Home' }).transition(
        Transition.coldLoad(AppRoute.Home()),
      )(model),
    ).toEqual({ model })
  })

  it('constructs prefetch Commands without executing work or running entry callbacks', async () => {
    const entered = vi.fn(() => record('enter'))
    const registered = registerRoute(personRouter, {
      tag: 'Person',
      entered,
      prefetch: () => [Prefetch()],
    })
    const collection = catalog(registered, home)
    await Effect.runPromise(collection.parse(['people', '8']))
    expect(entered).not.toHaveBeenCalled()
    const commands = collection.prefetch(AppRoute.Person({ personId: 8 }))
    expect(entered).not.toHaveBeenCalled()
    expect(await eventsFromCommands(commands)).toEqual([
      Message.CompletedPrefetch(),
    ])
    expect(collection.prefetch(AppRoute.Home())).toEqual([])
  })

  it('rejects duplicate tags before parsing or dispatching', () => {
    expect(() => catalog(person, person)).toThrow(
      'Duplicate route registration: Person',
    )
  })

  it('checks registration tags and callback route payloads', () => {
    // @ts-expect-error The tag must belong to the registered Router.
    registerRoute(homeRouter, { tag: 'Person' })
    // @ts-expect-error Prefetch requires the registered route payload.
    routes.prefetch({ _tag: 'Person' })
    // @ts-expect-error Navigation requires the registered route payload.
    routes.transition(Transition.coldLoad({ _tag: 'Person' }))
    registerRoute(personRouter, {
      tag: 'Person',
      entered: route => {
        expectTypeOf(route).toEqualTypeOf<typeof AppRoute.Person.Type>()
        // @ts-expect-error The callback receives only the registered route.
        route.path
        return record(String(route.personId))
      },
    })
  })
})

class PageService extends Context.Service<
  PageService,
  Readonly<{ value: string }>
>()('Route/PageService') {}
class PrefetchService extends Context.Service<
  PrefetchService,
  Readonly<{ value: string }>
>()('Route/PrefetchService') {}
const FetchPage = Command.define('FetchPage', {
  messages: [Message.CompletedPrefetch],
  execute: Effect.as(PageService, Message.CompletedPrefetch()),
})
const WarmPage = Command.define('WarmPage', {
  messages: [Message.CompletedPrefetch],
  execute: Effect.as(PrefetchService, Message.CompletedPrefetch()),
})

it('preserves the union of Command service requirements across registrations', () => {
  const page = registerRoute(personRouter, {
    tag: 'Person',
    entered: () => model => ({ model, commands: [FetchPage()] }),
  })
  const prefetch = registerRoute(homeRouter, {
    tag: 'Home',
    prefetch: () => [WarmPage()],
  })
  const collection = catalog(page, prefetch)
  expectTypeOf(
    collection.transition(Transition.coldLoad(AppRoute.Home())),
  ).toEqualTypeOf<Update.Step<Model, Message, PageService | PrefetchService>>()
  expectTypeOf(collection.prefetch(AppRoute.Home())).toEqualTypeOf<
    ReadonlyArray<
      Command.Command<Message, never, PageService | PrefetchService>
    >
  >()
  const OtherModel = Schema.Struct({ other: Schema.String })
  const other = register<typeof OtherModel.Type, Message>()(homeRouter, {
    tag: 'Home',
  })
  // @ts-expect-error Every registration must update the same parent Model.
  catalog(person, other)
})
