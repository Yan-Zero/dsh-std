import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import { StandardEndpointRuntime, defineCapabilityProtocol, resolveConnection } from '../src/index.js'
import { deterministicCbor, planDigest, sha256Hex } from '../src/digest.js'

const service = Object.freeze({ apiVersion: 'example.dsh/v1alpha1', kind: 'Echo' })

function protocols() {
  const catalog = new ProtocolCatalog({ name: 'digest-test', version: '1.0.0' })
  catalog.register(defineCapabilityProtocol(service))
  return catalog
}

function offers() {
  const left = new StandardEndpointRuntime({ id: 'client', instanceId: 'client-1' })
  left.register({ declaration: defineProtocolDeclaration({
    participant: { id: 'client/consumer' }, requires: [service],
  }) })
  const right = new StandardEndpointRuntime({ id: 'host', instanceId: 'host-1' })
  right.register({ declaration: defineProtocolDeclaration({
    participant: { id: 'host/provider' }, supports: [service],
  }) })
  return { left: left.offer, right: right.offer }
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

describe('plan digest', () => {
  it('hashes the digest-stripped agreement with SHA-256 over deterministic CBOR', () => {
    const { left, right } = offers()
    const plan = resolveConnection(left, right, { connectionId: 'connection-1', revision: 1, protocols: protocols() })
    expect(plan.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    const { digest, ...stripped } = plan
    expect(planDigest(stripped)).toBe(digest)
    expect(digest).toBe(`sha256:${createHash('sha256').update(deterministicCbor(stripped)).digest('hex')}`)
  })

  it('is stable across recomputation and across independently constructed inputs in the same order', () => {
    const first = offers()
    const second = offers()
    const coordinates = { connectionId: 'connection-1', revision: 1 }
    const initiator = resolveConnection(first.left, first.right, { ...coordinates, protocols: protocols() })
    const responder = resolveConnection(second.left, second.right, { ...coordinates, protocols: protocols() })
    expect(responder.digest).toBe(initiator.digest)
    expect(resolveConnection(first.left, first.right, { ...coordinates, protocols: protocols() }).digest).toBe(initiator.digest)
  })

  it('covers the full agreement: plans differing only in negotiation outcome differ in digest', () => {
    const { left, right } = offers()
    const ambiguous = new StandardEndpointRuntime({ id: 'host', instanceId: 'host-1' })
    ambiguous.register({ declaration: defineProtocolDeclaration({
      participant: { id: 'host/provider' }, supports: [service],
    }) })
    ambiguous.register({ declaration: defineProtocolDeclaration({
      participant: { id: 'host/second-provider' }, supports: [service],
    }) })
    const clean = resolveConnection(left, right, { connectionId: 'connection-1', revision: 1, protocols: protocols() })
    const conflicted = resolveConnection(left, ambiguous.offer, { connectionId: 'connection-1', revision: 1, protocols: protocols() })
    expect(conflicted.compatible).toBe(false)
    expect(conflicted.digest).not.toBe(clean.digest)
  })
})

describe('deterministic CBOR subset', () => {
  it('matches RFC 8949 encodings for supported values', () => {
    const vectors: readonly [unknown, string][] = [
      [0, '00'],
      [23, '17'],
      [24, '1818'],
      [255, '18ff'],
      [256, '190100'],
      [65536, '1a00010000'],
      [4294967296, '1b0000000100000000'],
      [Number.MAX_SAFE_INTEGER, '1b001fffffffffffff'],
      [-1, '20'],
      [-24, '37'],
      [-25, '3818'],
      [-4294967297, '3b0000000100000000'],
      [Number.MIN_SAFE_INTEGER, '3b001ffffffffffffe'],
      [true, 'f5'],
      [false, 'f4'],
      [null, 'f6'],
      ['', '60'],
      ['IETF', '6449455446'],
      ['ü', '62c3bc'],
      ['水', '63e6b0b4'],
      ['\u{10151}', '64f0908591'],
      [[], '80'],
      [[1, [2, 3]], '8201820203'],
      [{}, 'a0'],
      [{ a: 1, b: [2, 3] }, 'a26161016162820203'],
    ]
    for (const [value, expected] of vectors) expect(hex(deterministicCbor(value)), JSON.stringify(value)).toBe(expected)
  })

  it('sorts map keys bytewise by their encodings, shorter keys first', () => {
    expect(hex(deterministicCbor({ aa: 1, b: 2 }))).toBe('a2616202626161' + '01')
  })

  it('drops undefined-valued map properties the way a JSON wire would', () => {
    expect(hex(deterministicCbor({ spec: undefined }))).toBe(hex(deterministicCbor({})))
    expect(hex(deterministicCbor({ kind: 'Echo', spec: undefined }))).toBe(hex(deterministicCbor({ kind: 'Echo' })))
  })

  it('rejects undefined array elements instead of colliding with the empty array', () => {
    expect(hex(deterministicCbor([]))).toBe('80')
    expect(() => deterministicCbor([undefined])).toThrow(TypeError)
    expect(() => deterministicCbor([undefined])).toThrow('/0')
  })

  it('rejects values outside the subset with the offending path', () => {
    expect(() => deterministicCbor(undefined)).toThrow(TypeError)
    expect(() => deterministicCbor(1.5)).toThrow('must be a safe integer')
    expect(() => deterministicCbor(Number.NaN)).toThrow(TypeError)
    expect(() => deterministicCbor(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError)
    expect(() => deterministicCbor({ nested: { value: 2 ** 60 } })).toThrow('/nested/value')
    expect(() => deterministicCbor(new Date(0))).toThrow('non-plain Date object')
    expect(() => deterministicCbor(new Map())).toThrow(TypeError)
    expect(() => deterministicCbor(10n)).toThrow(TypeError)
    expect(() => deterministicCbor('\ud800')).toThrow('unpaired surrogate')
    expect(() => deterministicCbor({ text: 'ok\udfff' })).toThrow('/text')
  })

  it('accepts null-prototype objects as maps', () => {
    const bare: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    bare.a = 1
    expect(hex(deterministicCbor(bare))).toBe(hex(deterministicCbor({ a: 1 })))
  })
})

describe('pure SHA-256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })

  it('matches node:crypto across block-boundary and random lengths', () => {
    const lengths = [0, 1, 31, 55, 56, 57, 63, 64, 65, 127, 128, 1000, ...Array.from({ length: 32 }, () => Math.floor(Math.random() * 2048))]
    for (const length of lengths) {
      const input = new Uint8Array(randomBytes(length))
      expect(sha256Hex(input), `length ${String(length)}`).toBe(createHash('sha256').update(input).digest('hex'))
    }
  })
})
