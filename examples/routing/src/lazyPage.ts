import { Array, Option } from 'effect'
import buildId from 'virtual:foldkit-submodels/build-id'

import { createCatalog } from './submodels.generated'

export const NestedPage = Option.getOrThrow(
  Array.head(createCatalog({ buildId })),
)
