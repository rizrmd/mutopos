# MutoPOS Client (`apps/web`)

**[LynxJS](https://lynxjs.org/) (ReactLynx) + Rspeedy** + TypeScript + **[TinyBase](https://tinybase.org/)** custom outbox.

One codebase renders natively on iOS / Android / HarmonyOS (and Lynx's web
target) — there is no DOM, no `window`, and no browser at runtime.

## Run

```bash
cd apps/web
npm install
npm run dev      # Rspeedy dev server; prints a QR code
npm run build
npm run preview
```

Scan the QR code with **LynxExplorer** (iOS/Android) to load the bundle.

### Sandbox dev server (rizky-mutopos.fural.space)

The sandbox reverse proxy targets this app's dev server on **port 3005**, so
the port is pinned in `lynx.config.ts` with `strictPort: true`: if 3005 is
taken, `rspeedy dev` fails loudly instead of silently moving to the next port
(which leaves the proxy pointing at a dead backend → HTTP 502). If startup
fails with "Port 3005 is occupied", kill the stale process holding it rather
than changing the port.

Inside the Fural sandbox the server should be started detached so it outlives
the agent session (the sandbox runs musl, so the gcompat loader path is needed
for `@lynx-js/tasm` — see toolchain note):

```bash
cd apps/web
LD_LIBRARY_PATH=$HOME/.local/gcompat/lib:$HOME/.local/gcompat/lib64 \
  setsid nohup npm run dev > $HOME/.local/logs/lynxjs-dev.log 2>&1 < /dev/null &
```

Open `https://rizky-mutopos.fural.space/` — `/` serves a custom web shell that
mounts `lynx-view` on `/main.web.bundle` (with a visible boot UI, not a blank
white page). The shell proxies `/v1`, `/healthz`, and `/readyz` to the Go API
(`MUTOPOS_API_UPSTREAM`, default `http://127.0.0.1:8080`) so the browser can
call the API same-origin over HTTPS.

### API origin

A Lynx bundle has no browser page origin by default, so the old Vite `/api`
proxy cannot work alone. Resolution order:

1. `MUTOPOS_API_BASE` at build time (absolute origin for LynxExplorer / phone)
2. Web shell injects `globalProps.mutoposApiBase = location.origin` (sandbox)
3. Fallback `http://127.0.0.1:8080` (local simulator)

```bash
# Phone on Wi-Fi talking to your laptop's API:
MUTOPOS_API_BASE=http://192.168.1.10:8080 npm run dev

# Sandbox browser (default): leave MUTOPOS_API_BASE unset; shell + proxy.
npm run dev
```

> **Toolchain note:** `@lynx-js/tasm` (the bundle encoder) ships glibc-only
> native prebuilds, so on musl distros (Alpine, the Fural sandbox) loading
> `lepus.node` fails with `ld-linux-x86-64.so.2: No such file or directory`.
> Either use a glibc Linux / macOS toolchain, or run under
> [gcompat](https://git.adelielinux.org/adelie/gcompat) installed in `$HOME`:
>
> ```bash
> LD_LIBRARY_PATH=$HOME/.local/gcompat/lib:$HOME/.local/gcompat/lib64 npm run dev
> ```
>
> The sandbox installs gcompat at `$HOME/.local/gcompat` via the organization
> runtime setup.

## Screens

| Screen | Route | Notes |
|--------|-------|--------|
| Login | `/login` | WA OTP stub |
| Checkout | `/` | Online sale + outbox sale, tender sheet |
| Items | `/catalog` | Product/category CRUD; caches to TinyBase |
| Transactions | `/receipts`, `/receipts/:id` | Server list + local TinyBase sales |

Staff clock-in is a full-screen passcode gate over the shell
(`src/components/StaffPasscodeScreen.tsx`).

## Offline / outbox

See root [README — Offline outbox](../../README.md#offline-outbox-tinybase--go).

- `src/lib/db.ts` — TinyBase tables `outbox`, `products`, `sales`, `meta`
- `src/lib/storage.ts` — host key/value adapter the persister writes through
- `src/lib/outbox.ts` — worker pushes `POST /v1/commands`
- Checkout offline / API failure → local write, then background sync

## What Lynx changes versus the browser

The domain logic (API client, outbox, TinyBase repositories, session) is
unchanged. The platform seams are:

| Browser API | Lynx replacement |
|-------------|------------------|
| `div` / `span` / `button` / `img` | `<view>` / `<text>` / `<image>`; **all text must sit inside `<text>`** |
| `onClick`, `onChange` | `bindtap`, `bindinput` (`e.detail.value`) |
| `overflow: auto` | `<scroll-view scroll-orientation="vertical\|horizontal">` |
| Controlled `<input value>` | Lynx `<input>` is uncontrolled (`default-value`); `ui/TextField` remounts it on external changes |
| `react-router-dom` `BrowserRouter`, `Link`, `NavLink` | `react-router` v6 `MemoryRouter` + `useNavigate` on a tappable `<view>` |
| Tailwind v4 + shadcn/ui | hand-written CSS in `src/styles/` (`@lynx-js/tailwind-preset` is Tailwind v3 only) |
| `lucide-react` SVG components | `ui/Icon` renders Lynx `<svg content={…}>` with Lucide path data |
| `localStorage`, IndexedDB persister | `lib/storage.ts` → `NativeModules.LocalStorageModule` → session storage → memory |
| `navigator.onLine`, `online` event | `lib/net.ts` — reachability inferred from API traffic |
| `Intl.NumberFormat`, `toLocaleTimeString` | `lib/format.ts` (PrimJS has no dependable ECMA-402) |
| `crypto.randomUUID` / `uuid` pkg | `lib/uuid.ts` |
| `window` keydown listener on the PIN pad | on-screen pad only (Lynx has no key events) |
| `<select>` for business/outlet | tappable option rows in the sidebar |

Event handlers and side-effecting helpers carry the `'background only'`
directive: Lynx renders on the main thread and runs everything else on the
background thread.
