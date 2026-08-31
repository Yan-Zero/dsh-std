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
    expect(protocol({ protocols: { agreement: client, client: () => ({}) } } as never, key)).toBe(1)
    expect(client).toHaveBeenCalledWith(key)
  })

  it('requires both negotiation and a live scoped client', () => {
    const fromAgreement = vi.fn(() => 'client')
    const key = defineProtocolKey({ apiVersion: 'example.dsh/v1alpha1', kind: 'Service' }, fromAgreement)
    const missingAgreement = { protocols: { agreement: () => undefined, client: () => ({}) } } as never
    const missingClient = { protocols: { agreement: () => agreement, client: () => undefined } } as never
    const available = { protocols: { agreement: () => agreement, client: () => ({}) } } as never

    expect(optionalProtocol(missingAgreement, key)).toEqual({ available: false })
    expect(optionalProtocol(missingClient, key)).toEqual({ available: false })
    expect(fromAgreement).not.toHaveBeenCalled()
    expect(optionalProtocol(available, key)).toEqual({ available: true, client: 'client' })
    expect(() => protocol(missingClient, key)).toThrow(/required protocol.*unavailable/)
    expect(() => protocol(available, { ...key } as never)).toThrow(/not created by defineProtocolKey/)
  })

  it('defines an optional facet snapshot without introducing a Host API', async () => {
    const facet = defineFacet(() => undefined, undefined, () => ({ state: 'active' }))
    expect(await facet.snapshot?.()).toEqual({ state: 'active' })
    expect(facet).not.toHaveProperty('mount')
  })
})
