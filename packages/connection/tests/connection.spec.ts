import { describe, expect, it } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import {
  ConnectionBroker,
  ConnectionInvocationError,
  StandardEndpointRuntime,
  defineCapabilityProtocol,
  resolveConnection,
} from '../src/index.js'
import { MemoryConnectionEndpoint, createMemoryConnectionPair } from '../src/memory.js'

const service = Object.freeze({ apiVersion: 'example.dsh/v1alpha1', kind: 'Echo' })

function protocols() {
  const catalog = new ProtocolCatalog({ name: 'connection-test', version: '1.0.0' })
  catalog.register(defineCapabilityProtocol(service))
  return catalog
}

function endpoints() {
  const left = new StandardEndpointRuntime({ id: 'client', instanceId: 'client-1' })
  left.register({ declaration: defineProtocolDeclaration({
    participant: { id: 'client/consumer' }, requires: [service],
  }) })
  const right = new StandardEndpointRuntime({ id: 'host', instanceId: 'host-1' })
  right.register({
    declaration: defineProtocolDeclaration({ participant: { id: 'host/provider' }, supports: [service] }),
    implementations: [{
      participantId: 'host/provider', protocol: service,
      handle(_operation, input) {
        if (typeof input !== 'object' || input === null || !('text' in input)) throw new TypeError('text is required')
        return { text: String((input as { text: unknown }).text) }
      },
    }],
  })
  return { left, right }
}

describe('@dsh-std/connection', () => {
  it('offers only live participant declarations, without manifests or plugin registries', () => {
    const { left } = endpoints()
    expect(left.offer).toMatchObject({
      kind: 'ConnectionOffer', revision: 1,
      declarations: [{ participant: { id: 'client/consumer' }, requires: [service] }],
    })
    expect(left.offer).not.toHaveProperty('registry')
  })

  it('lets protocol definitions produce connection bindings', () => {
    const { left, right } = endpoints()
    const plan = resolveConnection(left.offer, right.offer, {
      connectionId: 'connection-1', revision: 1, protocols: protocols(),
    })
    expect(plan).toMatchObject({
      kind: 'ConnectionAgreement', compatible: true,
      digest: expect.stringMatching(/^fnv1a32:/),
      protocols: [{ kind: 'Echo', agreement: { kind: 'CapabilityBindings' } }],
      bindings: [{
        consumer: { participantId: 'client/consumer' },
        provider: { participantId: 'host/provider' },
        requirement: service,
        support: service,
      }],
    })
  })

  it('does not satisfy a connection requirement from the consumer endpoint itself', () => {
    const { left, right } = endpoints()
    left.register({ declaration: defineProtocolDeclaration({
      participant: { id: 'client/local-provider' }, supports: [service],
    }) })
    const plan = resolveConnection(left.offer, right.offer, {
      connectionId: 'connection-1', revision: 1, protocols: protocols(),
    })
    expect(plan.compatible).toBe(true)
    expect(plan.bindings).toEqual([expect.objectContaining({
      consumer: expect.objectContaining({ participantId: 'client/consumer' }),
      provider: expect.objectContaining({ participantId: 'host/provider' }),
    })])
  })

  it('reports ambiguity instead of selecting by registration order', () => {
    const { left, right } = endpoints()
    right.register({ declaration: defineProtocolDeclaration({
      participant: { id: 'host/second-provider' }, supports: [service],
    }) })
    const plan = resolveConnection(left.offer, right.offer, {
      connectionId: 'connection-1', revision: 1, protocols: protocols(),
    })
    expect(plan).toMatchObject({ compatible: false, issues: [{ code: 'support-ambiguous' }] })
  })

  it('dispatches through a consumer-scoped in-memory client', async () => {
    const { left, right } = endpoints()
    const pair = createMemoryConnectionPair(
      new MemoryConnectionEndpoint(left.offer),
      new MemoryConnectionEndpoint(right.offer),
      { connectionId: 'memory-1', revision: 1, protocols: protocols() },
    )
    const remote = new MemoryConnectionEndpoint(right.offer)
    remote.register({ participantId: 'host/provider', protocol: service, handle: (_operation, input) => input })
    const callable = createMemoryConnectionPair(
      new MemoryConnectionEndpoint(left.offer), remote,
      { connectionId: 'memory-2', revision: 1, protocols: protocols() },
    )
    expect(pair.plan.compatible).toBe(true)
    await expect(callable.left.client('client/consumer').invoke(service, 'echo', { text: 'hello' }).result).resolves.toEqual({ text: 'hello' })
  })

  it('revokes calls when a connection closes', async () => {
    const { left, right } = endpoints()
    const remote = new MemoryConnectionEndpoint(right.offer)
    remote.register({
      participantId: 'host/provider',
      protocol: service,
      handle: async (_operation: string, _input: unknown) => await new Promise<never>(() => undefined),
    })
    const pair = createMemoryConnectionPair(new MemoryConnectionEndpoint(left.offer), remote, {
      connectionId: 'memory-1', revision: 1, protocols: protocols(),
    })
    const client = pair.left.client('client/consumer')
    expect(client.binding(service)).toBeDefined()
    const call = client.invoke(service, 'wait', {})
    pair.close()
    await expect(call.result).rejects.toMatchObject({ code: 'connection-closed' })
    expect(client.binding(service)).toBeUndefined()
    expect(() => pair.left.client('client/consumer').invoke(service, 'echo', {})).toThrow(ConnectionInvocationError)
  })

  it('keeps connector selection implementation-neutral and rejects ambiguity', async () => {
    const broker = new ConnectionBroker()
    const { left } = endpoints()
    for (const id of ['example.first', 'example.second']) broker.register({
      id,
      supports: target => target.uri.startsWith('test:'),
      connect: async () => { throw new Error('not reached') },
    })
    await expect(broker.connect({ target: { uri: 'test://host' }, local: left })).rejects.toMatchObject({
      code: 'implementation-ambiguous', implementations: ['example.first', 'example.second'],
    })
  })
})
