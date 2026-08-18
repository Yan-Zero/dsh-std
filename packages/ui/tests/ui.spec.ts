import { describe, expect, it, vi } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import {
  API_VERSION,
  CONTRIBUTION_HOST_KIND,
  bindContributionHost,
  contributionExtensionDefinition,
  contributionHostRequirement,
  contributionHostSupport,
  register,
} from '../src/index.js'

const SETTINGS = { apiVersion: 'tui.dsh/v1alpha1', kind: 'SettingsSection' } as const
const TOOL_VIEW = { apiVersion: 'web.ui.dsh/v1alpha1', kind: 'ToolView' } as const

describe('@dsh-std/ui', () => {
  it('negotiates concrete surfaces and modes without standardizing their descriptors', () => {
    const catalog = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
    register(catalog)
    const report = catalog.negotiate([
      defineProtocolDeclaration({
        participant: { id: 'component/facet' },
        requires: [contributionHostRequirement({ surfaces: [
          { ...SETTINGS, mode: 'host-rendered', spec: { namespace: 'openai-codex' } },
        ] })],
      }),
      defineProtocolDeclaration({
        participant: { id: 'shell/runtime' },
        supports: [contributionHostSupport({ surfaces: [
          { ...SETTINGS, modes: ['host-rendered'], spec: { renderer: 1 } },
          { ...TOOL_VIEW, modes: ['local-module'] },
        ] })],
      }),
    ])
    expect(report.compatible).toBe(true)
    expect(report.protocols[0]?.agreement).toEqual({ surfaces: [{
      ...SETTINGS,
      consumer: 'component/facet', provider: 'shell/runtime', mode: 'host-rendered',
      requirementSpec: { namespace: 'openai-codex' }, supportSpec: { renderer: 1 },
    }] })
  })

  it('reports an unavailable mode and ambiguous providers deterministically', () => {
    const catalog = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
    register(catalog)
    const requirement = defineProtocolDeclaration({
      participant: { id: 'consumer' },
      requires: [contributionHostRequirement({ surfaces: [{ ...TOOL_VIEW, mode: 'local-module' }] })],
    })
    const wrongMode = defineProtocolDeclaration({
      participant: { id: 'host' },
      supports: [contributionHostSupport({ surfaces: [{ ...TOOL_VIEW, modes: ['host-rendered'] }] })],
    })
    expect(catalog.negotiate([requirement, wrongMode]).issues)
      .toEqual([expect.objectContaining({ code: 'ui-surface-unavailable', severity: 'error' })])

    const host = (id: string) => defineProtocolDeclaration({
      participant: { id },
      supports: [contributionHostSupport({ surfaces: [{ ...TOOL_VIEW, modes: ['local-module'] }] })],
    })
    expect(catalog.negotiate([requirement, host('one'), host('two')]).issues)
      .toEqual([expect.objectContaining({ code: 'ui-placement-conflict', severity: 'error' })])
  })

  it('owns registrations by activation, rejects wrong modes, and cleans up in reverse order', async () => {
    const disposed: string[] = []
    const registerContribution = vi.fn((_owner, contribution: { descriptor: { id: string } }) =>
      () => { disposed.push(contribution.descriptor.id) })
    const owner = {
      component: 'example.component', version: '1.0.0', facet: 'tui',
      instanceId: 'instance', participantId: 'component/facet',
    }
    const bound = bindContributionHost({ surfaces: [
      { ...SETTINGS, consumer: owner.participantId, provider: 'shell/runtime', mode: 'host-rendered' },
      { ...TOOL_VIEW, consumer: owner.participantId, provider: 'shell/runtime', mode: 'local-module' },
    ] }, owner, {
      participantId: 'shell/runtime',
      support: { surfaces: [
        { ...SETTINGS, modes: ['host-rendered'] },
        { ...TOOL_VIEW, modes: ['local-module'] },
      ] },
      register: registerContribution,
    })
    bound.client.register({ descriptor: { id: 'settings', surface: SETTINGS, content: { title: 'Codex' } } })
    bound.client.register({ descriptor: { id: 'imagegen', surface: TOOL_VIEW, content: {} }, localModule: () => null })
    expect(() => bound.client.register({
      descriptor: { id: 'bad', surface: SETTINGS, content: {} }, localModule: () => null,
    })).toThrow(/host-rendered/u)

    await bound.close('unmounted')
    expect(disposed).toEqual(['imagegen', 'settings'])
    expect(() => bound.client.register({ descriptor: { id: 'late', surface: SETTINGS, content: {} } }))
      .toThrow(/closed/u)
  })

  it('validates static contributions as data and forbids executable content', () => {
    expect(() => contributionExtensionDefinition.validateSpec({
      id: 'settings', surface: SETTINGS, mode: 'host-rendered', content: { title: 'Codex' },
    })).not.toThrow()
    expect(() => contributionExtensionDefinition.validateSpec({
      id: 'settings', surface: SETTINGS, mode: 'host-rendered', content: { render: () => null },
    })).toThrow(/JSON-serializable/u)
    expect(API_VERSION).toBe('ui.dsh/v1alpha1')
    expect(CONTRIBUTION_HOST_KIND).toBe('ContributionHost')
  })
})
