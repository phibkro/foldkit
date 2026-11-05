import { Submodel } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Message, Model, contract } from './page.contract'

export const implementation = Submodel.implement(contract, {
  init: () => ({ model: { visits: 0 } }),
  revive: model => ({ model }),
  update: (model, message) =>
    Message.match(message, {
      ClickedIncrement: () => ({
        model: modifyFields(model, { visits: visits => visits + 1 }),
      }),
    }),
  view: Submodel.defineView<
    Model,
    Message,
    { readonly input: typeof contract.Input.Type }
  >((model, _inputs, h) =>
    h.div(
      [h.Class('max-w-4xl mx-auto px-4')],
      [
        h.h1(
          [h.Class('text-4xl font-bold text-gray-800 mb-6')],
          ['Very Nested Route!'],
        ),
        h.p(
          [h.Class('text-lg text-gray-600')],
          ['You found the deeply nested route at /nested/route/is/very/nested'],
        ),
        h.button(
          [
            h.OnClick(Message.ClickedIncrement()),
            h.Class(
              'mt-4 px-4 py-2 rounded bg-blue-500 text-white cursor-pointer',
            ),
          ],
          [`Increment: ${model.visits}`],
        ),
      ],
    ),
  ),
})
