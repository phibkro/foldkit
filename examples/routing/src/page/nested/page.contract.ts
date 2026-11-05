import { Schema } from 'effect'
import { Submodel } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

export const Model = Schema.Struct({ visits: Schema.Number })
export type Model = typeof Model.Type
export const Message = defineMessageUnion({ ClickedIncrement: {} })
export type Message = typeof Message.Type
export const contract = Submodel.contract('Nested', {
  Model,
  Message,
  Input: Schema.Struct({}),
  OutMessage: Schema.Never,
})
