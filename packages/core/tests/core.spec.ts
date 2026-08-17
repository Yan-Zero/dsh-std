import { describe, expect, it } from 'vitest'
import {
  ProtocolCatalog,
  defineProtocolDeclaration,
  parseApiVersion,
  protocolFamilyKey,
} from '../src/index.js'

function catalog() {
  const value = new ProtocolCatalog({ name: 'test-evaluator', version: '1.0.0' })
  value.register({
    apiVersion: 'widgets.example/v1alpha1',
    kind: 'Widget',
    accepts: ['widgets.example/v1beta1'],
    validateRequirement(spec) {
      if (spec !== undefined && typeof spec !== 'object') throw new TypeError('requirement spec must be an object')
      return spec
    },
    validateSupport(spec) {
      if (spec !== undefined && typeof spec !== 'object') throw new TypeError('support spec must be an object')
      return spec
    },
    negotiate(input) {
      const issues = input.requirements.flatMap(row =>
        input.supports.length === 0 && row.requirement.optional !== true
          ? [{ code: 'provider-missing', severity: 'error' as const, participant: row.participant, message: 'widget provider is missing' }]
          : [],
      )
      return issues.length > 0 ? { issues } : {
        agreement: { providers: input.supports.map(row => row.participant).sort() },
      }
    },
  })
  return value
}

describe('@dsh-std/core', () => {
  it('validates live declarations without planes, locality, packages, or resources', () => {
    const declaration = defineProtocolDeclaration({
      participant: { id: 'runtime-1' },
      requires: [{ apiVersion: 'widgets.example/v1alpha1', kind: 'Widget', optional: true, spec: { role: 'consumer' } }],
      supports: [{ apiVersion: 'widgets.example/v1alpha1', kind: 'Widget', spec: { role: 'provider' } }],
    })
    expect(declaration.participant.id).toBe('runtime-1')
    expect(() => defineProtocolDeclaration({
      participant: { id: 'invalid' },
      supports: [{ apiVersion: 'widgets.example/v1alpha1', kind: 'Widget', plane: 'runtime' }],
    } as never)).toThrow(/unknown field "plane"/)
  })

  it('does not infer version compatibility from a shared major', () => {
    const protocols = catalog()
    expect(protocols.understands({ apiVersion: 'widgets.example/v1beta1', kind: 'Widget' })).toBe(true)
    expect(protocols.understands({ apiVersion: 'widgets.example/v1alpha2', kind: 'Widget' })).toBe(false)
    expect(protocolFamilyKey({ apiVersion: 'widgets.example/v1alpha2', kind: 'Widget' })).toBe(
      protocolFamilyKey({ apiVersion: 'widgets.example/v1beta1', kind: 'Widget' }),
    )
  })

  it('dispatches negotiation to the owning protocol definition', () => {
    const report = catalog().negotiate([
      defineProtocolDeclaration({
        participant: { id: 'consumer' },
        requires: [{ apiVersion: 'widgets.example/v1beta1', kind: 'Widget' }],
      }),
      defineProtocolDeclaration({
        participant: { id: 'provider' },
        supports: [{ apiVersion: 'widgets.example/v1alpha1', kind: 'Widget' }],
      }),
    ])
    expect(report).toMatchObject({
      compatible: true,
      evaluator: { name: 'test-evaluator', version: '1.0.0' },
      protocols: [{
        apiVersion: 'widgets.example/v1alpha1', kind: 'Widget',
        participants: ['consumer', 'provider'], agreement: { providers: ['provider'] }, issues: [],
      }],
    })
  })

  it('reports missing definitions and required supports separately', () => {
    const protocols = catalog()
    const missingDefinition = protocols.negotiate([defineProtocolDeclaration({
      participant: { id: 'consumer' },
      requires: [{ apiVersion: 'unknown.example/v1alpha1', kind: 'Unknown' }],
    })])
    expect(missingDefinition).toMatchObject({
      compatible: false,
      issues: [{ code: 'definition-unavailable', severity: 'error', participant: 'consumer' }],
    })
    const missingSupport = protocols.negotiate([defineProtocolDeclaration({
      participant: { id: 'consumer' },
      requires: [{ apiVersion: 'widgets.example/v1alpha1', kind: 'Widget' }],
    })])
    expect(missingSupport).toMatchObject({ compatible: false, issues: [{ code: 'provider-missing' }] })
  })

  it('does not confuse installing a definition with a live implementation', () => {
    const protocols = catalog()
    expect(protocols.list()).toHaveLength(1)
    expect(protocols.negotiate([])).toMatchObject({ compatible: true, protocols: [], issues: [] })
  })

  it('rejects duplicate participant identities in one scope', () => {
    const declaration = defineProtocolDeclaration({ participant: { id: 'same' } })
    expect(() => catalog().negotiate([declaration, declaration])).toThrow(/duplicate participant/)
  })

  it('validates API versions independently from semantic package versions', () => {
    expect(parseApiVersion('connection.dsh/v2beta3')).toEqual({
      group: 'connection.dsh', major: 2, stability: 'beta', revision: 3,
    })
  })
})
