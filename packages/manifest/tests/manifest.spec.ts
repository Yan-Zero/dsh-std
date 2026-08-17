import { describe, expect, it } from 'vitest'
import { ProtocolCatalog } from '@dsh-std/core'
import { API_VERSION, ManifestDefinitionCatalog, defineManifest, facetIdentity, parseManifest } from '../src/index.js'

function manifest() {
  return defineManifest({
    apiVersion: API_VERSION,
    kind: 'Component',
    metadata: { name: 'example.acme.codex', version: '1.0.0', displayName: 'Codex' },
    spec: {
      facets: [{
        name: 'runtime',
        activation: { apiVersion: 'adapter.dsh/v1alpha1', kind: 'CordisEntrypoint', spec: { module: './index.js' } },
        protocols: {
          requires: [{ apiVersion: 'presentation.dsh/v1alpha1', kind: 'OpenExternal', optional: true }],
          supports: [{ apiVersion: 'models.dsh/v1alpha1', kind: 'Inference' }],
        },
        extensions: [{
          apiVersion: 'tools.dsh/v1alpha1', kind: 'Tool', metadata: { name: 'imagegen' },
          spec: { title: 'Image generation', description: 'Generate an image.' },
        }],
      }],
    },
  })
}

describe('@dsh-std/manifest', () => {
  it('keeps component, facet, and runtime participant identities separate', () => {
    const value = manifest()
    expect(facetIdentity(value, value.spec.facets[0]!)).toEqual({
      component: 'example.acme.codex', version: '1.0.0', facet: 'runtime',
    })
    expect(value.spec.facets[0]).not.toHaveProperty('participant')
  })

  it('rejects package-global capabilities and duplicate facets', () => {
    expect(() => defineManifest({
      ...structuredClone(manifest()),
      spec: { facets: [{ name: 'same', extensions: [] }, { name: 'same', extensions: [] }] },
    })).toThrow(/duplicate facet/)
    expect(() => defineManifest({
      ...structuredClone(manifest()),
      spec: { ...manifest().spec, protocols: {} },
    } as never)).toThrow(/unknown field "protocols"/)
  })

  it('distinguishes unknown definitions from invalid objects', () => {
    const catalog = new ManifestDefinitionCatalog()
    const protocols = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
    expect(catalog.validate(manifest(), protocols)).toMatchObject({
      validator: { name: '@dsh-std/manifest', version: '0.1.0' },
      source: 'memory:',
      digest: expect.stringMatching(/^fnv1a32:/),
      compatible: true,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unknown-activation', severity: 'warning' })]),
    })
    catalog.registerActivation({
      apiVersion: 'adapter.dsh/v1alpha1', kind: 'CordisEntrypoint',
      validateSpec(spec) {
        if (typeof spec !== 'object' || spec === null || !('module' in spec)) throw new TypeError('module is required')
        return spec
      },
    })
    expect(catalog.validate(manifest(), protocols).issues.some(row => row.code === 'unknown-activation')).toBe(false)
  })

  it('leaves extension identity syntax to its definition', () => {
    const value = defineManifest({
      ...structuredClone(manifest()),
      spec: { facets: [{
        name: 'runtime',
        extensions: [{
          apiVersion: 'session.dsh/v1alpha1', kind: 'SessionEvent',
          metadata: { name: 'web/example-event' }, spec: { description: 'Example', replay: 'required' },
        }],
      }] },
    })
    const catalog = new ManifestDefinitionCatalog()
    catalog.registerExtension({
      apiVersion: 'session.dsh/v1alpha1', kind: 'SessionEvent',
      validateMetadata(metadata) {
        if (!/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)+$/u.test(metadata.name)) throw new TypeError('invalid event type')
      },
      validateSpec: spec => spec,
    })
    expect(catalog.validate(value).compatible).toBe(true)
  })

  it('parses YAML 1.2 before applying the manifest schema', () => {
    const parsed = parseManifest(`
apiVersion: manifest.dsh/v1alpha1
kind: Component
metadata:
  name: example.yaml.component
  version: 1.0.0
spec:
  facets:
    - name: declarative
      extensions: []
`)
    expect(parsed.metadata).toEqual({ name: 'example.yaml.component', version: '1.0.0' })
    expect(Object.isFrozen(parsed)).toBe(true)
  })
})
