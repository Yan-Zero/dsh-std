import { describe, expect, it } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import {
  API_VERSION,
  KIND,
  LIST_FEATURE,
  PRESENCE_FEATURE,
  localStorageRequirement,
  localStorageSupport,
  protocol,
  support,
  validateGetOutput,
  validateHasOutput,
  validateJsonValue,
  validateListInput,
  validateListOutput,
  validateSetInput,
} from '../src/index.js'

describe('@dsh-std/storage', () => {
  it('publishes the Community v0.15 LocalStorage coordinates', () => {
    expect(protocol).toMatchObject({ apiVersion: API_VERSION, kind: KIND })
    expect(support).toEqual({ apiVersion: 'storage.dsh/v1alpha1', kind: 'LocalStorage' })
  })

  it('negotiates exactly one provider', () => {
    const catalog = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
    catalog.register(protocol)
    const consumer = defineProtocolDeclaration({
      participant: { id: 'example.plugin' },
      requires: [{ apiVersion: API_VERSION, kind: KIND }],
    })
    const host = defineProtocolDeclaration({ participant: { id: 'example.host' }, supports: [support] })
    expect(catalog.negotiate([consumer])).toMatchObject({ compatible: false })
    expect(catalog.negotiate([consumer, host])).toMatchObject({ compatible: true })
    expect(catalog.negotiate([consumer, host, defineProtocolDeclaration({
      participant: { id: 'example.other-host' }, supports: [support],
    })])).toMatchObject({ compatible: false, issues: [{ code: 'support-ambiguous' }] })
  })

  it('negotiates optional presence and paginated list features without changing the legacy binding', () => {
    const catalog = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
    catalog.register(protocol)
    const consumer = defineProtocolDeclaration({
      participant: { id: 'example.plugin' },
      requires: [localStorageRequirement([PRESENCE_FEATURE, LIST_FEATURE])],
    })
    const legacyHost = defineProtocolDeclaration({ participant: { id: 'example.legacy-host' }, supports: [support] })
    expect(catalog.negotiate([consumer, legacyHost])).toMatchObject({
      compatible: false,
      issues: [{ code: 'required-support-missing', participant: 'example.plugin' }],
    })

    const featureHost = defineProtocolDeclaration({
      participant: { id: 'example.host' },
      supports: [localStorageSupport({ features: [LIST_FEATURE, PRESENCE_FEATURE], maxListPageSize: 100 })],
    })
    expect(catalog.negotiate([consumer, featureHost])).toMatchObject({
      compatible: true,
      protocols: [{
        agreement: {
          kind: 'LocalStorageBindings',
          providers: { 'example.plugin': 'example.host' },
          features: { 'example.plugin': [LIST_FEATURE, PRESENCE_FEATURE] },
          maxListPageSizes: { 'example.plugin': 100 },
        },
      }],
    })
  })

  it('accepts only JSON values and exact operation objects', () => {
    expect(() => validateSetInput({ key: 'settings', value: { enabled: true, retries: 2 } })).not.toThrow()
    expect(() => validateGetOutput({ value: null })).not.toThrow()
    expect(() => validateJsonValue(Number.NaN)).toThrow(/finite/u)
    expect(() => validateJsonValue(new Date())).toThrow(/plain objects/u)
    const cyclic: unknown[] = []
    cyclic.push(cyclic)
    expect(() => validateJsonValue(cyclic)).toThrow(/cycles/u)
    expect(() => validateSetInput({ key: '', value: null })).toThrow(/non-empty/u)
    expect(() => validateHasOutput({ exists: false })).not.toThrow()
    expect(() => validateListInput({ prefix: '', limit: 50 })).not.toThrow()
    expect(() => validateListOutput({ keys: ['a', 'b'], nextCursor: 'opaque' })).not.toThrow()
    expect(() => validateListOutput({ keys: ['a', 'a'] })).toThrow(/duplicate/u)
  })
})
