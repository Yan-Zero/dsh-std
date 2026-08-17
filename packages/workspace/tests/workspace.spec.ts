import { describe, expect, it, vi } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import {
  API_VERSION,
  WORKSPACE_CATALOG_KIND,
  WORKSPACE_PROVIDER_KIND,
  WORKSPACE_SESSIONS_KIND,
  validateWorkspaceDescriptor,
  workspaceCatalog,
  workspaceCatalogImplementation,
  workspaceCatalogProtocol,
  workspaceCatalogSupport,
  workspaceProviderExtensionDefinition,
  workspaceSessionsProtocol,
} from '../src/index.js'

describe('@dsh-std/workspace', () => {
  const spec = {
    workspaceDomain: 'example.workspaces',
    operations: ['list', 'get', 'resolve'] as const,
    locatorKinds: ['file'],
    mutationConcurrency: 'serialized' as const,
  }

  it('defines a portable provider resource and a callable catalog', () => {
    expect(workspaceProviderExtensionDefinition).toMatchObject({ apiVersion: API_VERSION, kind: WORKSPACE_PROVIDER_KIND })
    expect(workspaceCatalogSupport(spec)).toMatchObject({ apiVersion: API_VERSION, kind: WORKSPACE_CATALOG_KIND, spec })
  })

  it('uses opaque provider references and provider-interpreted locations', () => {
    expect(() => validateWorkspaceDescriptor({
      workspace: { provider: 'example.provider', id: 'workspace-1' }, title: 'Example',
      location: { kind: 'file', display: '/srv/example', canonical: { kind: 'file', spec: { path: '/srv/example' } } },
      state: 'available', revision: 1,
    })).not.toThrow()
  })

  it('wraps catalog operations and rejects undeclared handler calls', async () => {
    const invoke = vi.fn(() => ({ invocationId: 'call-1', result: Promise.resolve(undefined), progress: emptyProgress(), cancel() {} }))
    workspaceCatalog({ participantId: 'client', binding: () => undefined, invoke } as never).resolve({ locator: { kind: 'file', spec: { path: '/srv/example' } } })
    expect(invoke).toHaveBeenCalledWith({ apiVersion: API_VERSION, kind: WORKSPACE_CATALOG_KIND }, 'resolve', { locator: { kind: 'file', spec: { path: '/srv/example' } } }, undefined)
    const implementation = workspaceCatalogImplementation('host', spec, { list: () => ({ catalogRevision: 0, workspaces: [] }), get: () => undefined, resolve: () => ({}) })
    await expect(implementation.handle('rename', {}, {} as never)).rejects.toThrow(/was not declared/u)
  })

  it('negotiates catalog operations, locator kinds, concurrency and domain', () => {
    const protocols = new ProtocolCatalog({ name: 'workspace-test', version: '1.0.0' })
    protocols.register(workspaceCatalogProtocol)
    const report = protocols.negotiate([
      defineProtocolDeclaration({ participant: { id: 'client' }, requires: [{
        apiVersion: API_VERSION, kind: WORKSPACE_CATALOG_KIND,
        spec: {
          operations: ['resolve'], optionalOperations: ['watch'], workspaceDomain: 'wanted',
          locatorKinds: ['file'], mutationConcurrency: 'revision-checked',
        },
      }] }),
      defineProtocolDeclaration({ participant: { id: 'wrong-domain' }, supports: [{
        apiVersion: API_VERSION, kind: WORKSPACE_CATALOG_KIND,
        spec: { workspaceDomain: 'other', operations: ['resolve'], locatorKinds: ['file'], mutationConcurrency: 'revision-checked' },
      }] }),
      defineProtocolDeclaration({ participant: { id: 'provider' }, supports: [{
        apiVersion: API_VERSION, kind: WORKSPACE_CATALOG_KIND,
        spec: { workspaceDomain: 'wanted', operations: ['resolve'], locatorKinds: ['file'], mutationConcurrency: 'revision-checked' },
      }] }),
    ])
    expect(report.compatible).toBe(true)
    expect(report.issues).toEqual([expect.objectContaining({ code: 'optional-operation-missing' })])
    expect(report.protocols[0]?.agreement).toMatchObject({
      kind: 'CapabilityBindings', bindings: [{ consumer: 'client', provider: 'provider' }],
    })
  })

  it('rejects catalog providers that cannot satisfy required locator semantics', () => {
    const protocols = new ProtocolCatalog({ name: 'workspace-test', version: '1.0.0' })
    protocols.register(workspaceCatalogProtocol)
    const report = protocols.negotiate([
      defineProtocolDeclaration({ participant: { id: 'client' }, requires: [{
        apiVersion: API_VERSION, kind: WORKSPACE_CATALOG_KIND,
        spec: { operations: ['resolve'], locatorKinds: ['container'] },
      }] }),
      defineProtocolDeclaration({ participant: { id: 'provider' }, supports: [{
        apiVersion: API_VERSION, kind: WORKSPACE_CATALOG_KIND,
        spec: { workspaceDomain: 'workspaces', operations: ['resolve'], locatorKinds: ['file'], mutationConcurrency: 'serialized' },
      }] }),
    ])
    expect(report).toMatchObject({ compatible: false, issues: [{ code: 'required-support-missing' }] })
  })

  it('uses WorkspaceSessions domains to select a provider and otherwise reports ambiguity', () => {
    const protocols = new ProtocolCatalog({ name: 'workspace-test', version: '1.0.0' })
    protocols.register(workspaceSessionsProtocol)
    const supports = ['one', 'two'].map(sessionDomain => defineProtocolDeclaration({
      participant: { id: `provider-${sessionDomain}` }, supports: [{
        apiVersion: API_VERSION, kind: WORKSPACE_SESSIONS_KIND,
        spec: { workspaceDomain: 'workspaces', sessionDomain, operations: ['list'], mutationConcurrency: 'serialized' },
      }],
    }))
    const selected = protocols.negotiate([
      defineProtocolDeclaration({ participant: { id: 'selected-client' }, requires: [{
        apiVersion: API_VERSION, kind: WORKSPACE_SESSIONS_KIND,
        spec: { operations: ['list'], workspaceDomain: 'workspaces', sessionDomain: 'two' },
      }] }),
      ...supports,
    ])
    expect(selected.protocols[0]?.agreement).toMatchObject({
      bindings: [{ consumer: 'selected-client', provider: 'provider-two' }],
    })

    const ambiguous = protocols.negotiate([
      defineProtocolDeclaration({ participant: { id: 'ambiguous-client' }, requires: [{
        apiVersion: API_VERSION, kind: WORKSPACE_SESSIONS_KIND, spec: { operations: ['list'] },
      }] }),
      ...supports,
    ])
    expect(ambiguous).toMatchObject({ compatible: false, issues: [{ code: 'support-ambiguous' }] })
  })
})

async function* emptyProgress(): AsyncIterable<never> {}
