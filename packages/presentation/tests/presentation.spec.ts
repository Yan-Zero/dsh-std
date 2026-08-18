import { describe, expect, it, vi } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import {
  API_VERSION,
  externalRedirectClient,
  externalRedirectImplementation,
  externalRedirectSupport,
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
import type { PresentationResult, UserInteractionHandler, UserInteractionRequest, UserInteractionValue } from '../src/index.js'

describe('@dsh-std/presentation', () => {
  it('registers independently negotiable operation kinds', () => {
    expect(protocols.map(protocol => protocol.kind)).toEqual([
      'OpenExternal', 'CopyText', 'Notification', 'UserInteraction', 'ExternalRedirect',
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

  it('announces an exact loopback redirect URI before returning structured query values', async () => {
    const exactRedirectUri = 'http://127.0.0.1:49152/callback/random'
    async function* progress() { yield { type: 'ready' as const, redirectUri: exactRedirectUri } }
    const invoke = vi.fn(() => ({
      invocationId: 'redirect-1',
      result: Promise.resolve({ status: 'submitted' as const, value: { query: { code: ['abc'], scope: ['one', 'two'] } } }),
      progress: progress(), cancel() {},
    }))
    const client = externalRedirectClient({ participantId: 'plugin', binding: () => undefined, invoke } as never, {
      invocationId: 'command-1', origin: 'example.plugin', nextRequestId: () => 'request-redirect',
    })
    const call = client.receive({ exactRedirectUri })
    await expect(call.ready).resolves.toEqual({ type: 'ready', redirectUri: exactRedirectUri })
    await expect(call.result).resolves.toEqual({ status: 'submitted', value: { query: { code: ['abc'], scope: ['one', 'two'] } } })
    expect(invoke).toHaveBeenCalledWith(externalRedirectSupport, 'receive', expect.objectContaining({
      requestId: 'request-redirect', mode: 'http-get', exactRedirectUri,
    }), undefined)
  })

  it('requires ExternalRedirect implementations to announce readiness before submission', async () => {
    const implementation = externalRedirectImplementation('tui', { receive: async () => ({ status: 'submitted', value: { query: { code: ['abc'] } } }) })
    await expect(implementation.handle('receive', {
      requestId: 'request-1', invocationId: 'invocation-1', origin: 'example.plugin', mode: 'http-get',
    }, { progress() {} } as never)).rejects.toThrow(/before announcing/u)
  })

  it('preserves an exact requested loopback redirect URI', async () => {
    const progress = vi.fn()
    const exactRedirectUri = 'http://127.0.0.1:1455/oauth/callback'
    const implementation = externalRedirectImplementation('tui', {
      receive: async (request, context) => {
        expect(request.exactRedirectUri).toBe(exactRedirectUri)
        context.progress({ type: 'ready', redirectUri: exactRedirectUri })
        return { status: 'submitted', value: { query: { code: ['abc'] } } }
      },
    })
    await expect(implementation.handle('receive', {
      requestId: 'request-exact', invocationId: 'invocation-exact', origin: 'example.plugin',
      mode: 'http-get', exactRedirectUri,
    }, { progress } as never)).resolves.toMatchObject({ status: 'submitted' })
    expect(progress).toHaveBeenCalledWith({ type: 'ready', redirectUri: exactRedirectUri })
  })

  it('rejects substitution of an exact redirect URI and permits an unavailable result', async () => {
    const mismatched = externalRedirectImplementation('tui', {
      receive: async (_request, context) => {
        context.progress({ type: 'ready', redirectUri: 'http://127.0.0.1:1456/oauth/callback' })
        return { status: 'submitted', value: { query: {} } }
      },
    })
    await expect(mismatched.handle('receive', {
      requestId: 'request-exact', invocationId: 'invocation-exact', origin: 'example.plugin',
      mode: 'http-get', exactRedirectUri: 'http://127.0.0.1:1455/oauth/callback',
    }, { progress() {} } as never)).rejects.toThrow(/exact requested redirect URI/u)

    const occupied = externalRedirectImplementation('tui', {
      receive: async () => ({ status: 'unavailable', reason: 'redirect-address-in-use' }),
    })
    await expect(occupied.handle('receive', {
      requestId: 'request-occupied', invocationId: 'invocation-occupied', origin: 'example.plugin',
      mode: 'http-get', exactRedirectUri: 'http://localhost:1455/oauth/callback',
    }, { progress() {} } as never)).resolves.toEqual({ status: 'unavailable', reason: 'redirect-address-in-use' })
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
    const interact = vi.fn(async (input: UserInteractionRequest): Promise<PresentationResult<UserInteractionValue>> => {
      if (input.kind === 'question') return { status: 'submitted', value: { answers: { method: 'browser' } } }
      if (input.kind === 'approval') return { status: 'submitted', value: { decision: 'approved' } }
      return { status: 'submitted', value: { secret: 'secret' } }
    })
    const implementation = userInteractionImplementation('tui', { operations: ['question'] }, {
      interact: interact as UserInteractionHandler['interact'],
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
