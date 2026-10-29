---
'foldkit': minor
---

`ManagedResources` now accepts only configurations created by `ManagedResource.make`, directly or through `ManagedResource.lift` or `ManagedResource.aggregate`. A ManagedResource configuration written by hand as a plain object no longer type-checks. `ManagedResource.make` installs the runtime that starts ManagedResources, so an application whose configurations never pass through it cannot start them. Records built with the constructors type-check as before.

**Migration:** create hand-written ManagedResource configurations with `ManagedResource.make`, passing the requirements schema as the first argument to `entry` and the remaining fields as the second.

```ts
const managedResources = ManagedResource.make<Model, Message>()(entry => ({
  engine: entry(EngineRequirements, {
    resource: Engine,
    modelToMaybeRequirements,
    acquire,
    release,
    onAcquired,
    onReleased,
    onAcquireError,
  }),
}))
```
