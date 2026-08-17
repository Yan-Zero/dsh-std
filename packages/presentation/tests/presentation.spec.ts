import { describe, expect, it } from 'vitest'
import { API_VERSION, validateOperation } from '../src/index.js'

describe('@dsh-std/presentation', () => {
  it('accepts invocation-scoped primitives without choosing a renderer', () => {
    expect(() => validateOperation({ apiVersion: API_VERSION, kind: 'OpenExternal', uri: 'https://example.test/login' })).not.toThrow()
    expect(() => validateOperation({ apiVersion: API_VERSION, kind: 'CopyText', text: 'ABCD-EFGH' })).not.toThrow()
    expect(() => validateOperation({ apiVersion: API_VERSION, kind: 'Notification', text: 'Complete sign-in', level: 'info' })).not.toThrow()
  })

  it('rejects unsafe links and empty no-op operations', () => {
    expect(() => validateOperation({ apiVersion: API_VERSION, kind: 'OpenExternal', uri: 'file:///tmp/token' })).toThrow(/HTTP/)
    expect(() => validateOperation({ apiVersion: API_VERSION, kind: 'CopyText', text: '' })).toThrow(/non-empty/)
  })
})
