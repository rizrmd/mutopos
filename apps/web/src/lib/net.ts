/**
 * Connectivity state.
 *
 * `navigator.onLine` and the `online` / `offline` / `visibilitychange` events
 * do not exist in Lynx. Reachability is instead inferred from the API calls the
 * app already makes: a completed HTTP response means online, a transport-level
 * failure means offline. That is a better signal than `navigator.onLine` was
 * anyway — it tracks whether *the API* is reachable, not whether a radio is on.
 */

type Listener = (online: boolean) => void

let online = true
const listeners = new Set<Listener>()

function emit() {
  for (const fn of listeners) fn(online)
}

export function isOnline(): boolean {
  return online
}

/** A request reached the server (any status, including 4xx/5xx). */
export function markReachable(): void {
  if (!online) {
    online = true
    emit()
  }
}

/** A request failed at the transport layer (DNS, refused, timeout). */
export function markUnreachable(): void {
  if (online) {
    online = false
    emit()
  }
}

export function subscribeOnline(fn: Listener): () => void {
  listeners.add(fn)
  fn(online)
  return () => {
    listeners.delete(fn)
  }
}

/** True for errors that mean "never left the device", not "server said no". */
export function isTransportError(err: unknown): boolean {
  return !(
    err &&
    typeof err === 'object' &&
    'status' in err &&
    Number((err as { status: unknown }).status) > 0
  )
}
