import { describe, expect, it } from 'vitest'
import { ProtocolCatalog } from '@dsh-std/core'
import { compose } from '@dsh-std/composition'
import { defineComponentManifest } from '@dsh-std/manifest'
import {
  ActivationDriverRegistry,
  FACET_MODULE_API_VERSION,
  FACET_MODULE_KIND,
  LifecycleCoordinator,
  facetModuleActivationDefinition,
} from '../src/index.js'

function fixture() {
  const protocols = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
  protocols.register({
    apiVersion: 'example.dsh/v1alpha1', kind: 'Service',
    validateRequirement: value => value,
    validateSupport: value => value,
    negotiate(input) {
      return input.requirements.length > 0 && input.supports.length === 0
        ? { issues: [{ code: 'support-missing', severity: 'error', message: 'service support is missing' }] }
        : { agreement: { available: input.supports.length > 0 } }
    },
  })
  const manifest = defineComponentManifest({
    apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
    metadata: { name: 'example.service.provider', version: '1.0.0' },
    spec: { facets: [{
      name: 'runtime',
      activation: { apiVersion: 'adapter.test/v1alpha1', kind: 'Entrypoint', spec: {} },
      protocols: { supports: [{ apiVersion: 'example.dsh/v1alpha1', kind: 'Service' }] },
    }] },
  })
  return { protocols, manifest }
}

describe('@dsh-std/lifecycle', () => {
  it('defines a portable FacetModule activation without naming a product adapter', () => {
    expect(facetModuleActivationDefinition).toMatchObject({
      apiVersion: FACET_MODULE_API_VERSION,
      kind: FACET_MODULE_KIND,
    })
    expect(facetModuleActivationDefinition.validateSpec({ module: 'example/standard' }))
      .toEqual({ module: 'example/standard' })
  })

  it('publishes staged support only after activation returns', async () => {
    const { protocols, manifest } = fixture()
    const drivers = new ActivationDriverRegistry()
    let visibleDuringActivation = -1
    drivers.register({
      id: 'example.driver', apiVersion: 'adapter.test/v1alpha1', kind: 'Entrypoint',
      activate({ context }) {
        context.protocols.implement({ apiVersion: 'example.dsh/v1alpha1', kind: 'Service' }, { handle: true })
        visibleDuringActivation = coordinator.publications.list().length
      },
    })
    const plan = compose({ manifests: [manifest], protocols, drivers: drivers.descriptors() })
    const coordinator = new LifecycleCoordinator(protocols, drivers)
    const [handle] = await coordinator.activate(plan)
    expect(visibleDuringActivation).toBe(0)
    expect(coordinator.publications.declarations()).toEqual([expect.objectContaining({
      participant: { id: 'example.service.provider@1.0.0#runtime' },
      supports: [{ apiVersion: 'example.dsh/v1alpha1', kind: 'Service' }],
    })])
    await handle?.deactivate()
    expect(coordinator.publications.list()).toEqual([])
  })

  it('rolls back undeclared support without publishing it', async () => {
    const { protocols, manifest } = fixture()
    const drivers = new ActivationDriverRegistry()
    drivers.register({
      id: 'example.driver', apiVersion: 'adapter.test/v1alpha1', kind: 'Entrypoint',
      activate({ context }) {
        context.protocols.implement({ apiVersion: 'other.dsh/v1alpha1', kind: 'Other' }, {})
      },
    })
    const coordinator = new LifecycleCoordinator(protocols, drivers)
    const plan = compose({ manifests: [manifest], protocols, drivers: drivers.descriptors() })
    await expect(coordinator.activate(plan)).rejects.toThrow(/undeclared protocol/)
    expect(coordinator.publications.list()).toEqual([])
  })

  it('aborts the activation scope before invoking driver deactivation', async () => {
    const { protocols, manifest } = fixture()
    const drivers = new ActivationDriverRegistry()
    let signal: AbortSignal | undefined
    let abortedAtDeactivate = false
    drivers.register({
      id: 'example.driver', apiVersion: 'adapter.test/v1alpha1', kind: 'Entrypoint',
      activate({ context }) {
        signal = context.scope.signal
        context.protocols.implement({ apiVersion: 'example.dsh/v1alpha1', kind: 'Service' }, {})
      },
      deactivate() { abortedAtDeactivate = signal?.aborted === true },
    })
    const coordinator = new LifecycleCoordinator(protocols, drivers)
    const [handle] = await coordinator.activate(compose({ manifests: [manifest], protocols, drivers: drivers.descriptors() }))
    await handle?.deactivate('test stop')
    expect(abortedAtDeactivate).toBe(true)
    expect(signal?.reason).toBe('test stop')
  })
})
