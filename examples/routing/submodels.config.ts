import { fileURLToPath } from 'node:url'

import type { SubmodelCatalogOptions } from '@foldkit/vite-plugin'

export const submodelCatalog: SubmodelCatalogOptions = {
  directory: fileURLToPath(new URL('./src/page', import.meta.url)),
  catalog: fileURLToPath(
    new URL('./src/submodels.generated.ts', import.meta.url),
  ),
}
