import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * `src/App.tsx` is a shell that dynamically imports the app tree, so the boot
 * chunk is tiny — but the browser would only discover that second chunk after
 * fetching, parsing and executing the first one: a whole extra round trip.
 *
 * Declaring it as a modulepreload starts both downloads at once. The shell
 * paints from the small chunk while the big one is already in flight, so the
 * total bytes match a single bundle and interactivity does not regress.
 */
function preloadAppTree(): Plugin {
  return {
    name: 'preload-app-tree',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const appTree = Object.keys(bundle).find((file) => /^assets\/AppTree-[^/]+\.js$/.test(file))
      const html = bundle['index.html']
      if (!appTree || !html || html.type !== 'asset') return
      html.source = String(html.source).replace(
        '</head>',
        `  <link rel="modulepreload" crossorigin href="/${appTree}">\n  </head>`
      )
    },
  }
}

export default defineConfig({
  resolve: {
    alias: [
      {
        // `@firebase/firestore` imports re2js with a bare side-effect import, so
        // it cannot be tree-shaken even though only the Pipelines regex
        // evaluators use it (this app uses none of them). Dropping it takes the
        // initial chunk from 296 kB to 249 kB gzip. See
        // src/lib/vendor/re2js-stub.ts and tests/bundle-budget.test.ts.
        find: 're2js',
        replacement: new URL('./src/lib/vendor/re2js-stub.ts', import.meta.url).pathname,
      },
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    preloadAppTree(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'FireMD — notas en Markdown',
        short_name: 'FireMD',
        description: 'Notas en Markdown con carpetas, etiquetas y edición colaborativa en tiempo real.',
        // Matches the actual canvas (#ffffff / #1e1e1e); the old #faf9f6 was
        // never a color in the palette, so the installed app flashed off-brand.
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        // `any` keeps the rounded-square artwork; `maskable` is full bleed with
        // the mark inside the 80% safe circle, so Android's round/squircle
        // masks never clip the flame. Both come from scripts/icons/build.mjs.
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // index.html is intentionally NOT precached: a stale document would
        // reference asset hashes that no longer exist after a deploy. It is
        // fetched network-first and only falls back to cache when offline.
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
        // The social card is 200 kB that no offline screen ever shows; only
        // crawlers ask for it, and they are never offline.
        globIgnores: ['og-image.png'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'pages', networkTimeoutSeconds: 3 },
          },
        ],
      },
    }),
  ],
})
