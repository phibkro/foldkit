import { defineConfig } from 'vite'

import { foldkit, foldkitSubmodels } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

import { foldkitAliases } from '../vite.aliases'
import { submodelCatalog } from './submodels.config'

export default defineConfig({
  plugins: [
    tailwindcss(),
    foldkit({ devToolsMcpPort: 9988 }),
    foldkitSubmodels(submodelCatalog),
  ],
  resolve: {
    alias: foldkitAliases(__dirname),
  },
  server: {
    fs: {
      allow: ['../../'],
    },
  },
})
