/**
 * Key/value persistence for Lynx.
 *
 * There is no `localStorage` and no IndexedDB here, and `@lynx-js/types` does
 * not declare a persistent store either — durable KV is a *host* capability.
 * So this module probes, in order:
 *
 *   1. `NativeModules.LocalStorageModule` — the conventional host module
 *      (LynxExplorer and most embedders ship it). Truly persistent.
 *   2. `lynx.setSessionStorageItem` / `getSessionStorageItem` — shared across
 *      LynxViews in the process, but lost when the host process dies.
 *   3. An in-memory `Map` — keeps the POS usable, loses data on reload.
 *
 * Everything is async so a host that answers through a callback fits the same
 * shape as one that answers synchronously.
 */

type LocalStorageModule = {
  setStorageItem?: (key: string, value: string) => void
  getStorageItem?: (
    key: string,
    callback?: (value: string | null) => void,
  ) => string | null | undefined
  removeStorageItem?: (key: string) => void
  clearStorage?: () => void
}

type SessionStorageLynx = {
  setSessionStorageItem?: (key: string, value: unknown) => void
  getSessionStorageItem?: (
    key: string,
    callback?: (value: unknown) => void,
  ) => unknown
}

export type StorageBackend = 'native' | 'session' | 'memory'

const memory = new Map<string, string>()
let backend: StorageBackend | null = null

function nativeModule(): LocalStorageModule | null {
  try {
    const mods = (
      globalThis as unknown as { NativeModules?: Record<string, unknown> }
    ).NativeModules
    const mod = mods?.['LocalStorageModule'] as LocalStorageModule | undefined
    if (mod && typeof mod.setStorageItem === 'function') return mod
  } catch {
    /* host does not expose NativeModules */
  }
  return null
}

function sessionLynx(): SessionStorageLynx | null {
  try {
    const l = (globalThis as unknown as { lynx?: SessionStorageLynx }).lynx
    if (l && typeof l.setSessionStorageItem === 'function') return l
  } catch {
    /* not running inside a Lynx host */
  }
  return null
}

/** Which backend is in use — surfaced in the UI so cashiers know if data sticks. */
export function storageBackend(): StorageBackend {
  if (backend) return backend
  backend = nativeModule() ? 'native' : sessionLynx() ? 'session' : 'memory'
  if (backend !== 'native') {
    console.warn(
      `[mutopos] no persistent host storage; using "${backend}" — ` +
        'local sales and the outbox will not survive an app restart',
    )
  }
  return backend
}

export async function getItem(key: string): Promise<string | null> {
  'background only'
  switch (storageBackend()) {
    case 'native': {
      const mod = nativeModule()
      if (!mod?.getStorageItem) return null
      return new Promise<string | null>((resolve) => {
        let settled = false
        const done = (v: unknown) => {
          if (settled) return
          settled = true
          resolve(typeof v === 'string' ? v : null)
        }
        try {
          // Some hosts return the value, others call back. Support both.
          const direct = mod.getStorageItem!(key, done)
          if (direct !== undefined) done(direct)
        } catch (err) {
          console.error('[mutopos] getStorageItem failed', err)
          done(null)
        }
      })
    }
    case 'session': {
      const l = sessionLynx()
      if (!l?.getSessionStorageItem) return null
      return new Promise<string | null>((resolve) => {
        let settled = false
        const done = (v: unknown) => {
          if (settled) return
          settled = true
          resolve(typeof v === 'string' ? v : null)
        }
        try {
          const direct = l.getSessionStorageItem!(key, done)
          if (direct !== undefined) done(direct)
        } catch (err) {
          console.error('[mutopos] getSessionStorageItem failed', err)
          done(null)
        }
      })
    }
    default:
      return memory.get(key) ?? null
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  'background only'
  switch (storageBackend()) {
    case 'native':
      nativeModule()?.setStorageItem?.(key, value)
      return
    case 'session':
      sessionLynx()?.setSessionStorageItem?.(key, value)
      return
    default:
      memory.set(key, value)
  }
}

export async function removeItem(key: string): Promise<void> {
  'background only'
  switch (storageBackend()) {
    case 'native': {
      const mod = nativeModule()
      if (mod?.removeStorageItem) mod.removeStorageItem(key)
      else mod?.setStorageItem?.(key, '')
      return
    }
    case 'session':
      sessionLynx()?.setSessionStorageItem?.(key, '')
      return
    default:
      memory.delete(key)
  }
}

/** Test / teardown helper — forces backend re-detection. */
export function resetStorageBackend(): void {
  backend = null
  memory.clear()
}
