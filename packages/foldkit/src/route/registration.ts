import { Array } from 'effect'

import type { Command } from '../command/index.js'
import * as Update from '../update/index.js'
import { type Parser, type Router, oneOf } from './parser.js'
import * as Transition from './transition.js'

type TaggedRoute = Readonly<{ _tag: string }>
type OverlappingRoute<
  Given extends TaggedRoute,
  Registered extends TaggedRoute,
> = Given extends unknown
  ? Extract<Registered['_tag'], Given['_tag']> extends never
    ? never
    : Given
  : never
type CompatibleRoute<
  Given extends TaggedRoute,
  Registered extends TaggedRoute,
> = OverlappingRoute<Given, Registered> extends Registered ? unknown : never

type Phase = 'Entered' | 'Stayed' | 'Exited'
const phase = Symbol('Foldkit/Route/phase')

/** Parent update policy associated with one Router. Same-tag parameter and
 * query changes call `stayed`; the parent decides whether to retain or replace
 * its Submodel. Callbacks return Steps and never execute Commands. */
export type RegistrationOptions<
  Route extends TaggedRoute,
  Model,
  Message,
  R = never,
> = Readonly<{
  tag: NoInfer<Route['_tag']>
  entered?: (route: Route) => Update.Step<Model, Message, R>
  stayed?: (
    routes: Readonly<{ previousRoute: Route; nextRoute: Route }>,
  ) => Update.Step<Model, Message, R>
  exited?: (route: Route) => Update.Step<Model, Message, R>
  prefetch?: (route: Route) => ReadonlyArray<Command<Message, never, R>>
}>

/** A pure URL parser and its parent-owned navigation policy. `router` retains
 * the original URL builder. Use `catalog` to dispatch several registrations. */
export interface Registration<
  Route extends TaggedRoute,
  Model,
  Message,
  R = never,
> extends Parser<Route> {
  readonly router: Router<Route>
  readonly tag: Route['_tag']
  readonly transition: <const Given extends TaggedRoute>(
    transition: Transition.Transition<Given> &
      NoInfer<CompatibleRoute<Given, Route>>,
  ) => Update.Step<Model, Message, R>
  readonly prefetch: <const Given extends TaggedRoute>(
    route: Given & NoInfer<CompatibleRoute<Given, Route>>,
  ) => ReadonlyArray<Command<Message, never, R>>
  readonly [phase]: (
    transition: Transition.Transition<TaggedRoute>,
    selectedPhase: Phase,
  ) => Update.Step<Model, Message, R>
}

/** Registers a Router with typed entry, stay, exit and optional prefetch
 * callbacks. Registration and parsing do not import or initialize a child.
 * Use an existing lazy Submodel's enter/prefetch operations in the callbacks
 * to split its implementation from the initial application bundle. */
export const register =
  <Model, Message>() =>
  <Route extends TaggedRoute, R = never>(
    router: Router<Route>,
    options: RegistrationOptions<Route, Model, Message, R>,
  ): Registration<Route, Model, Message, R> => {
    const isRegistered = (route: TaggedRoute): route is Route =>
      route._tag === options.tag
    const keepModel: Update.Step<Model, Message, R> = model => ({ model })
    const selectPhase = (
      transition: Transition.Transition<TaggedRoute>,
      selectedPhase?: Phase,
    ): Update.Step<Model, Message, R> =>
      Transition.matchOrElse<Update.Step<Model, Message, R>>()(
        transition,
        options.tag,
        {
          Entered: route =>
            (selectedPhase === undefined || selectedPhase === 'Entered') &&
            isRegistered(route)
              ? (options.entered?.(route) ?? keepModel)
              : keepModel,
          Stayed: routes =>
            (selectedPhase === undefined || selectedPhase === 'Stayed') &&
            isRegistered(routes.previousRoute) &&
            isRegistered(routes.nextRoute)
              ? (options.stayed?.({
                  previousRoute: routes.previousRoute,
                  nextRoute: routes.nextRoute,
                }) ?? keepModel)
              : keepModel,
          Exited: route =>
            (selectedPhase === undefined || selectedPhase === 'Exited') &&
            isRegistered(route)
              ? (options.exited?.(route) ?? keepModel)
              : keepModel,
        },
        () => keepModel,
      )
    return {
      router,
      tag: options.tag,
      parse: router.parse,
      transition: transition => selectPhase(transition),
      prefetch: route =>
        isRegistered(route) ? (options.prefetch?.(route) ?? []) : [],
      [phase]: selectPhase,
    }
  }

/** An ordered route parser with navigation and prefetch dispatch. */
export interface Catalog<
  Route extends TaggedRoute,
  Model,
  Message,
  R = never,
> extends Parser<Route> {
  readonly transition: <const Given extends TaggedRoute>(
    transition: Transition.Transition<Given> &
      NoInfer<CompatibleRoute<Given, Route>>,
  ) => Update.Step<Model, Message, R>
  readonly prefetch: <const Given extends TaggedRoute>(
    route: Given & NoInfer<CompatibleRoute<Given, Route>>,
  ) => ReadonlyArray<Command<Message, never, R>>
}

type Parsed<Registered> = Registered extends Parser<infer Route> ? Route : never
type Requirements<Registered> =
  Registered extends Registration<any, any, any, infer R> ? R : never

/** Collects registrations in parser precedence order. Navigation runs exit
 * Steps before entry Steps regardless of parser order, threading the Model and
 * accumulating Commands. Duplicate tags are rejected. Prefetch returns only
 * the destination registration's Commands and never enters the route. */
export const catalog = <
  Route extends TaggedRoute,
  Model,
  Message,
  R,
  Others extends ReadonlyArray<
    Registration<any, NoInfer<Model>, NoInfer<Message>, any>
  >,
>(
  first: Registration<Route, Model, Message, R>,
  ...others: Others
): Catalog<
  Route | Parsed<Others[number]>,
  Model,
  Message,
  R | Requirements<Others[number]>
> => {
  const registrations: ReadonlyArray<
    Registration<any, Model, Message, R | Requirements<Others[number]>>
  > = [first, ...others]
  const tags = new Set<string>()
  for (const registration of registrations) {
    if (tags.has(registration.tag)) {
      throw new Error(`Duplicate route registration: ${registration.tag}`)
    }
    tags.add(registration.tag)
  }
  const parser = oneOf(...registrations)
  const phases: ReadonlyArray<Phase> = ['Exited', 'Stayed', 'Entered']
  return {
    parse: parser.parse,
    transition: transition =>
      Update.combine(
        Array.flatMap(phases, selectedPhase =>
          Array.map(registrations, registration =>
            registration[phase](transition, selectedPhase),
          ),
        ),
      ),
    prefetch: route =>
      Array.flatMap(registrations, registration =>
        registration.prefetch(route),
      ),
  }
}
