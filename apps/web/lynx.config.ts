import { fileURLToPath } from 'node:url'
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { defineConfig, type RsbuildPlugin } from '@lynx-js/rspeedy'

/**
 * Absolute API origin baked into the Lynx bundle via `__API_BASE__`.
 *
 * - Empty string (default): same-origin — the web preview proxies `/v1`,
 *   `/healthz`, `/readyz` to the Go API. Correct for the sandbox domain
 *   (https://rizky-mutopos.fural.space) where `http://127.0.0.1:8080` would
 *   hit the visitor's machine and be blocked as mixed content.
 * - Set `MUTOPOS_API_BASE` for LynxExplorer on a phone (e.g.
 *   `http://192.168.1.10:8080`) — the device must reach that host.
 */
const API_BASE = (process.env['MUTOPOS_API_BASE'] ?? '').replace(/\/+$/, '')

const API_UPSTREAM =
  process.env['MUTOPOS_API_UPSTREAM'] ?? 'http://127.0.0.1:8080'

/**
 * Custom root document for the sandbox domain.
 *
 * The stock `/__web_preview` shell is an empty white page until `lynx-view`
 * finishes loading (`display: none` by default). When decode/WASM fails the
 * user only ever sees blank white. This shell:
 *   1. paints a visible boot UI immediately
 *   2. loads web-core and mounts lynx-view with an absolute bundle URL
 *   3. surfaces load errors instead of staying silent
 *   4. injects `mutoposApiBase` so the client can call the same-origin API
 */
const ROOT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>MutoPOS</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #f2f4f8;
      color: #212734;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    #boot {
      position: fixed;
      inset: 0;
      z-index: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      pointer-events: none;
    }
    #boot .mark {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #2563eb;
      color: #fcfcfd;
      font-size: 15px;
      font-weight: 700;
    }
    #boot .text { font-size: 13px; color: #6a7385; }
    #boot .err {
      pointer-events: auto;
      max-width: 28rem;
      margin-top: 12px;
      padding: 12px 14px;
      background: #fff;
      border: 1px solid #dde2ea;
      color: #d92d20;
      font-size: 13px;
      white-space: pre-wrap;
      text-align: center;
    }
    /* Override stock web-core rule that keeps lynx-view hidden until first paint. */
    lynx-view {
      position: relative;
      z-index: 1;
      width: 100vw !important;
      height: 100vh !important;
      display: flex !important;
    }
  </style>
  <link href="/__web_preview/static/css/index.css" rel="stylesheet" />
  <script type="module">
    import '/__web_preview/static/js/index.js';

    const boot = document.getElementById('boot');
    const errEl = document.getElementById('boot-err');

    function showError(msg) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = msg;
      }
      const text = document.querySelector('#boot .text');
      if (text) text.textContent = 'Could not start MutoPOS';
    }

    function hideBoot() {
      if (boot) boot.style.display = 'none';
    }

    // Stock explorer auto-mounts lynx-view from ?casename=… and also when
    // missing. We always force an absolute bundle URL + API base.
    function mount() {
      let view = document.querySelector('lynx-view');
      if (!view) {
        view = document.createElement('lynx-view');
        document.body.appendChild(view);
      }
      view.style.cssText = 'width:100vw;height:100vh;display:flex;';
      try {
        view.globalProps = {
          ...(view.globalProps || {}),
          mutoposApiBase: location.origin,
        };
      } catch (e) {
        console.warn('[mutopos] globalProps failed', e);
      }
      view.addEventListener('error', (ev) => {
        const d = ev.detail || {};
        showError(d.error?.message || d.statusMessage || 'Lynx runtime error');
      });
      view.addEventListener('load', () => hideBoot());
      // Absolute path — relative "main.web.bundle" is fragile behind proxies.
      const url = '/main.web.bundle';
      if (view.url !== url) view.url = url;
      // If first frame never arrives, surface a timeout instead of infinite blank.
      setTimeout(() => {
        if (boot && boot.style.display !== 'none') {
          const shadowHasPage = !!(view.shadowRoot && view.shadowRoot.querySelector('[part="page"]'));
          if (!shadowHasPage) {
            showError(
              'Timed out waiting for the POS UI. Check the console for WASM/worker errors, then reload.',
            );
          } else {
            hideBoot();
          }
        }
      }, 15000);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      // Explorer module runs w() at import time; give it a tick then re-assert.
      queueMicrotask(mount);
    }
  </script>
</head>
<body>
  <div id="boot" aria-live="polite">
    <div class="mark">M</div>
    <div class="text">Loading MutoPOS…</div>
    <div id="boot-err" class="err" hidden></div>
  </div>
</body>
</html>
`

function proxyToApi(
  req: IncomingMessage,
  res: ServerResponse,
  targetBase: string,
): void {
  const url = req.url ?? '/'
  const target = new URL(url, targetBase)
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: target.host,
  }
  // Drop hop-by-hop / compression negotiation that can break binary-ish JSON.
  delete headers['accept-encoding']

  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    upRes => {
      res.statusCode = upRes.statusCode ?? 502
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (v !== undefined) res.setHeader(k, v)
      }
      // Allow the Lynx web worker (same origin) to read the response under COEP.
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
      upRes.pipe(res)
    },
  )
  upstream.on('error', err => {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        error: 'api_upstream_unreachable',
        message: err.message,
        upstream: targetBase,
      }),
    )
  })
  req.pipe(upstream)
}

/**
 * Sandbox web shell + same-origin API proxy + CORP headers for COEP.
 */
const sandboxWebShell: RsbuildPlugin = {
  name: 'mutopos:sandbox-web-shell',
  setup(api) {
    api.modifyRsbuildConfig(config => {
      const server = (config.server ??= {})
      // Same-origin API for the browser / web worker (see API_BASE above).
      server.proxy = {
        ...(typeof server.proxy === 'object' && !Array.isArray(server.proxy)
          ? server.proxy
          : {}),
        '/v1': { target: API_UPSTREAM, changeOrigin: true },
        '/healthz': { target: API_UPSTREAM, changeOrigin: true },
        '/readyz': { target: API_UPSTREAM, changeOrigin: true },
      }

      const dev = (config.dev ??= {})
      const existing = dev.setupMiddlewares
      dev.setupMiddlewares = [
        ...(existing === undefined
          ? []
          : Array.isArray(existing)
            ? existing
            : [existing]),
        middlewares => {
          // CORP on every response so COEP: require-corp (set by web-core
          // static middleware) can load the bundle / workers reliably.
          middlewares.unshift((req, res, next) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
            next()
          })

          middlewares.unshift((req, res, next) => {
            const raw = req.url ?? ''
            const pathOnly = raw.split('?')[0] ?? ''

            // Root → custom shell (not stock blank __web_preview).
            if (pathOnly === '/' || pathOnly === '') {
              const body = ROOT_HTML
              res.statusCode = 200
              res.setHeader('Content-Type', 'text/html; charset=utf-8')
              res.setHeader('Content-Length', Buffer.byteLength(body))
              // Match web-core isolation so SharedArrayBuffer / module workers work.
              res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
              res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
              res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
              res.end(body)
              return
            }

            // Fallback proxy if rsbuild proxy misses (some paths / methods).
            if (
              pathOnly === '/healthz' ||
              pathOnly === '/readyz' ||
              pathOnly.startsWith('/v1/')
            ) {
              proxyToApi(req, res, API_UPSTREAM)
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
      __API_BASE__: JSON.stringify(API_BASE),
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
    sandboxWebShell,
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
