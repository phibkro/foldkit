import { Option, Schema } from 'effect'
import { Submodel, type Update } from 'foldkit'
import { type HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Counter } from './submodelDefinition'

const Model = Schema.Struct({ counter: Counter.Model })
type Model = typeof Model.Type
const Message = defineMessageUnion({
  GotCounterMessage: { message: Counter.Message },
})
type Message = typeof Message.Type

const counter = Submodel.bind(Counter, {
  name: 'counter',
  read: (model: Model) => Option.some(model.counter),
  write: (model, nextCounter) =>
    modifyFields(model, { counter: () => nextCounter }),
  toParentMessage: (message): Message => Message.GotCounterMessage({ message }),
})

export const init = () => counter.init(counter => ({ counter }), 0)

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    GotCounterMessage: ({ message }) => counter.update(model, message),
  })

export const view = (model: Model, h: HtmlBuilder<Message>) =>
  counter.view(model, h)
