import { Option } from 'effect'
import { Route, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

const registerRoute = Route.register<Model, Message>()

const nestedRoute = registerRoute(nestedRouter, {
  tag: 'Nested',
  entered: () => model => {
    const nextInstance = model.nestedInstance + 1
    return Update.foldChildInit(
      NestedPage.enter(
        {},
        nextInstance,
        Option.getOrUndefined(model.maybeNestedPage),
      ),
      {
        toParentModel: nestedPage =>
          modifyFields(model, {
            maybeNestedPage: () => Option.some(nestedPage),
            nestedInstance: () => nextInstance,
          }),
        toParentMessage: message => Message.GotNestedMessage({ message }),
      },
    )
  },
})

const routes = Route.catalog(nestedRoute)

const handleNavigation = (model: Model, nextRoute: AppRoute) =>
  Update.combine(model, [
    stepModel => ({
      model: modifyFields(stepModel, { route: () => nextRoute }),
    }),
    routes.transition(Route.Transition.make(model.route, nextRoute)),
  ])
