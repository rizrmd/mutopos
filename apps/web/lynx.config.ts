import { fileURLToPath } from 'node:url'

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { defineConfig } from '@lynx-js/rspeedy'

/**
 * Lynx has no dev-server proxy for the Go API the way Vite did, and the bundle
 * runs inside LynxExplorer (a different host), so `/api` relative URLs cannot
 * work. The API base must be an absolute origin reachable from the device.
 */
const API_BASE =
  process.env['MUTOPOS_API_BASE'] ?? 'http://127.0.0.1:8080'

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
  plugins: [
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
