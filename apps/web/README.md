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

### API origin

A Lynx bundle has no page origin, so the old `/api` Vite dev proxy cannot work
— the API base must be an absolute origin reachable **from the device**:

```bash
MUTOPOS_API_BASE=http://192.168.1.10:8080 npm run dev
```

It defaults to `http://127.0.0.1:8080` (fine for a simulator, not for a phone on
Wi-Fi). The value is inlined at build time as `__API_BASE__` through
`source.define` in `lynx.config.ts`.

> **Toolchain note:** `@lynx-js/tasm` (the bundle encoder) ships glibc-only
> native prebuilds, so `rspeedy build` does not run on musl distros such as
> Alpine. Use a glibc Linux or macOS toolchain.

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
