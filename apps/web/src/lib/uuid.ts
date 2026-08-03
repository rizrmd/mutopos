/**
 * RFC 4122 v4 ids.
 *
 * The `uuid` package is not usable here: it reaches for `crypto.getRandomValues`,
 * and PrimJS exposes no Web Crypto. Command ids only need to be collision-free
 * per device (they are the outbox idempotency key), so `Math.random` is enough.
 */

const HEX: string[] = []
for (let i = 0; i < 256; i++) {
  HEX.push((i + 0x100).toString(16).slice(1))
}

export function uuidv4(): string {
  const b = new Array<number>(16)
  for (let i = 0; i < 16; i++) {
    b[i] = Math.floor(Math.random() * 256)
  }
  // Version 4 + RFC 4122 variant bits.
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80

  return (
    HEX[b[0]!]! +
    HEX[b[1]!]! +
    HEX[b[2]!]! +
    HEX[b[3]!]! +
    '-' +
    HEX[b[4]!]! +
    HEX[b[5]!]! +
    '-' +
    HEX[b[6]!]! +
    HEX[b[7]!]! +
    '-' +
    HEX[b[8]!]! +
    HEX[b[9]!]! +
    '-' +
    HEX[b[10]!]! +
    HEX[b[11]!]! +
    HEX[b[12]!]! +
    HEX[b[13]!]! +
    HEX[b[14]!]! +
    HEX[b[15]!]!
  )
}
