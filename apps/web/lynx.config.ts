import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { defineConfig, type RsbuildPlugin } from '@lynx-js/rspeedy'

/**
 * Public HTTPS origin reachable from a physical phone when the dev server
 * is NOT on the same LAN as the device (Fural sandbox on a remote host).
 *
 * Priority:
 * 1. `MUTOPOS_PUBLIC_ORIGIN` (explicit override, e.g. https://example.com)
 * 2. `https://$FURAL_SANDBOX_DOMAIN` when injected by the Fural sandbox
 * 3. empty — local laptop / LAN workflows use interface IPs from Rspeedy
 *
 * When set, the QR schema rewrites the internal listen URL to this origin
 * so LynxExplorer on Android can load the bundle over the public reverse
 * proxy (*.fural.space → sandbox :3005). The same origin is also the
 * default API base so native fetch hits the same-origin API proxy.
 */
const PUBLIC_ORIGIN = (() => {
  const explicit = (process.env['MUTOPOS_PUBLIC_ORIGIN'] ?? '').replace(
    /\/+$/,
    '',
  )
  if (explicit) return explicit
  const domain = (process.env['FURAL_SANDBOX_DOMAIN'] ?? '').trim()
  if (domain) return `https://${domain.replace(/^https?:\/\//, '')}`
  return ''
})()

/**
 * Absolute API origin baked into the Lynx bundle via `__API_BASE__`.
 *
 * - Empty string: same-origin / host injection — web preview proxies `/v1`,
 *   `/healthz`, `/readyz` to the Go API. Correct for browser on the sandbox
 *   domain where `http://127.0.0.1:8080` would hit the visitor's machine.
 * - `MUTOPOS_API_BASE` explicit (e.g. `http://192.168.1.10:8080` for LAN).
 * - Else `PUBLIC_ORIGIN` when set (sandbox → Android path).
 */
const API_BASE = (
  process.env['MUTOPOS_API_BASE'] ??
  PUBLIC_ORIGIN ??
  ''
).replace(/\/+$/, '')

const API_UPSTREAM =
  process.env['MUTOPOS_API_UPSTREAM'] ?? 'http://127.0.0.1:8080'

/** Rewrite a Rspeedy listen URL onto the public origin (path + query kept). */
function toPublicUrl(url: string): string {
  if (!PUBLIC_ORIGIN) return url
  try {
    const src = new URL(url)
    const pub = new URL(PUBLIC_ORIGIN)
    // Use hostname + port (not host) so the internal :3005 listen port is
    // dropped — the public reverse proxy terminates TLS on 443 and forwards
    // to sandbox :3005. Leaving :3005 on the QR would make phones hit a
    // closed port on *.fural.space.
    src.protocol = pub.protocol
    src.hostname = pub.hostname
    src.port = pub.port
    return src.toString()
  } catch {
    return url
  }
}

function withFullscreen(url: string): string {
  try {
    const u = new URL(url)
    if (!u.searchParams.has('fullscreen')) {
      u.searchParams.set('fullscreen', 'true')
    }
    return u.toString()
  } catch {
    return url.includes('?') ? `${url}&fullscreen=true` : `${url}?fullscreen=true`
  }
}

/** Stock Lynx web-explorer static tree (wasm, workers, lynx-view host). */
const WEB_PREVIEW_ROOT = (() => {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve('@lynx-js/web-rsbuild-server-middleware')
  return path.join(path.dirname(pkg), '..', 'www')
})()

const WEB_PREVIEW_PREFIX = '/__web_preview'
const fileCache = new Map<string, string | Buffer>()

function isolationHeaders(res: ServerResponse): void {
  // SharedArrayBuffer + module workers need cross-origin isolation.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  // Lynx's stock middleware omits CORP; under COEP some browsers/workers are
  // strict about same-origin fetches. Always assert CORP ourselves.
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
}

function contentTypeFor(ext: string): string {
  switch (ext) {
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.html':
      return 'text/html; charset=utf-8'
    case '.wasm':
      return 'application/wasm'
    case '.json':
      return 'application/json'
    case '.map':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}

/**
 * Serve `/__web_preview/*` with full isolation headers.
 *
 * Rspeedy registers `@lynx-js/web-rsbuild-server-middleware` on the Connect
 * stack without CORP. We short-circuit those routes so every worker / wasm
 * response carries COOP + COEP + CORP.
 */
function tryServeWebPreview(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const raw = req.url ?? ''
  const pathOnly = (raw.split('?')[0] ?? '').replace(/\/+$/, '') || '/'
  if (
    pathOnly !== WEB_PREVIEW_PREFIX &&
    !pathOnly.startsWith(`${WEB_PREVIEW_PREFIX}/`)
  ) {
    return false
  }

  let relative =
    pathOnly === WEB_PREVIEW_PREFIX
      ? 'index.html'
      : pathOnly.slice(WEB_PREVIEW_PREFIX.length + 1)
  if (!relative || relative.endsWith('/')) {
    relative = `${relative}index.html`
  }
  // Prevent path escape outside www.
  const filePath = path.normalize(path.join(WEB_PREVIEW_ROOT, relative))
  if (
    !filePath.startsWith(WEB_PREVIEW_ROOT + path.sep) &&
    filePath !== WEB_PREVIEW_ROOT
  ) {
    res.statusCode = 403
    res.end('forbidden')
    return true
  }

  try {
    const ext = path.extname(filePath)
    let content = fileCache.get(filePath)
    if (content === undefined) {
      content =
        ext === '.wasm'
          ? fs.readFileSync(filePath)
          : fs.readFileSync(filePath, 'utf-8')
      if (typeof content === 'string') {
        // Same rewrite the stock middleware applies so chunk publicPath works.
        content = content.replaceAll(
          'http://lynx-web-core-mocked.localhost/',
          `${WEB_PREVIEW_PREFIX}/`,
        )
      }
      fileCache.set(filePath, content)
    }

    res.statusCode = 200
    res.setHeader('Content-Type', contentTypeFor(ext))
    res.setHeader('Content-Length', Buffer.byteLength(content))
    isolationHeaders(res)
    // Avoid Cloudflare/browser caching a CORP-less variant of workers/wasm.
    res.setHeader('Cache-Control', 'no-cache')
    res.end(content)
    return true
  } catch {
    return false
  }
}

/**
 * Custom root document for the sandbox domain.
 *
 * The stock `/__web_preview` shell is an empty white page until `lynx-view`
 * finishes loading (`display: none` by default). When decode/WASM fails the
 * user only ever sees blank white. This shell:
 *   1. paints a visible boot UI immediately
 *   2. loads web-core and mounts a fresh lynx-view with an absolute bundle URL
 *   3. surfaces load / isolation / worker errors instead of staying silent
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
      max-width: 32rem;
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
    // Surface worker / chunk failures the stock host swallows.
    const bootIssues = [];
    const OrigWorker = globalThis.Worker;
    if (typeof OrigWorker === 'function') {
      globalThis.Worker = class extends OrigWorker {
        constructor(scriptURL, options) {
          super(scriptURL, options);
          this.addEventListener('error', (ev) => {
            const msg = 'Worker failed: ' + (scriptURL && scriptURL.toString ? scriptURL.toString() : scriptURL) +
              (ev.message ? ' — ' + ev.message : '');
            console.error('[mutopos]', msg, ev);
            bootIssues.push(msg);
          });
        }
      };
    }

    window.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason;
      const msg = reason && reason.message ? reason.message : String(reason);
      console.error('[mutopos] unhandledrejection', reason);
      bootIssues.push(msg);
    });

    try {
      await import('/__web_preview/static/js/index.js');
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      bootIssues.push('Failed to load Lynx web runtime: ' + msg);
      console.error('[mutopos] web-core import failed', e);
    }

    const boot = document.getElementById('boot');
    const errEl = document.getElementById('boot-err');
    let settled = false;

    function showError(msg) {
      if (settled) return;
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = msg;
      }
      const text = document.querySelector('#boot .text');
      if (text) text.textContent = 'Could not start MutoPOS';
    }

    function hideBoot() {
      if (settled) return;
      settled = true;
      if (boot) boot.style.display = 'none';
    }

    function shadowReady(view) {
      const root = view && view.shadowRoot;
      if (!root) return false;
      if (root.querySelector('[part="page"]')) return true;
      // Some builds mark the page via lynx-tag before part is applied.
      if (root.querySelector('[lynx-tag="page"]')) return true;
      // Any non-link content in the shadow root means the host painted.
      for (const el of root.children) {
        if (el.tagName !== 'LINK' && el.tagName !== 'STYLE') return true;
      }
      return false;
    }

    function diagnostics(view) {
      const lines = [];
      lines.push('crossOriginIsolated=' + String(window.crossOriginIsolated));
      lines.push('Worker=' + (typeof Worker === 'function' ? 'yes' : 'no'));
      lines.push('WebAssembly=' + (typeof WebAssembly === 'object' ? 'yes' : 'no'));
      if (view) {
        lines.push('url=' + (view.url || '(none)'));
        lines.push('shadow=' + (view.shadowRoot ? 'open' : 'missing'));
        if (view.shadowRoot) {
          const kids = [...view.shadowRoot.children].map((c) => c.tagName).join(',');
          lines.push('shadowChildren=' + (kids || '(empty)'));
        }
      }
      if (bootIssues.length) {
        lines.push('issues: ' + bootIssues.slice(0, 4).join(' | '));
      }
      if (!window.crossOriginIsolated) {
        lines.push(
          'Cross-origin isolation is off — SharedArrayBuffer / Lynx workers cannot start. Hard-reload (Ctrl+Shift+R).',
        );
      }
      return lines.join('\\n');
    }

    async function mount() {
      try {
        if (customElements.get('lynx-view') === undefined) {
          await customElements.whenDefined('lynx-view');
        }
      } catch (e) {
        showError('Lynx custom element never registered.\\n' + diagnostics(null));
        return;
      }

      // Drop the stock explorer's empty auto-created lynx-view so we control
      // globalProps + url before the first render.
      for (const el of document.querySelectorAll('lynx-view')) {
        el.remove();
      }

      const view = document.createElement('lynx-view');
      view.style.cssText = 'width:100vw;height:100vh;display:flex;';
      try {
        view.globalProps = { mutoposApiBase: location.origin };
      } catch (e) {
        console.warn('[mutopos] globalProps failed', e);
      }

      view.addEventListener('error', (ev) => {
        const d = ev.detail || {};
        const msg =
          (d.error && d.error.message) ||
          d.statusMessage ||
          d.message ||
          'Lynx runtime error';
        showError(msg + '\\n' + diagnostics(view));
      });
      view.addEventListener('load', () => hideBoot());

      document.body.appendChild(view);

      // Absolute URL — relative "main.web.bundle" breaks behind some proxies.
      const url = new URL('/main.web.bundle', location.href).href;
      view.url = url;

      // Prefetch so the decode worker is less likely to race a cold cache.
      try {
        fetch(url, { headers: { Accept: 'application/octet-stream' } }).catch(() => {});
      } catch (_) { /* ignore */ }

      const started = Date.now();
      const timer = setInterval(() => {
        if (settled) {
          clearInterval(timer);
          return;
        }
        if (shadowReady(view)) {
          hideBoot();
          clearInterval(timer);
          return;
        }
        if (Date.now() - started > 20000) {
          clearInterval(timer);
          if (!settled) {
            showError(
              'Timed out waiting for the POS UI.\\n' +
                diagnostics(view) +
                '\\nCheck the console for WASM/worker errors, then hard-reload.',
            );
          }
        }
      }, 250);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { void mount(); });
    } else {
      void mount();
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

type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void

/** Shared request handler for root shell, preview assets, and API proxy. */
const sandboxRequestHandler: ConnectMiddleware = (req, res, next) => {
  const raw = req.url ?? ''
  let pathOnly = raw.split('?')[0] ?? ''
  // Some proxies forward absolute URLs.
  if (pathOnly.startsWith('http://') || pathOnly.startsWith('https://')) {
    try {
      pathOnly = new URL(pathOnly).pathname
    } catch {
      /* keep raw path */
    }
  }
  if (pathOnly.startsWith('//')) {
    pathOnly = pathOnly.slice(1)
  }

  // Root → custom shell (not stock blank __web_preview).
  if (pathOnly === '/' || pathOnly === '') {
    const body = ROOT_HTML
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    isolationHeaders(res)
    res.end(body)
    return
  }

  // Dev diagnostics for shell isolation (safe to leave; no secrets).
  if (pathOnly === '/__mutopos_debug') {
    const sample = path.join(
      WEB_PREVIEW_ROOT,
      'static/wasm/4c5aa2efc5.module.wasm',
    )
    const body = JSON.stringify(
      {
        webPreviewRoot: WEB_PREVIEW_ROOT,
        rootExists: fs.existsSync(WEB_PREVIEW_ROOT),
        sampleWasm: sample,
        sampleExists: fs.existsSync(sample),
        cacheSize: fileCache.size,
        publicOrigin: PUBLIC_ORIGIN || null,
        apiBase: API_BASE || null,
        apiUpstream: API_UPSTREAM,
      },
      null,
      2,
    )
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    isolationHeaders(res)
    res.end(body)
    return
  }

  // Android / LynxExplorer helper: public bundle URL when LAN is impossible
  // (Fural sandbox is remote). Open this page on a laptop or paste the URL
  // into LynxExplorer manually if the terminal QR is hard to scan.
  if (pathOnly === '/__android' || pathOnly === '/android') {
    const origin =
      PUBLIC_ORIGIN ||
      (() => {
        const host = req.headers['x-forwarded-host'] ?? req.headers.host
        const proto =
          (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
        return host ? `${proto}://${host}` : ''
      })()
    const bundle = origin
      ? withFullscreen(new URL('/main.lynx.bundle', origin).href)
      : '(set MUTOPOS_PUBLIC_ORIGIN or open via sandbox domain)'
    const api = API_BASE || origin || '(same origin via proxy)'
    const body = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MutoPOS → LynxExplorer</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem;line-height:1.45;color:#212734}
  code,pre{background:#f2f4f8;padding:.15rem .4rem;border-radius:4px;word-break:break-all}
  pre{padding:12px;overflow:auto}
  .hint{color:#6a7385;font-size:14px}
  h1{font-size:1.25rem}
</style>
</head><body>
<h1>Android preview (LynxExplorer)</h1>
<p class="hint">Sandbox is remote — phone does <strong>not</strong> need the same Wi‑Fi as the server. Use the public HTTPS URL below.</p>
<p><strong>Bundle URL</strong> (scan QR from <code>npm run dev</code>, or paste into LynxExplorer):</p>
<pre id="u">${bundle.replace(/</g, '&lt;')}</pre>
<p><strong>API base</strong> baked into the bundle:</p>
<pre>${String(api).replace(/</g, '&lt;')}</pre>
<ol>
  <li>Install <strong>LynxExplorer</strong> once (official host APK).</li>
  <li>Start API + <code>npm run dev</code> in the Fural sandbox (port 3005).</li>
  <li>Scan the terminal QR, or open the bundle URL above in Explorer.</li>
  <li>Web-only preview: open <code>/</code> on the sandbox domain (browser, not native).</li>
</ol>
<p class="hint">Debug JSON: <a href="/__mutopos_debug">/__mutopos_debug</a></p>
</body></html>`
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    isolationHeaders(res)
    res.end(body)
    return
  }

  // Own the Lynx web host assets so CORP is never missing.
  // Clone req with normalized url for the file server.
  if (
    pathOnly === WEB_PREVIEW_PREFIX ||
    pathOnly.startsWith(`${WEB_PREVIEW_PREFIX}/`)
  ) {
    const fakeReq = Object.create(req) as IncomingMessage
    fakeReq.url = pathOnly + (raw.includes('?') ? raw.slice(raw.indexOf('?')) : '')
    if (tryServeWebPreview(fakeReq, res)) {
      return
    }
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

  // Bundle also needs isolation-friendly CORP.
  if (
    pathOnly === '/main.web.bundle' ||
    pathOnly === '/main.lynx.bundle' ||
    pathOnly.endsWith('.web.bundle') ||
    pathOnly.endsWith('.lynx.bundle')
  ) {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  }

  next()
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
      // Default isolation headers for rsbuild-served assets (bundle, HMR, …).
      server.headers = {
        ...(typeof server.headers === 'object' && server.headers
          ? server.headers
          : {}),
        'Cross-Origin-Resource-Policy': 'same-origin',
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
          // CORP on every response that still goes through this stack.
          middlewares.unshift((req, res, next) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
            next()
          })
          middlewares.unshift(sandboxRequestHandler)
        },
      ]
    })

    // Rspeedy registers the stock web-preview middleware via
    // `server.middlewares.use(...)` in onBeforeStartDevServer — *after*
    // setupMiddlewares in some versions, which can leave CORP off. Prepend
    // our handler on the same Connect stack so we always win.
    api.onBeforeStartDevServer(({ server }) => {
      const app = server.middlewares as {
        use: (fn: ConnectMiddleware) => void
        stack?: Array<{ route: string; handle: ConnectMiddleware }>
      }
      if (Array.isArray(app.stack)) {
        app.stack.unshift({ route: '', handle: sandboxRequestHandler })
        app.stack.unshift({
          route: '',
          handle: (req, res, next) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
            next()
          },
        })
      } else {
        app.use(sandboxRequestHandler)
      }

      if (PUBLIC_ORIGIN) {
        // eslint-disable-next-line no-console
        console.log(
          [
            '',
            '[mutopos] Public origin (Android / remote phone — no shared LAN needed):',
            `  ${PUBLIC_ORIGIN}`,
            `  API base: ${API_BASE || '(same origin)'}`,
            `  LynxExplorer: ${withFullscreen(`${PUBLIC_ORIGIN}/main.lynx.bundle`)}`,
            `  Helper page: ${PUBLIC_ORIGIN}/__android`,
            '',
          ].join('\n'),
        )
      }
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
        // Rewrite listen URL → public HTTPS when running in Fural sandbox
        // so Android LynxExplorer can load the bundle without sharing LAN.
        // Local laptop: PUBLIC_ORIGIN empty → keep Rspeedy's LAN IP URLs.
        const target = withFullscreen(toPublicUrl(url))
        if (PUBLIC_ORIGIN) {
          return {
            // Prefer public first (default QR) for phone-on-cellular / remote.
            public: target,
            // Keep raw listen URL for debugging inside the sandbox netns.
            local: withFullscreen(url),
          }
        }
        return target
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
