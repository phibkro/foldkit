import { Effect, Fiber, Schema } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { defineView } from '../html/submodel.js'
import { defineMessageUnion } from '../message/index.js'
import * as Submodel from '../submodel/module.js'
import { makeElement } from './makeElement.js'

describe('Model code preparation barrier', () => {
  it('awaits preparation before rendering or selecting subscriptions', async () => {
    const container = document.createElement('div')
    container.id = 'prepare-model-test'
    document.body.appendChild(container)
    const calls: string[] = []
    let release = () => {}
    const prepared = new Promise<void>(resolve => {
      release = resolve
    })
    const fiber = Effect.runFork(
      makeElement({
        Model: Schema.Struct({ value: Schema.String }),
        init: () => ({ model: { value: 'restored child' } }),
        update: model => ({ model }),
        resumeModel: () => {
          calls.push('resume')
          return []
        },
        prepareModel: model =>
          Effect.promise(() => {
            calls.push(`prepare:${model.value}`)
            return prepared
          }),
        dynamicSubscriptions: () => {
          calls.push('subscriptions')
          return {}
        },
        view: (model, h) => {
          calls.push('render')
          return h.div([h.Id('prepare-model-test')], [model.value])
        },
        container,
      }).start(),
    )
    try {
      await vi.waitFor(() => expect(calls).toEqual(['prepare:restored child']))
      release()
      await vi.waitFor(() => expect(calls).toContain('subscriptions'))
      expect(calls.indexOf('render')).toBeGreaterThan(
        calls.indexOf('prepare:restored child'),
      )
      expect(document.body.textContent).toContain('restored child')
      expect(calls).not.toContain('resume')
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber))
      document.getElementById('prepare-model-test')?.remove()
    }
  })
})

describe('restored pending Submodel', () => {
  it('resumes the serialized preparation Command in a fresh runtime', async () => {
    const ChildMessage = defineMessageUnion({ ClickedIncrement: {} })
    const Child = Submodel.contract('RestoredCounter', {
      Model: Schema.Struct({ count: Schema.Number }),
      Message: ChildMessage,
      Input: Schema.Struct({ initial: Schema.Number }),
      OutMessage: Schema.Never,
    })
    const implementation = Submodel.implement(Child, {
      init: input => ({ model: { count: input.initial } }),
      update: model => ({ model: { count: model.count + 1 } }),
      view: defineView<
        typeof Child.Model.Type,
        typeof Child.Message.Type,
        { readonly input: typeof Child.Input.Type }
      >((model, _input, h) =>
        h.button(
          [h.OnClick(ChildMessage.ClickedIncrement())],
          [String(model.count)],
        ),
      ),
    })
    const first = Submodel.lazy(Child, {
      buildId: 'same-build',
      load: () => Promise.resolve(implementation),
    })
    const encoded = Schema.encodeSync(Schema.toCodecJson(first.Model))(
      first.enter({ initial: 7 }, 4).model,
    )
    const fresh = Submodel.lazy(Child, {
      buildId: 'same-build',
      load: () => Promise.resolve(implementation),
    })
    const init = vi.fn(() => fresh.enter({ initial: 99 }, 1))
    const container = document.createElement('div')
    container.id = 'resume-model-test'
    document.body.appendChild(container)
    const element = makeElement({
      Model: fresh.Model,
      init,
      update: fresh.update,
      prepareModel: fresh.prepare,
      resumeModel: state => fresh.resume(state).commands ?? [],
      view: (model, h) =>
        h.div(
          [h.Id('resume-model-test')],
          [
            h.submodel({
              slotId: 'counter',
              model,
              view: fresh.view,
              viewInputs: { input: model.input },
              toParentMessage: message => message,
            }),
          ],
        ),
      container,
    })
    const fiber = Effect.runFork(element.start(encoded))
    try {
      await vi.waitFor(() =>
        expect(
          document.querySelector('#resume-model-test button')?.textContent,
        ).toBe('7'),
      )
      expect(init).not.toHaveBeenCalled()
      document
        .querySelector<HTMLButtonElement>('#resume-model-test button')!
        .click()
      await vi.waitFor(() =>
        expect(
          document.querySelector('#resume-model-test button')?.textContent,
        ).toBe('8'),
      )
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber))
      document.getElementById('resume-model-test')?.remove()
    }
  })
})
