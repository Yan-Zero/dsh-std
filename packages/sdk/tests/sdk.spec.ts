import { describe, expect, it, vi } from 'vitest'
import { defineFacet, defineProtocolKey, optionalProtocol, protocol } from '../src/index.js'

const agreement = Object.freeze({
  apiVersion: 'example.dsh/v1alpha1', kind: 'Service', participants: ['consumer', 'provider'], issues: [], agreement: { value: 1 },
})

describe('@dsh-std/sdk', () => {
  it('converts only an agreement issued by the activation context', () => {
    const client = vi.fn(() => agreement)
    const key = defineProtocolKey(
      { apiVersion: 'example.dsh/v1alpha1', kind: 'Service' },
      value => (value.agreement as { value: number }).value,
    )
    expect(protocol({ protocols: { client } } as never, key)).toBe(1)
    expect(client).toHaveBeenCalledWith(key)
  })

  it('keeps unavailable optional protocols explicit and rejects structural fake keys', () => {
    const context = { protocols: { client: () => undefined } } as never
    const key = defineProtocolKey({ apiVersion: 'example.dsh/v1alpha1', kind: 'Service' }, () => 'client')
    expect(optionalProtocol(context, key)).toEqual({ available: false })
    expect(() => protocol(context, { ...key } as never)).toThrow(/not created by defineProtocolKey/)
  })

  it('defines an optional facet snapshot without introducing a Host API', async () => {
    const facet = defineFacet(() => undefined, undefined, () => ({ state: 'active' }))
    expect(await facet.snapshot?.()).toEqual({ state: 'active' })
    expect(facet).not.toHaveProperty('mount')
  })
})
