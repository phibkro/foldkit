import { Schema } from 'effect'
import { Submodel, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

const Model = Schema.Struct({ count: Schema.Number })
const Message = defineMessageUnion({ ClickedIncrement: {} })

export const Counter = Submodel.define({
  Model,
  Message,
  init: (initial: number) => ({ model: { count: initial } }),
  update: (model, message) =>
    Message.match<Update.Return<typeof Model.Type, typeof Message.Type>>(
      message,
      {
        ClickedIncrement: () => ({
          model: modifyFields(model, { count: count => count + 1 }),
        }),
      },
    ),
  view: (model, h) =>
    h.button([h.OnClick(Message.ClickedIncrement())], [String(model.count)]),
})
