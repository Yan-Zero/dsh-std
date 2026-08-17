import { describe, expect, it } from 'vitest'
import { ProtocolCatalog } from '@dsh-std/core'
import {
  MANIFEST_VERSION,
  SCHEMA_ID,
  STANDARD_EXTENSIONS_CONTRIBUTION,
  ManifestDefinitionCatalog,
  defineManifest,
  facetIdentity,
  parseManifest,
  projectManifest,
} from '../src/index.js'

function manifest() {
  return defineManifest({
    $schema: SCHEMA_ID,
    manifestVersion: MANIFEST_VERSION,
    id: 'example.acme.codex',
    name: 'Codex',
    version: '1.0.0',
    apiVersion: '>=0.1.0 <0.2.0',
    entrypoints: { host: 'example-codex/standard' },
    capabilities: {
      required: { commands: '>=0.1.0 <0.2.0' },
      optional: { 'presentation.open-external': '>=0.1.0 <0.2.0' },
    },
    contributes: {
      commands: [{ id: 'example.acme.codex.command', title: 'Manage Codex' }],
      [STANDARD_EXTENSIONS_CONTRIBUTION]: [{
        id: 'example.acme.codex.model-provider',
        apiVersion: 'models.dsh/v1alpha1',
        kind: 'ModelProvider',
        name: 'openai-codex',
        spec: { title: 'OpenAI Codex' },
      }],
    },
  })
}

describe('@dsh-std/manifest', () => {
  it('parses the static dsh-plugin.json draft and keeps all version axes distinct', () => {
    const parsed = parseManifest(JSON.stringify(manifest()), { source: 'dsh-plugin.json' })
    expect(parsed).toMatchObject({
      $schema: SCHEMA_ID,
      manifestVersion: '0.1.0',
      version: '1.0.0',
      apiVersion: '>=0.1.0 <0.2.0',
    })
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('requires the local canonical schema and rejects YAML or dynamic schema selection', () => {
    expect(() => parseManifest('id: example.acme.codex')).toThrow(SyntaxError)
    expect(() => defineManifest({ ...structuredClone(manifest()), $schema: 'https://example.test/schema.json' } as never)).toThrow(/\$schema/)
  })

  it('keeps requirements, subscriptions, permissions, and contributions structurally separate', () => {
    expect(() => defineManifest({
      ...structuredClone(manifest()),
      capabilities: {
        required: { 'storage.local': '>=0.1.0 <0.2.0' },
        optional: { 'storage.local': '>=0.1.0 <0.2.0' },
      },
    })).toThrow(/both required and optional/)
    expect(() => defineManifest({ ...structuredClone(manifest()), provides: {} } as never)).toThrow(/unknown field "provides"/)
  })

  it('projects one host entrypoint into the host-internal activation model', () => {
    const projected = projectManifest(manifest())
    const facet = projected.spec.facets[0]!
    expect(facetIdentity(projected, facet)).toEqual({ component: 'example.acme.codex', version: '1.0.0', facet: 'host' })
    expect(facet.activation).toEqual({
      apiVersion: 'lifecycle.dsh/v1alpha1', kind: 'FacetModule', spec: { module: 'example-codex/standard' },
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
