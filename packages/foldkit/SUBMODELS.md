# Submodels

Use `Submodel.define({ Model, Message, init, update, view, subscriptions })` to define an ordinary child state machine. The view and Subscriptions are optional. A view declared inside `define` receives the child Message type without a separate `defineView` call. Initialization and update are synchronous and preserve their argument lists.

Use `Submodel.bind(child, { name, read, write, toParentMessage, foldOutMessage })` to declare its parent relationship once. `foldOutMessage` is required only when the child can emit OutMessages. The parent owns its Model, child presence, and wrapper Messages.

- `binding.init(toParentModel, ...args)` constructs the parent from the initialized child and lifts its Commands and OutMessages.
- `binding.enter(parentModel, ...args)` initializes a child inside an existing parent through `write`.
- `binding.update(parentModel, childMessage, ...args)` delegates to the child, writes its result, and lifts Commands and OutMessages.
- `binding.view(parentModel, h, options)` renders through `h.submodel`. The binding name supplies the default slot. Pass `slotId` for another render position and `viewInputs` when the child requires them.
- `binding.subscriptions(parentModel)` selects and lifts child Subscriptions for the runtime's `dynamicSubscriptions` option. Combine bindings with `Subscription.aggregate`. Binding names namespace entries; distinct child relationships need distinct names. Selected records must be immutable and retain their identity while active.

Return `None` from `read` while the child is absent. The binding skips its update, view, Subscriptions, and restoration hooks. Bindings retain lifted code and Subscription adapters, never parent Models.

## Lazy implementations

Lazy hosts implement the same definition interface and can be passed directly to `Submodel.bind`. Wire `binding.prepareModel` and `binding.resumeModel` to the runtime's matching options. The lazy host owns preparation state; ordinary Submodels need no loading host.

A definition's optional `prepareModel` prepares code without changing its Model. Its optional `resumeModel` returns Commands directly. Recovery changes the Model through the Messages produced by those Commands. Lazy hosts expose these hooks alongside their `prepare` and `resume` entry points.

`Submodel.eager` is an explicit preparation host for an already imported implementation. It follows the same admission protocol as `Submodel.lazy`. Use `Submodel.define` for ordinary synchronous composition.

`Submodel.contract` defines the eager schemas for a child. `Submodel.implement` checks its executable module. `Submodel.lazy` creates an application-owned host for that module.

The host loads the entire implementation: init, update, view, Commands, Subscriptions, and revive. The contract schemas remain eager for root Model and Message decoding.

```ts
// counter/page.contract.ts
import { Schema } from 'effect'
import { Submodel } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

export const Message = defineMessageUnion({ ClickedIncrement: {} })

export const contract = Submodel.contract('Counter', {
  Model: Schema.Struct({ count: Schema.Number }),
  Message,
  Input: Schema.Struct({ initial: Schema.Number }),
  OutMessage: Schema.Never,
})
```

```ts
// counter/implementation.ts
import { Submodel } from 'foldkit'
import { contract, Message } from './page.contract'

export const implementation = Submodel.implement(contract, {
  init: input => ({ model: { count: input.initial } }),
  update: model => ({ model: { count: model.count + 1 } }),
  view: Submodel.defineView<
    typeof contract.Model.Type,
    typeof contract.Message.Type,
    { readonly input: typeof contract.Input.Type }
  >((model, _inputs, h) =>
    h.button([h.OnClick(Message.ClickedIncrement())], [String(model.count)]),
  ),
})
```

The host accepts a loader and a build identity. The Vite catalog generator supplies literal imports for each contract. See the [plugin guide](../vite-plugin-foldkit/README.md#submodel-catalogs).

```ts
const counter = Submodel.lazy(contract, {
  buildId,
  load: () =>
    import('./counter/implementation').then(module => module.implementation),
})
const entered = counter.enter({ initial: 0 }, instance)
```

## Parent integration

1. Put `contract.host.Model` and `contract.host.Message` in the parent schemas.
2. Construct the catalog inside an application factory.
3. Use a fresh instance number for each new child lifetime.
4. Fold `host.update` into the parent update.
5. Render `host.view` through `h.submodel`.
6. Select `host.subscriptions(child)` through the runtime `dynamicSubscriptions` option.
7. Lift the selected subscriptions to the parent Model and Message.
8. Keep each lifted entry reference stable for its child lifetime.
9. Return pending host Commands from the runtime `resumeModel` option.

The runtime reconciles dynamic entries by name and reference. A dependency change restarts only that entry. Removed entries finish cleanup before replacements start. Static and dynamic entry names must differ.

`host.update` returns normal Commands and optional OutMessages. `Update.foldChild` can map both channels. The host supplies the current parent input to each child call.

## Admission and replay

The host Model contains `Loading`, `Failed`, or `Ready`. Each state contains the build identity, instance number, attempt number, and input. `Ready` also contains the child Model.

Entry always returns a preparation Command, including after prefetch. Its completion Message admits the child only for the matching build, instance, and attempt. Old completions and child Messages cannot change a later instance.

`host.prefetch()` loads code without child initialization. Download failures use the typed `Submodel.LoadError` channel. Concurrent requests share one load. A rejected load clears the pending request. `ClickedRetry` starts a new attempt.

Before fresh-host replay or restoration, run `host.prepare(savedState)`. The runtime `prepareModel` option supplies this barrier before initial rendering and subscriptions. The barrier loads only admitted `Ready` states. Loading and Failed states need no code to render.

The runtime `resumeModel` option runs after successful restoration and preparation, instead of fresh init. Return `host.resume(savedState).commands` through this option. The resumed preparation Command emits a normal typed completion for a Loading host. Failed state retains its retry UI.

The code cache belongs to one application and one build. It contains functions outside the Model. A `Ready` state requires its matching prepared module. A cold synchronous read fails instead of substituting another implementation.

`Submodel.eager` accepts an implementation value and uses the same admission protocol. Eager and lazy hosts therefore receive the same preparation facts during replay.

## Parked state and server rendering

`host.enter(input, newInstance, previousState)` passes the retained child Model to `implementation.revive`. Without `revive`, the host calls `init`. The parent owns parking policy and admission of previous state.

`host.resume` reconstructs host preparation only. Applications still own recovery of interrupted data Commands inside an admitted child. The runtime `resumeModel` hook can reconstruct those Commands after code preparation.

For server rendering, create a separate catalog for each request. Prepare its admitted state before synchronous rendering. The client must prepare the same state before hydration, with the same build identity.

The primitive supports this preparation contract. The catalog plugin currently supports client builds. It does not coordinate identities or asset manifests across separate SSR and client builds. An SSR integration must supply that coordination.

During development, the catalog plugin changes its identity after implementation edits and requests a full reload. Applications must reject preserved Models from another build. Maple demonstrates this with a build-compatible root schema filter.

## Boundaries

A contract must import schemas without route execution. Shared schema modules must not re-export views or updates. Shared executable helpers belong outside route implementation directories.

The compiler diagnoses contract-to-execution imports, cross-route implementation imports, and executable route modules in startup chunks. Unsupported shared routes can remain eager until their boundary is explicit.

The primitive does not infer data preloading, route ownership, or parking policy. Application adapters retain these decisions. Browsers can retain failed native imports, including network failures. A loader retry does not clear those records. Maple retries through a document reload. Invalid deployed JavaScript still requires a corrected deployment.
