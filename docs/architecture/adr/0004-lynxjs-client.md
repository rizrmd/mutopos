# ADR 0004: LynxJS (ReactLynx) as the client runtime

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** MutoPOS task migration (web client → [LynxJS](https://lynxjs.org/))
- **Amends:** [ADR 0003](./0003-tinybase-default-local-store.md) (persistence mechanism only)

## Context

`apps/web` was a browser app: Vite + React 19 + react-router-dom + Tailwind v4
+ shadcn/ui, with TinyBase persisted to IndexedDB.

A POS runs on counter hardware — tablets and Android terminals — where a
browser shell costs first-paint time and interaction latency, and where the
device features a POS eventually needs (printers, cash drawers, card readers,
barcode scanners) are native capabilities rather than web APIs.

[Lynx](https://lynxjs.org/) is a cross-platform rendering engine that targets
iOS, Android, HarmonyOS and the web from one codebase, with a dual-thread
runtime (main thread renders the first frame; a background thread runs React).
ReactLynx keeps the React programming model on top of it.

## Decision

1. **`apps/web` is a ReactLynx application** built with **Rspeedy**
   (`@lynx-js/rspeedy`), entry `src/index.tsx`, config `lynx.config.ts`.
2. **Domain layers are unchanged.** The API client, outbox worker, TinyBase
   repositories and session provider keep their contracts; only the platform
   seams moved.
3. **Persistence** (amending ADR 0003 point 2): TinyBase persists through
   `createCustomPersister` over `src/lib/storage.ts`, which resolves the host's
   key/value store (`NativeModules.LocalStorageModule` → Lynx session storage →
   memory). `createIndexedDbPersister` is browser-only and no longer used. The
   tables and repository API are untouched.
4. **Connectivity** is inferred from API traffic (`src/lib/net.ts`) rather than
   `navigator.onLine`, which does not exist. This tracks whether *the API* is
   reachable, which is what the outbox actually needs.
5. **Routing** uses `react-router` v6 `MemoryRouter`. There is no browser
   history, and Lynx provides no `<Link>` / `<NavLink>`.
6. **Styling** is hand-written CSS with design tokens under `src/styles/`.
   Tailwind is dropped: `@lynx-js/tailwind-preset` supports Tailwind v3 only,
   and Lynx has no `:hover` / `:focus-visible` on native hosts.
7. `defaultDisplayLinear: false` and `enableCSSInheritance` are set in
   `pluginReactLynx` so the ported layout keeps web semantics (flex default,
   inherited typography).

## Consequences

### Positive

- Native rendering on the platforms a POS actually ships to, from one codebase.
- Native modules are now the extension path for printers, drawers and scanners.
- Storage is behind an explicit seam, so a host with a real database can be
  adopted without touching repositories.
- Money and time formatting no longer depend on the runtime's ECMA-402 support.

### Negative / tradeoffs

- **No browser deploy story.** Serving the POS at a URL now means building
  Lynx's web target and hosting it, not `vite build`.
- **Host-dependent persistence.** If an embedder exposes no
  `LocalStorageModule`, local sales and the outbox do not survive a restart.
  The app warns on startup and keeps selling.
- **`@lynx-js/tasm` ships glibc-only prebuilds**, so builds do not run on musl
  distros (Alpine).
- **The shadcn/ui component set is gone**; primitives are hand-rolled in
  `src/components/ui/`. Icons are Lucide *path data* rendered through Lynx's
  `<svg content>`, not Lucide components.
- **Inputs are uncontrolled.** Lynx `<input>` has `default-value`, not `value`;
  `ui/TextField` restores controlled semantics by remounting on external
  changes, which is a workaround rather than a platform guarantee.
- **No hardware keyboard on the PIN pad** — Lynx emits no key events.
- Locally cached browser data (IndexedDB) is not migrated; devices re-cache the
  catalog and may rotate their device key.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Stay on Vite + React, wrap in a WebView | The WebView latency and first-paint cost are what Lynx exists to avoid |
| React Native | Second component model and styling system; Lynx keeps CSS and the web mental model |
| PWA + Capacitor | Still a browser engine; native POS peripherals remain awkward |
| Keep Tailwind via `@lynx-js/tailwind-preset` | Requires downgrading Tailwind v4 → v3, and the preset covers a subset that native hosts render inconsistently |

## Related

- [Client local store](../local-store.md)
- [ADR 0001 — offline-first custom outbox](./0001-offline-first-custom-outbox.md)
- [ADR 0003 — TinyBase default](./0003-tinybase-default-local-store.md)
- [`apps/web/README.md`](../../../apps/web/README.md) — browser → Lynx API mapping
