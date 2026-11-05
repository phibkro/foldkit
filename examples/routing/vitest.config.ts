import { defineConfig } from 'vitest/config'

import { foldkitSubmodels } from '@foldkit/vite-plugin'

import { submodelCatalog } from './submodels.config'

export default defineConfig({
  plugins: [foldkitSubmodels(submodelCatalog)],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/vitest-setup.ts'],
    server: {
      deps: {
        inline: ['foldkit', '@foldkit/ui', '@foldkit/devtools'],
      },
    },
  },
})
