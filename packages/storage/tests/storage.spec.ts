import { describe, expect, it } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import {
  API_VERSION,
  KIND,
  protocol,
  support,
  validateGetOutput,
  validateJsonValue,
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

  it('accepts only JSON values and exact operation objects', () => {
    expect(() => validateSetInput({ key: 'settings', value: { enabled: true, retries: 2 } })).not.toThrow()
    expect(() => validateGetOutput({ value: null })).not.toThrow()
    expect(() => validateJsonValue(Number.NaN)).toThrow(/finite/u)
    expect(() => validateJsonValue(new Date())).toThrow(/plain objects/u)
    const cyclic: unknown[] = []
    cyclic.push(cyclic)
    expect(() => validateJsonValue(cyclic)).toThrow(/cycles/u)
    expect(() => validateSetInput({ key: '', value: null })).toThrow(/non-empty/u)
  })
})
