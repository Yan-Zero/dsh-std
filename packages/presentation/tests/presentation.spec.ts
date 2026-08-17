import { describe, expect, it, vi } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import {
  API_VERSION,
  openExternalClient,
  openExternalProtocol,
  openExternalSupport,
  presentationClients,
  protocols,
  userInteractionImplementation,
  userInteractionProtocol,
  userInteractionSupport,
  validatePresentationDescriptor,
  validateUserInteractionRequest,
} from '../src/index.js'

describe('@dsh-std/presentation', () => {
  it('registers independently negotiable operation kinds', () => {
    expect(protocols.map(protocol => protocol.kind)).toEqual([
      'OpenExternal', 'CopyText', 'Notification', 'UserInteraction',
    ])
    expect(openExternalProtocol).toMatchObject({ apiVersion: API_VERSION, kind: 'OpenExternal' })
  })

  it('projects active agreements without inventing a snapshot protocol', () => {
    expect(() => validatePresentationDescriptor({
      clientId: 'tui:1',
      contracts: [openExternalSupport],
    })).not.toThrow()
    expect(() => validatePresentationDescriptor({
      clientId: 'tui:1',
      contracts: [openExternalSupport, openExternalSupport],
    })).toThrow(/duplicate contract/u)
  })

  it('wraps a negotiated capability in a typed OpenExternal client', async () => {
    const invoke = vi.fn(() => ({
      invocationId: 'presentation-1',
      result: Promise.resolve({ status: 'submitted', value: { accepted: true } }),
      progress: emptyProgress(),
      cancel() {},
    }))
    const client = openExternalClient({ participantId: 'plugin', binding: () => undefined, invoke } as never, {
      invocationId: 'command-1',
      origin: 'example.plugin',
      nextRequestId: () => 'request-1',
    })
    const result = await client.openExternal({
      uri: 'https://example.test/login',
    })
    expect(result).toEqual({ status: 'submitted', value: { accepted: true } })
    expect(invoke).toHaveBeenCalledWith(
      openExternalSupport,
      'openExternal',
      expect.objectContaining({ requestId: 'request-1', uri: 'https://example.test/login' }),
      undefined,
    )
  })

  it('exposes only clients backed by both the descriptor and a live binding', () => {
    const bound = { apiVersion: API_VERSION, kind: 'OpenExternal' }
    const clients = presentationClients({ clientId: 'tui:1', contracts: [bound, { apiVersion: API_VERSION, kind: 'Notification' }] }, {
      participantId: 'example.plugin',
      binding: reference => reference.kind === 'OpenExternal' ? {} as never : undefined,
      invoke: vi.fn(),
    }, {
      invocationId: 'command-1', origin: 'example.plugin', nextRequestId: () => 'request-1',
    })
    expect(clients.openExternal).toBeDefined()
    expect(clients.notification).toBeUndefined()
  })

  it('negotiates required and optional UserInteraction operations', () => {
    const catalog = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
    catalog.register(userInteractionProtocol)
    const consumer = defineProtocolDeclaration({
      participant: { id: 'plugin' },
      requires: [{
        apiVersion: API_VERSION,
        kind: 'UserInteraction',
        spec: { operations: ['question'], optionalOperations: ['approval'] },
      }],
    })
    const questionOnly = defineProtocolDeclaration({
      participant: { id: 'tui' },
      supports: [userInteractionSupport({ operations: ['question'] })],
    })
    expect(catalog.negotiate([consumer, questionOnly])).toMatchObject({
      compatible: true,
      issues: [{ code: 'optional-operation-missing', severity: 'warning' }],
    })
    const notificationOnly = defineProtocolDeclaration({
      participant: { id: 'other' },
      supports: [{ apiVersion: API_VERSION, kind: 'Notification' }],
    })
    expect(catalog.negotiate([consumer, notificationOnly])).toMatchObject({ compatible: false })
  })

  it('validates structured questions and provider results', async () => {
    const request = {
      requestId: 'request-2',
      invocationId: 'command-2',
      origin: 'example.plugin',
      kind: 'question' as const,
      fields: [{ id: 'method', kind: 'select' as const, label: 'Method', options: [{ id: 'browser', label: 'Browser' }] }],
    }
    expect(() => validateUserInteractionRequest(request)).not.toThrow()
    const implementation = userInteractionImplementation('tui', { operations: ['question'] }, {
      interact: vi.fn(async () => ({ status: 'submitted' as const, value: { answers: { method: 'browser' } } })),
    })
    await expect(implementation.handle('interact', request, {} as never)).resolves.toEqual({
      status: 'submitted', value: { answers: { method: 'browser' } },
    })
    await expect(implementation.handle('interact', {
      ...request,
      fields: [{ id: 'method', kind: 'select', label: 'Method', options: [{ id: 'device', label: 'Device' }] }],
    }, {} as never)).rejects.toThrow(/invalid option/u)
  })

})

async function* emptyProgress(): AsyncIterable<never> {}
