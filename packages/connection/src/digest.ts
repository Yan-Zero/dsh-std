import type { ConnectionPlan } from './model.js'

/**
 * Plan digest per docs/proposals/connection-wire.zh.md: SHA-256 over the deterministic CBOR
 * encoding of the digest-stripped agreement. Both connection parties recompute the digest
 * independently from their own negotiation result and compare for equality before accepting a plan.
 */

const UTF8 = new TextEncoder()

/** Matches only unpaired surrogates: under the `u` flag a well-formed pair is one astral code point. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u

/**
 * Computes the plan digest of an agreement without its `digest` field, as `sha256:` followed by
 * 64 lowercase hex digits. Protocol agreements inside the plan must consist of JSON-like data
 * (safe integers, well-formed strings, booleans, null, arrays, plain objects); anything else
 * throws a TypeError naming the offending path.
 */
export function planDigest(agreement: Omit<ConnectionPlan, 'digest'>): string {
  return `sha256:${sha256Hex(deterministicCbor(agreement))}`
}

/**
 * Encodes a value into the RFC 8949 Core Deterministic Encoding subset the wire profile pins:
 * shortest-form integers, definite lengths, and map keys sorted bytewise by their encodings.
 * Own map properties whose value is `undefined` are dropped before encoding — the same projection
 * `JSON.stringify` gives the agreement on a JSON wire. Every other `undefined`, non-integer or
 * unsafe number, unpaired surrogate, or non-plain object throws a TypeError instead of colliding.
 */
export function deterministicCbor(value: unknown): Uint8Array {
  const bytes: number[] = []
  encodeValue(value, bytes, '/')
  return Uint8Array.from(bytes)
}

function encodeValue(value: unknown, bytes: number[], path: string): void {
  if (value === null) {
    bytes.push(0xf6)
    return
  }
  if (typeof value === 'boolean') {
    bytes.push(value ? 0xf5 : 0xf4)
    return
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`plan digest input at ${path} must be a safe integer, got ${String(value)}`)
    if (value >= 0) encodeHead(0, value, bytes)
    else encodeHead(1, -1 - value, bytes)
    return
  }
  if (typeof value === 'string') {
    encodeText(value, bytes, path)
    return
  }
  if (Array.isArray(value)) {
    encodeHead(4, value.length, bytes)
    for (const [index, element] of value.entries()) encodeValue(element, bytes, child(path, String(index)))
    return
  }
  if (isPlainObject(value)) {
    encodeMap(value, bytes, path)
    return
  }
  throw new TypeError(`plan digest input at ${path} must be null, a boolean, a safe integer, a string, an array, or a plain object, got ${describe(value)}`)
}

function encodeMap(value: Record<string, unknown>, bytes: number[], path: string): void {
  const entries: { key: number[]; element: number[] }[] = []
  for (const [key, element] of Object.entries(value)) {
    if (element === undefined) continue
    const keyBytes: number[] = []
    encodeText(key, keyBytes, child(path, key))
    const elementBytes: number[] = []
    encodeValue(element, elementBytes, child(path, key))
    entries.push({ key: keyBytes, element: elementBytes })
  }
  entries.sort((left, right) => compareBytes(left.key, right.key))
  encodeHead(5, entries.length, bytes)
  for (const entry of entries) {
    for (const byte of entry.key) bytes.push(byte)
    for (const byte of entry.element) bytes.push(byte)
  }
}

function encodeText(value: string, bytes: number[], path: string): void {
  if (LONE_SURROGATE.test(value)) throw new TypeError(`plan digest input at ${path} contains an unpaired surrogate`)
  const encoded = UTF8.encode(value)
  encodeHead(3, encoded.length, bytes)
  for (const byte of encoded) bytes.push(byte)
}

function encodeHead(major: number, argument: number, bytes: number[]): void {
  const type = major << 5
  if (argument < 24) {
    bytes.push(type | argument)
  } else if (argument < 0x100) {
    bytes.push(type | 24, argument)
  } else if (argument < 0x10000) {
    bytes.push(type | 25, argument >>> 8, argument & 0xff)
  } else if (argument < 0x100000000) {
    bytes.push(type | 26, (argument >>> 24) & 0xff, (argument >>> 16) & 0xff, (argument >>> 8) & 0xff, argument & 0xff)
  } else {
    const high = Math.floor(argument / 0x100000000)
    const low = argument % 0x100000000
    bytes.push(type | 27, (high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff, (low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff)
  }
}

function compareBytes(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const delta = left[index]! - right[index]!
    if (delta !== 0) return delta
  }
  return left.length - right.length
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function describe(value: unknown): string {
  if (typeof value !== 'object' || value === null) return typeof value
  const name: unknown = Object.getPrototypeOf(value)?.constructor?.name
  return typeof name === 'string' && name !== '' ? `a non-plain ${name} object` : 'a non-plain object'
}

function child(path: string, segment: string): string {
  return path === '/' ? `/${segment}` : `${path}/${segment}`
}

const SHA256_INITIAL = Uint32Array.of(
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
)

const SHA256_ROUND = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
)

/** Pure SHA-256 (FIPS 180-4) over the input bytes, as 64 lowercase hex digits. Keeps the package free of platform crypto so neutral-platform builds stay dependency-free. */
export function sha256Hex(input: Uint8Array): string {
  const padded = new Uint8Array((((input.length + 8) >> 6) + 1) * 64)
  padded.set(input)
  padded[input.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(input.length / 0x20000000))
  view.setUint32(padded.length - 4, (input.length << 3) >>> 0)
  const state = Uint32Array.from(SHA256_INITIAL)
  const schedule = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) schedule[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index += 1) {
      const early = schedule[index - 15]!
      const late = schedule[index - 2]!
      const sigma0 = rotr(early, 7) ^ rotr(early, 18) ^ (early >>> 3)
      const sigma1 = rotr(late, 17) ^ rotr(late, 19) ^ (late >>> 10)
      schedule[index] = (schedule[index - 16]! + sigma0 + schedule[index - 7]! + sigma1) >>> 0
    }
    let a = state[0]!
    let b = state[1]!
    let c = state[2]!
    let d = state[3]!
    let e = state[4]!
    let f = state[5]!
    let g = state[6]!
    let h = state[7]!
    for (let index = 0; index < 64; index += 1) {
      const temp1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_ROUND[index]! + schedule[index]!) >>> 0
      const temp2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    state[0] = (state[0]! + a) >>> 0
    state[1] = (state[1]! + b) >>> 0
    state[2] = (state[2]! + c) >>> 0
    state[3] = (state[3]! + d) >>> 0
    state[4] = (state[4]! + e) >>> 0
    state[5] = (state[5]! + f) >>> 0
    state[6] = (state[6]! + g) >>> 0
    state[7] = (state[7]! + h) >>> 0
  }
  return [...state].map(word => word.toString(16).padStart(8, '0')).join('')
}

function rotr(value: number, count: number): number {
  return ((value >>> count) | (value << (32 - count))) >>> 0
}
