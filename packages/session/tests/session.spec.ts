import { describe, expect, it, vi } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import { API_VERSION, validateSessionDescriptor } from '../src/index.js'
import { eventExtensionDefinition } from '../src/events.js'
import { CATALOG_KIND, sessionCatalog, sessionCatalogImplementation, sessionCatalogProtocol } from '../src/catalog.js'
import {
  HISTORY_KIND,
  sessionHistory,
  sessionHistoryImplementation,
  sessionHistoryProtocol,
  validateSessionEventEnvelope,
} from '../src/history.js'

const session = Object.freeze({ provider: 'provider', id: 'session-1' })
const descriptor = Object.freeze({ session, title: 'Example', state: 'available' as const, revision: 1 })

describe('@dsh-std/session shared model', () => {
  it('validates provider-scoped descriptors without Workspace membership', () => {
    expect(validateSessionDescriptor(descriptor)).toEqual(descriptor)
    expect(() => validateSessionDescriptor({ ...descriptor, workspace: { provider: 'workspace', id: 'one' } })).toThrow(/unknown field "workspace"/u)
  })

  it('requires replay semantics and keeps legacy schemas without a dialect readable', () => {
    expect(() => eventExtensionDefinition.validateSpec({
      description: 'Resolved provider request.', replay: 'required',
      schemaDialect: 'https://json-schema.org/draft/2020-12/schema', payloadSchema: { type: 'object' },
    })).not.toThrow()
    expect(() => eventExtensionDefinition.validateSpec({ description: 'Diagnostic.', replay: 'ignorable' })).not.toThrow()
    expect(() => eventExtensionDefinition.validateSpec({ description: 'Ambiguous.' })).toThrow(/replay/u)
    expect(() => eventExtensionDefinition.validateSpec({
      description: 'Missing dialect.', replay: 'required', payloadSchema: { type: 'object' },
    })).not.toThrow()
  })
})

describe('SessionCatalog', () => {
  const support = {
    sessionDomain: 'example.sessions', operations: ['list', 'get'] as const,
    mutationConcurrency: 'revision-checked' as const,
  }

  it('wraps typed calls and does not accept Workspace placement during create', () => {
    const invoke = vi.fn(() => call())
    const client = sessionCatalog({ participantId: 'client', binding: () => undefined, invoke } as never)
    client.list({ limit: 10 })
    expect(invoke).toHaveBeenCalledWith(
      { apiVersion: API_VERSION, kind: CATALOG_KIND }, 'list', { limit: 10 }, undefined,
    )
    expect(() => client.create({ requestId: 'request-1', workspace: { provider: 'workspace', id: 'one' } } as never))
      .toThrow(/unknown field "workspace"/u)
  })

  it('negotiates required operations, domain and mutation concurrency', () => {
    const protocols = new ProtocolCatalog({ name: 'session-test', version: '1.0.0' })
    protocols.register(sessionCatalogProtocol)
    const report = protocols.negotiate([
      defineProtocolDeclaration({ participant: { id: 'client' }, requires: [{
        apiVersion: API_VERSION, kind: CATALOG_KIND,
        spec: {
          operations: ['list'], optionalOperations: ['watch'],
          sessionDomain: 'example.sessions', mutationConcurrency: 'revision-checked',
        },
      }] }),
      defineProtocolDeclaration({ participant: { id: 'wrong' }, supports: [{
        apiVersion: API_VERSION, kind: CATALOG_KIND, spec: { ...support, sessionDomain: 'other.sessions' },
      }] }),
      defineProtocolDeclaration({ participant: { id: 'provider' }, supports: [{
        apiVersion: API_VERSION, kind: CATALOG_KIND, spec: support,
      }] }),
    ])
    expect(report.compatible).toBe(true)
    expect(report.issues).toEqual([expect.objectContaining({ code: 'optional-operation-missing' })])
    expect(report.protocols[0]?.agreement).toMatchObject({
      kind: 'CapabilityBindings', bindings: [{ consumer: 'client', provider: 'provider' }],
    })
  })

  it('validates provider outputs and rejects undeclared mutations', async () => {
    const implementation = sessionCatalogImplementation('provider', support, {
      list: () => ({ catalogRevision: 1, sessions: [descriptor] }), get: () => descriptor,
    })
    await expect(implementation.handle('list', {}, context())).resolves.toEqual({ catalogRevision: 1, sessions: [descriptor] })
    await expect(implementation.handle('rename', {}, context())).rejects.toThrow(/was not declared/u)
  })

  it('accepts partial providers and fails fast on a missing declared handler', () => {
    expect(() => sessionCatalogImplementation('provider', {
      sessionDomain: 'example.sessions', operations: ['create'], mutationConcurrency: 'serialized',
    }, {
      create: () => ({ session: descriptor }),
    })).not.toThrow()
    expect(() => sessionCatalogImplementation('provider', {
      sessionDomain: 'example.sessions', operations: ['create'], mutationConcurrency: 'serialized',
    }, {})).toThrow(/handler\.create is missing/u)
  })

  it('enforces provider scope, page limits and the negotiated mutation model', async () => {
    const implementation = sessionCatalogImplementation('provider', {
      sessionDomain: 'example.sessions', operations: ['list', 'get', 'rename'],
      mutationConcurrency: 'serialized', limits: { maxPageSize: 1 },
    }, {
      list: () => ({ catalogRevision: 1, sessions: [descriptor] }),
      get: () => descriptor,
      rename: () => descriptor,
    })
    await expect(implementation.handle('list', { limit: 2 }, context())).rejects.toThrow(/maximum/u)
    await expect(implementation.handle('get', { provider: 'other', id: 'session-1' }, context())).rejects.toThrow(/another provider/u)
    await expect(implementation.handle('rename', {
      session, title: 'Renamed', expectedRevision: 1,
    }, context())).rejects.toThrow(/serialized concurrency/u)
  })

  it('validates watch progress before delivery', async () => {
    const progress = vi.fn()
    const implementation = sessionCatalogImplementation('provider', {
      ...support, operations: ['list', 'get', 'watch'],
    }, {
      list: () => ({ catalogRevision: 1, sessions: [] }), get: () => undefined,
      watch: (_input, handlerContext) => {
        handlerContext.progress({
          type: 'ready', catalogRevision: 1,
        })
        handlerContext.progress({
          type: 'event', event: {
            type: 'session-created', beforeRevision: 1, afterRevision: 2, session: descriptor,
          },
        })
      },
    })
    await expect(implementation.handle('watch', {}, context(progress))).resolves.toBeUndefined()
    expect(progress).toHaveBeenNthCalledWith(1, { type: 'ready', catalogRevision: 1 })
    expect(progress).toHaveBeenNthCalledWith(2, {
      type: 'event', event: expect.objectContaining({ type: 'session-created', session: descriptor }),
    })

    const missingReady = sessionCatalogImplementation('provider', {
      ...support, operations: ['list', 'get', 'watch'],
    }, {
      list: () => ({ catalogRevision: 1, sessions: [] }), get: () => undefined,
      watch: () => undefined,
    })
    await expect(missingReady.handle('watch', {}, context())).rejects.toThrow(/before ready/u)
  })
})

describe('SessionHistory', () => {
  const support = { sessionDomain: 'example.sessions', operations: ['read', 'follow'] as const }

  it('wraps read and follow with provider-scoped cursors', () => {
    const invoke = vi.fn(() => call())
    const client = sessionHistory({ participantId: 'client', binding: () => undefined, invoke } as never)
    client.read({ session, after: 'cursor-1', direction: 'forward', limit: 20 })
    client.follow({ session, after: 'cursor-2' })
    expect(invoke).toHaveBeenNthCalledWith(
      1, { apiVersion: API_VERSION, kind: HISTORY_KIND }, 'read',
      { session, after: 'cursor-1', direction: 'forward', limit: 20 }, undefined,
    )
    expect(invoke).toHaveBeenNthCalledWith(
      2, { apiVersion: API_VERSION, kind: HISTORY_KIND }, 'follow', { session, after: 'cursor-2' }, undefined,
    )
  })

  it('selects history providers by domain and reports ambiguity without one', () => {
    const protocols = new ProtocolCatalog({ name: 'session-test', version: '1.0.0' })
    protocols.register(sessionHistoryProtocol)
    const providers = ['one', 'two'].map(domain => defineProtocolDeclaration({
      participant: { id: `provider-${domain}` }, supports: [{
        apiVersion: API_VERSION, kind: HISTORY_KIND, spec: { sessionDomain: domain, operations: ['read'] },
      }],
    }))
    const selected = protocols.negotiate([
      defineProtocolDeclaration({ participant: { id: 'client' }, requires: [{
        apiVersion: API_VERSION, kind: HISTORY_KIND, spec: { sessionDomain: 'two', operations: ['read'] },
      }] }),
      ...providers,
    ])
    expect(selected.protocols[0]?.agreement).toMatchObject({ bindings: [{ provider: 'provider-two' }] })

    const ambiguous = protocols.negotiate([
      defineProtocolDeclaration({ participant: { id: 'client' }, requires: [{
        apiVersion: API_VERSION, kind: HISTORY_KIND, spec: { operations: ['read'] },
      }] }),
      ...providers,
    ])
    expect(ambiguous).toMatchObject({ compatible: false, issues: [{ code: 'support-ambiguous' }] })
  })

  it('validates durable pages and follow progress without a second event surface', async () => {
    const event = Object.freeze({
      session, cursor: 'cursor-1', type: 'example/message', replay: 'required' as const, data: { text: 'hello' },
    })
    const progress = vi.fn()
    const implementation = sessionHistoryImplementation('provider', support, {
      read: () => ({ session, events: [event], first: 'cursor-1', last: 'cursor-1', hasMore: false }),
      follow: (_input, handlerContext) => {
        handlerContext.progress({ type: 'ready', session, boundary: 'cursor-1' })
        handlerContext.progress({ type: 'event', event })
      },
    })
    await expect(implementation.handle('read', { session }, context())).resolves.toMatchObject({ events: [event] })
    await expect(implementation.handle('follow', { session }, context(progress))).resolves.toBeUndefined()
    expect(progress).toHaveBeenNthCalledWith(1, { type: 'ready', session, boundary: 'cursor-1' })
    expect(progress).toHaveBeenNthCalledWith(2, { type: 'event', event })
    expect(() => validateSessionEventEnvelope({ ...event, type: 'not-namespaced' })).toThrow(/namespaced/u)
  })

  it('rejects follow events belonging to another Session', async () => {
    const implementation = sessionHistoryImplementation('provider', support, {
      read: () => ({ session, events: [], hasMore: false }),
      follow: (_input, handlerContext) => {
        handlerContext.progress({
          type: 'ready', session,
        })
        handlerContext.progress({
          type: 'event', event: {
            session: { provider: 'provider', id: 'other' }, cursor: 'cursor-1',
            type: 'example/message', replay: 'ignorable', data: {},
          },
        })
      },
    })
    await expect(implementation.handle('follow', { session }, context())).rejects.toThrow(/another session/u)
  })

  it('enforces provider scope, page limits and fork lineage', async () => {
    const supportWithFork = {
      sessionDomain: 'example.sessions', operations: ['read', 'fork'] as const, limits: { maxPageEvents: 1 },
    }
    const child = Object.freeze({
      session: { provider: 'provider', id: 'session-2' }, state: 'available' as const, revision: 0,
      lineage: { parent: session, through: 'cursor-1' },
    })
    const implementation = sessionHistoryImplementation('provider', supportWithFork, {
      read: input => ({ session: input.session, events: [], hasMore: false }),
      fork: () => ({ session: child }),
    })
    await expect(implementation.handle('read', {
      session: { provider: 'other', id: 'session-1' },
    }, context())).rejects.toThrow(/another provider/u)
    await expect(implementation.handle('read', { session, limit: 2 }, context())).rejects.toThrow(/maximum/u)
    await expect(implementation.handle('fork', {
      source: session, through: 'cursor-1', requestId: 'request-1',
    }, context())).resolves.toEqual({ session: child })

    const broken = sessionHistoryImplementation('provider', supportWithFork, {
      read: input => ({ session: input.session, events: [], hasMore: false }),
      fork: () => ({ session: { session: child.session, state: 'available', revision: 0 } }),
    })
    await expect(broken.handle('fork', {
      source: session, through: 'cursor-1', requestId: 'request-1',
    }, context())).rejects.toThrow(/lineage/u)
  })
})

function call() {
  return { invocationId: 'call-1', result: Promise.resolve(undefined), progress: emptyProgress(), cancel() {} }
}

function context(progress: (value: unknown) => void = () => undefined) {
  return {
    connectionId: 'connection-1', planRevision: 1, invocationId: 'invocation-1',
    binding: {} as never, signal: new AbortController().signal, progress,
  }
}

async function* emptyProgress(): AsyncIterable<never> {}
