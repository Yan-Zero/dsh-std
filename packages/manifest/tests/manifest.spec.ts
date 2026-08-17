import { describe, expect, it } from 'vitest'
import { ProtocolCatalog } from '@dsh-std/core'
import {
  COMMUNITY_V015_MANIFEST_VERSION,
  ManifestDefinitionCatalog,
  defineManifest,
  facetIdentity,
  parseManifest,
  projectManifest,
} from '../src/index.js'

const COMMUNITY_DRAFT_SCHEMA_EXAMPLE = 'urn:example:dsh-plugin:0.15'

function manifest() {
  return defineManifest({
    $schema: COMMUNITY_DRAFT_SCHEMA_EXAMPLE,
    manifestVersion: COMMUNITY_V015_MANIFEST_VERSION,
    id: 'example.acme.codex',
    name: 'Codex',
    version: '1.0.0',
    facets: { host: { entry: 'dist/host.js', apiVersion: 'v1alpha1' } },
    requires: { contracts: [
      { apiVersion: 'commands.dsh/v1alpha1', kind: 'Command' },
      { apiVersion: 'messages.dsh/v1alpha1', kind: 'MessageObserver', optional: true, fallback: 'Disable observation.' },
    ] },
    permissions: [{ name: 'commands.invoke', scope: 'example.acme.codex.command' }],
    contributes: {
      commands: [{ id: 'example.acme.codex.command', title: 'Manage Codex' }],
      'x-dev.dsh-std.extensions': [{
        id: 'example.acme.codex.model-provider',
        apiVersion: 'models.dsh/v1alpha1',
        kind: 'ModelProvider',
        name: 'openai-codex',
        spec: { title: 'OpenAI Codex' },
      }],
    },
    subscriptions: [{ apiVersion: 'messages.dsh/v1alpha1', kind: 'MessageObserver', scope: 'session' }],
  })
}

describe('@dsh-std/manifest', () => {
  it('parses a Community v0.15 dsh-plugin.json without fetching its schema URI', () => {
    const parsed = parseManifest(JSON.stringify(manifest()), { source: 'dsh-plugin.json' })
    expect(parsed).toMatchObject({
      $schema: COMMUNITY_DRAFT_SCHEMA_EXAMPLE,
      manifestVersion: '0.15',
      version: '1.0.0',
      facets: { host: { entry: 'dist/host.js', apiVersion: 'v1alpha1' } },
    })
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('rejects YAML, relative schema identifiers, and superseded manifest versions', () => {
    expect(() => parseManifest('id: example.acme.codex')).toThrow(SyntaxError)
    expect(() => defineManifest({ ...structuredClone(manifest()), $schema: './schema.json' })).toThrow(/absolute URI/)
    expect(() => defineManifest({ ...structuredClone(manifest()), manifestVersion: '0.1.0' } as never)).toThrow(/unsupported/)
  })

  it('projects Community v0.15 contracts and contributions into the common model', () => {
    const facet = projectManifest(manifest()).spec.facets[0]!
    expect(facet.activation?.spec).toEqual({ module: 'dist/host.js' })
    expect(facet.protocols?.requires).toEqual([
      { apiVersion: 'commands.dsh/v1alpha1', kind: 'Command' },
      {
        apiVersion: 'messages.dsh/v1alpha1',
        kind: 'MessageObserver',
        optional: true,
        'x-community-fallback': 'Disable observation.',
      },
    ])
    expect(facet.extensions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        apiVersion: 'commands.dsh/v1alpha1', kind: 'Command',
        metadata: expect.objectContaining({ name: 'command' }),
      }),
    ]))
    expect(facet.permissions).toEqual([
      expect.objectContaining({ action: 'commands.invoke', spec: { scope: 'example.acme.codex.command' } }),
    ])
  })

  it('rejects v0.15 client facets, service requirements, and duplicate contract coordinates', () => {
    expect(() => defineManifest({
      ...structuredClone(manifest()),
      facets: { ...structuredClone(manifest().facets), client: {} },
    } as never)).toThrow(/unknown field "client"/)
    expect(() => defineManifest({
      ...structuredClone(manifest()), requires: { contracts: [], services: [{}] },
    } as never)).toThrow(/services must be an empty array/)
    expect(() => defineManifest({
      ...structuredClone(manifest()),
      requires: { contracts: [
        { apiVersion: 'commands.dsh/v1alpha1', kind: 'Command' },
        { apiVersion: 'commands.dsh/v1alpha1', kind: 'Command', optional: true },
      ] },
    } as never)).toThrow(/duplicate contract/)
  })

  it('keeps requirements, subscriptions, permissions, and contributions structurally separate', () => {
    expect(() => defineManifest({ ...structuredClone(manifest()), provides: {} } as never)).toThrow(/unknown field "provides"/)
  })

  it('projects one host entrypoint into the host-internal activation model', () => {
    const projected = projectManifest(manifest())
    const facet = projected.spec.facets[0]!
    expect(facetIdentity(projected, facet)).toEqual({ component: 'example.acme.codex', version: '1.0.0', facet: 'host' })
    expect(facet.activation).toEqual({
      apiVersion: 'lifecycle.dsh/v1alpha1', kind: 'FacetModule', spec: { module: 'dist/host.js' },
    })
    expect(facet.extensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'Command', metadata: expect.objectContaining({ name: 'command' }) }),
      expect.objectContaining({ kind: 'ModelProvider', metadata: expect.objectContaining({ name: 'openai-codex' }) }),
    ]))
  })

  it('validates projected objects against host-installed definitions', () => {
    const catalog = new ManifestDefinitionCatalog()
    const protocols = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
    expect(catalog.validate(projectManifest(manifest()), protocols)).toMatchObject({
      validator: { name: '@dsh-std/manifest', version: '0.1.0' },
      source: 'memory:',
      digest: expect.stringMatching(/^fnv1a32:/),
      compatible: true,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unknown-activation', severity: 'warning' })]),
    })
  })
})
