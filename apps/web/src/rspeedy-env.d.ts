/// <reference types="@lynx-js/rspeedy/client" />

/**
 * Absolute origin of the Go API, injected at build time by `source.define`
 * in `lynx.config.ts` (set `MUTOPOS_API_BASE` to override).
 *
 * Lynx bundles run inside a host app, not a web origin, so relative `/api`
 * URLs (the old Vite dev-proxy setup) are not usable.
 */
declare global {
  const __API_BASE__: string
}

declare module '@lynx-js/types' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GlobalProps {
    /**
     * Host-provided properties, read through `lynx.__globalProps`.
     * MutoPOS does not require any yet.
     */
  }
}

export {}
