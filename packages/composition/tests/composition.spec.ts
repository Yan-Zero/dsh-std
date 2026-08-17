import { describe, expect, it } from 'vitest'
import { ProtocolCatalog } from '@dsh-std/core'
import { defineManifest } from '@dsh-std/manifest'
import { compose } from '../src/index.js'

const protocols = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
protocols.register({
  apiVersion: 'example.dsh/v1alpha1', kind: 'Service',
  validateRequirement: value => value,
  validateSupport: value => value,
  negotiate: () => ({ agreement: {} }),
})

const manifest = defineManifest({
  apiVersion: 'manifest.dsh/v1alpha1', kind: 'Component',
  metadata: { name: 'example.multi.surface', version: '1.0.0' },
  spec: { facets: [
    {
      name: 'runtime', activation: { apiVersion: 'adapter.dsh/v1alpha1', kind: 'CordisEntrypoint', spec: { module: './runtime.js' } },
      protocols: { supports: [{ apiVersion: 'example.dsh/v1alpha1', kind: 'Service' }] },
    },
    {
      name: 'web', activation: { apiVersion: 'adapter.dsh/v1alpha1', kind: 'BrowserEntrypoint', spec: { module: './web.js' } },
      protocols: { requires: [{ apiVersion: 'example.dsh/v1alpha1', kind: 'Service' }] },
    },
  ] },
})

describe('@dsh-std/composition', () => {
  it('selects facets by installed drivers rather than facet names', () => {
    const plan = compose({
      manifests: [manifest], protocols,
      drivers: [{ id: 'example.cordis', apiVersion: 'adapter.dsh/v1alpha1', kind: 'CordisEntrypoint' }],
    })
    expect(plan.selected.map(row => row.identity.facet)).toEqual(['runtime'])
    expect(plan.skipped).toEqual([expect.objectContaining({ identity: expect.objectContaining({ facet: 'web' }), code: 'activation-unavailable' })])
    expect(plan.compatible).toBe(true)
  })

  it('reports a required facet whose driver is unavailable', () => {
    const plan = compose({
      manifests: [manifest], protocols, drivers: [],
      select: [{ component: 'example.multi.surface', facet: 'web', required: true }],
    })
    expect(plan).toMatchObject({ compatible: false, issues: [{ code: 'activation-unavailable' }] })
  })

  it('requires policy to choose among matching drivers', () => {
    const drivers = [
      { id: 'driver.a', apiVersion: 'adapter.dsh/v1alpha1', kind: 'CordisEntrypoint' },
      { id: 'driver.b', apiVersion: 'adapter.dsh/v1alpha1', kind: 'CordisEntrypoint' },
    ]
    expect(compose({
      manifests: [manifest], protocols, drivers,
      select: [{ component: 'example.multi.surface', facet: 'runtime', required: true }],
    })).toMatchObject({ compatible: false, issues: [{ code: 'activation-unavailable' }] })
    expect(compose({
      manifests: [manifest], protocols, drivers,
      select: [{ component: 'example.multi.surface', facet: 'runtime', required: true }],
      policy: { selectActivationDriver: () => 'driver.b' },
    }).selected[0]?.driver?.id).toBe('driver.b')
  })

  it('reports denied permissions and soft component relationships distinctly', () => {
    const value = defineManifest({
      apiVersion: 'manifest.dsh/v1alpha1', kind: 'Component',
      metadata: { name: 'example.permission.consumer', version: '1.0.0' },
      spec: {
        relationships: { recommends: { 'example.missing.helper': '^1.0.0' } },
        facets: [{
          name: 'declarative', extensions: [],
          permissions: [{ apiVersion: 'permissions.example/v1alpha1', kind: 'Filesystem', action: 'read' }],
        }],
      },
    })
    const plan = compose({
      manifests: [value], protocols, drivers: [],
      policy: { authorizePermission: () => false },
    })
    expect(plan.compatible).toBe(false)
    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'recommendation-missing', severity: 'warning' }),
      expect.objectContaining({ code: 'permission-denied', severity: 'error' }),
    ]))
  })

  it('checks newly selected extensions against already-live facet owners', () => {
    const declarative = defineManifest({
      apiVersion: 'manifest.dsh/v1alpha1', kind: 'Component',
      metadata: { name: 'example.command.second', version: '1.0.0' },
      spec: { facets: [{
        name: 'declarative',
        extensions: [{ apiVersion: 'commands.dsh/v1alpha1', kind: 'Command', metadata: { name: 'account' }, spec: {} }],
      }] },
    })
    const plan = compose({
      manifests: [declarative], protocols, drivers: [],
      liveExtensions: [{
        owner: { component: 'example.command.first', version: '1.0.0', facet: 'runtime' },
        extension: { apiVersion: 'commands.dsh/v1alpha1', kind: 'Command', metadata: { name: 'account' }, spec: {} },
      }],
    })
    expect(plan).toMatchObject({ compatible: false, issues: [{ code: 'extension-conflict' }] })
  })
})
