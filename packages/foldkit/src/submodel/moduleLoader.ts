/**
 * An application-owned cache for an immutable module in one build. Call `load`
 * from a Command (or a server/replay preparation barrier), then record success
 * in the Model. Reading before that barrier fails instead of rendering a
 * different result for the same Model. Create a fresh cache for each SSR app.
 */
export const createModuleLoader = <Module>(
  loadModule: () => Promise<Module>,
) => {
  let loaded: { readonly module: Module } | undefined
  let pending: Promise<void> | undefined

  const load = (): Promise<void> => {
    if (loaded !== undefined) {
      return Promise.resolve()
    }
    if (pending !== undefined) {
      return pending
    }
    // Start on a microtask so synchronous loader failures also release pending.
    pending = Promise.resolve()
      .then(loadModule)
      .then(
        module => {
          loaded = { module }
          pending = undefined
        },
        (cause: unknown) => {
          pending = undefined
          throw cause
        },
      )
    return pending
  }

  return {
    load,
    require: (): Module => {
      if (loaded === undefined) {
        throw new Error(
          'Foldkit: module is not prepared. Await load() before rendering or replaying a ready Model.',
        )
      }
      return loaded.module
    },
  }
}
