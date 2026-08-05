import { fileURLToPath } from 'node:url'

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { defineConfig, type RsbuildPlugin } from '@lynx-js/rspeedy'

/**
 * Lynx has no dev-server proxy for the Go API the way Vite did, and the bundle
 * runs inside LynxExplorer (a different host), so `/api` relative URLs cannot
 * work. The API base must be an absolute origin reachable from the device.
 */
const API_BASE =
  process.env['MUTOPOS_API_BASE'] ?? 'http://127.0.0.1:8080'

/**
 * Opening the bare sandbox domain (https://rizky-mutopos.fural.space/) would
 * otherwise hit the dev server's 404 shell, because the web app only lives at
 * `/__web_preview?casename=main.web.bundle`. Redirect the root there so the
 * domain "just opens".
 */
const rootToWebPreview: RsbuildPlugin = {
  name: 'mutopos:root-to-web-preview',
  setup(api) {
    api.modifyRsbuildConfig(config => {
      const dev = (config.dev ??= {})
      const existing = dev.setupMiddlewares
      dev.setupMiddlewares = [
        ...(existing === undefined
          ? []
          : Array.isArray(existing)
            ? existing
            : [existing]),
        middlewares => {
          middlewares.unshift((req, res, next) => {
            if (req.url === '/' || req.url === '') {
              res.statusCode = 302
              res.setHeader(
                'Location',
                '/__web_preview?casename=main.web.bundle',
              )
              res.end()
              return
            }
            next()
          })
        },
      ]
    })
  },
}

export default defineConfig({
  source: {
    entry: './src/index.tsx',
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    define: {
      __API_BASE__: JSON.stringify(API_BASE.replace(/\/+$/, '')),
    },
  },
  environments: {
    lynx: {},
    web: {},
  },
  /**
   * The sandbox reverse proxy (rizky-mutopos.fural.space) targets this exact
   * port, so it is pinned: `strictPort` makes `rspeedy dev` fail loudly when
   * the port is taken instead of silently moving to the next one, which would
   * leave the proxy pointing at a dead backend (HTTP 502).
   */
  server: {
    host: '0.0.0.0',
    port: 3005,
    strictPort: true,
  },
  plugins: [
    rootToWebPreview,
    pluginQRCode({
      schema(url) {
        // `?fullscreen=true` opens the POS full screen in LynxExplorer.
        return `${url}?fullscreen=true`
      },
    }),
    pluginReactLynx({
      // The ported UI is written against the web box model: `display: flex`
      // as the default (Lynx defaults to `linear`), and inherited typography
      // so a styled `<view>` still colours the `<text>` nodes inside it.
      defaultDisplayLinear: false,
      enableCSSInheritance: true,
      customCSSInheritanceList: [
        'color',
        'font-family',
        'font-size',
        'font-weight',
        'letter-spacing',
        'line-height',
        'text-align',
      ],
    }),
  ],
})
