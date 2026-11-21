/**
 * Dev-only config for the visual-review gallery (`dev/gallery.html`).
 *
 *   npx vite --config vite.gallery.config.ts --port 5198
 *
 * It swaps the two Firestore transports (Yjs provider + presence) and the email
 * directory for no-op stubs, so the real components render with fixture data and
 * zero network. The production config is untouched.
 */
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

const stubs: Array<{ endsWith: string; stub: string }> = [
  { endsWith: '/src/lib/collab/provider.ts', stub: 'dev/mocks/provider.ts' },
  { endsWith: '/src/lib/collab/awareness.ts', stub: 'dev/mocks/awareness.ts' },
  { endsWith: '/src/lib/directory.ts', stub: 'dev/mocks/directory.ts' },
]

function stubNetworkModules(): Plugin {
  return {
    name: 'gallery-stub-network',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (!resolved) return null
      const match = stubs.find((entry) => resolved.id.endsWith(entry.endsWith))
      return match ? path.resolve(process.cwd(), match.stub) : null
    },
  }
}

export default defineConfig({
  plugins: [stubNetworkModules(), react(), tailwindcss()],
  server: { port: 5198 },
})
