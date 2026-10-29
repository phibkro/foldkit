import type { createDevToolsStore } from '../devTools/store.js'
import type { forkManagedResourceFibers } from './managedResourceFibers.js'
import type { forkSubscriptionFibers } from './subscriptionFibers.js'

/** Runtime implementations of optional features.
 *
 *  The runtime never imports these directly. Each one is registered by the code
 *  that enables the feature: `Subscription.make`, `ManagedResource.make`, or the
 *  DevTools overlay registration the Foldkit Vite plugin injects. A bundle that
 *  never uses a feature leaves its implementation, and the Effect modules it
 *  pulls in, out of the build. */
export const featureRegistry: {
  forkSubscriptionFibers?: typeof forkSubscriptionFibers
  forkManagedResourceFibers?: typeof forkManagedResourceFibers
  createProductionDevToolsStore?: typeof createDevToolsStore
} = {}

/** Throws when an application passes Subscriptions or ManagedResources whose
 *  runtime was never registered. Their `make` functions register it, so this
 *  happens when the values were built without `Subscription.make` or
 *  `ManagedResource.make`, or when the bundle contains more than one copy of
 *  Foldkit and the values come from a different copy than the runtime. */
export const assertFeatureRuntimesRegistered = ({
  hasSubscriptions,
  hasManagedResources,
}: Readonly<{
  hasSubscriptions: boolean
  hasManagedResources: boolean
}>): void => {
  if (
    hasSubscriptions &&
    featureRegistry.forkSubscriptionFibers === undefined
  ) {
    throw new Error(
      '[foldkit] The Subscription runtime is not installed. Create ' +
        'Subscriptions with Subscription.make, which installs it. If they ' +
        'already come from Subscription.make, the bundle contains more than ' +
        'one copy of foldkit; make sure the app and its dependencies resolve ' +
        'the same copy.',
    )
  }

  if (
    hasManagedResources &&
    featureRegistry.forkManagedResourceFibers === undefined
  ) {
    throw new Error(
      '[foldkit] The ManagedResource runtime is not installed. Create ' +
        'ManagedResources with ManagedResource.make, which installs it. If ' +
        'they already come from ManagedResource.make, the bundle contains ' +
        'more than one copy of foldkit; make sure the app and its ' +
        'dependencies resolve the same copy.',
    )
  }
}
