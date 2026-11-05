import { Effect, Fiber, Schema, Stream } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { defineMessageUnion } from '../message/index.js'
import * as Subscription from '../subscription/subscription.js'
import type * as Update from '../update/index.js'
import { makeElement } from './makeElement.js'

const Model = Schema.Struct({
  page: Schema.Literals(['A', 'B', 'None']),
  first: Schema.Number,
  second: Schema.Number,
  latest: Schema.Number,
})
type Model = typeof Model.Type
const Message = defineMessageUnion({
  NavigatedA: {},
  NavigatedB: {},
  LeftPage: {},
  ChangedFirst: {},
  ChangedLatest: {},
})
type Message = typeof Message.Type

const program = () => {
  const events: string[] = []
  let readLatest = () => -1
  const subscriptions = (page: string) =>
    Subscription.make<Model, Message>()(entry => ({
      first: entry(
        { version: Schema.Number },
        {
          modelToDependencies: model => ({ version: model.first }),
          dependenciesToStream: ({ version }) =>
            Stream.unwrap(
              Effect.sync(() => {
                events.push(`start:${page}:first:${version}`)
                return Stream.never.pipe(
                  Stream.ensuring(
                    Effect.sync(() => {
                      events.push(`stop:${page}:first:${version}`)
                    }),
                  ),
                )
              }),
            ),
        },
      ),
      second: entry(
        { version: Schema.Number },
        {
          modelToDependencies: model => ({ version: model.second }),
          dependenciesToStream: ({ version }) =>
            Stream.unwrap(
              Effect.sync(() => {
                events.push(`start:${page}:second:${version}`)
                return Stream.never.pipe(
                  Stream.ensuring(
                    Effect.sync(() => {
                      events.push(`stop:${page}:second:${version}`)
                    }),
                  ),
                )
              }),
            ),
        },
      ),
      latest: entry(
        { latest: Schema.Number },
        {
          modelToDependencies: model => ({ latest: model.latest }),
          keepAliveEquivalence: () => true,
          dependenciesToStream: (_dependencies, read) =>
            Stream.unwrap(
              Effect.sync(() => {
                readLatest = () => read().latest
                events.push(`start:${page}:latest`)
                return Stream.never
              }),
            ),
        },
      ),
    }))
  const pages = { A: subscriptions('A'), B: subscriptions('B'), None: {} }
  const container = document.createElement('div')
  container.id = 'dynamic-submodel-test'
  document.body.appendChild(container)
  const element = makeElement({
    Model,
    init: (): Update.Return<Model, Message> => ({
      model: { page: 'A', first: 0, second: 0, latest: 0 },
    }),
    update: (model: Model, message: Message) =>
      Message.match<Update.Return<Model, Message>>(message, {
        NavigatedA: () => ({ model: { ...model, page: 'A' } }),
        NavigatedB: () => ({ model: { ...model, page: 'B' } }),
        LeftPage: () => ({ model: { ...model, page: 'None' } }),
        ChangedFirst: () => ({ model: { ...model, first: model.first + 1 } }),
        ChangedLatest: () => ({
          model: { ...model, latest: model.latest + 1 },
        }),
      }),
    dynamicSubscriptions: model => pages[model.page],
    view: (model, h) =>
      h.div(
        [h.Id('dynamic-submodel-test')],
        [
          h.p([], [model.page]),
          h.button([h.Id('a'), h.OnClick(Message.NavigatedA())], ['A']),
          h.button([h.Id('b'), h.OnClick(Message.NavigatedB())], ['B']),
          h.button([h.Id('leave'), h.OnClick(Message.LeftPage())], ['Leave']),
          h.button(
            [h.Id('first'), h.OnClick(Message.ChangedFirst())],
            ['First'],
          ),
          h.button(
            [h.Id('latest'), h.OnClick(Message.ChangedLatest())],
            ['Latest'],
          ),
        ],
      ),
    container,
  })
  const fiber = Effect.runFork(element.start())
  return {
    events,
    latest: () => readLatest(),
    click: (id: string) =>
      document
        .querySelector<HTMLButtonElement>(`#dynamic-submodel-test #${id}`)!
        .click(),
    stop: async () => {
      await Effect.runPromise(Fiber.interrupt(fiber))
      document.getElementById('dynamic-submodel-test')?.remove()
    },
  }
}

describe('dynamic Subscriptions in a real runtime', () => {
  it('restarts only the entry whose dependencies changed and refreshes keep-alive readers', async () => {
    const app = program()
    try {
      await vi.waitFor(() => expect(app.events).toContain('start:A:second:0'))
      app.click('first')
      await vi.waitFor(() => expect(app.events).toContain('start:A:first:1'))
      expect(
        app.events.filter(event => event === 'start:A:second:0'),
      ).toHaveLength(1)
      expect(app.events).not.toContain('stop:A:second:0')
      expect(app.events.indexOf('stop:A:first:0')).toBeLessThan(
        app.events.indexOf('start:A:first:1'),
      )
      app.click('latest')
      await vi.waitFor(() => expect(app.latest()).toBe(1))
      expect(
        app.events.filter(event => event === 'start:A:latest'),
      ).toHaveLength(1)
    } finally {
      await app.stop()
    }
  })

  it('disposes the old page before activating another and starts a new instance on return', async () => {
    const app = program()
    try {
      await vi.waitFor(() => expect(app.events).toContain('start:A:first:0'))
      app.click('b')
      await vi.waitFor(() => expect(app.events).toContain('start:B:first:0'))
      expect(app.events.indexOf('stop:A:second:0')).toBeLessThan(
        app.events.indexOf('start:B:first:0'),
      )
      app.click('a')
      await vi.waitFor(() =>
        expect(
          app.events.filter(event => event === 'start:A:first:0'),
        ).toHaveLength(2),
      )
      app.click('leave')
      await vi.waitFor(() =>
        expect(
          app.events.filter(event => event === 'stop:A:first:0'),
        ).toHaveLength(2),
      )
    } finally {
      await app.stop()
    }
  })

  it('releases active child streams when the application stops', async () => {
    const app = program()
    await vi.waitFor(() => expect(app.events).toContain('start:A:first:0'))
    await app.stop()
    expect(app.events).toContain('stop:A:first:0')
    expect(app.events).toContain('stop:A:second:0')
  })
})
