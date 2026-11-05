import { Submodel } from 'foldkit'
import buildId from 'virtual:foldkit-submodels/build-id'

import { contract } from './page/nested/page.contract'

const NestedPage = Submodel.lazy(contract, {
  buildId,
  load: () =>
    import('./page/nested/implementation').then(
      module => module.implementation,
    ),
})
