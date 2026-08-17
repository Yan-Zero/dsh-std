import { describe, expect, it, vi } from 'vitest'
import { API_VERSION, RUNTIME_KIND, commandRuntime, extensionDefinition, runtimeProtocol, runtimeSupport } from '../src/index.js'

describe('@dsh-std/command', () => {
  it('separates command resources from the callable Runtime dispatcher', () => {
    expect(extensionDefinition).toMatchObject({ kind: 'Command', validateSpec: expect.any(Function) })
    expect(runtimeProtocol).toMatchObject({ apiVersion: API_VERSION, kind: RUNTIME_KIND })
    expect(runtimeSupport).toEqual({ apiVersion: API_VERSION, kind: RUNTIME_KIND })
  })

  it('wraps generic connection invocation behind typed command methods', () => {
    const invoke = vi.fn(() => ({
      invocationId: 'invocation-1', result: Promise.resolve(undefined), progress: emptyProgress(), cancel() {},
    }))
    const client = commandRuntime({ participantId: 'example.client.tui', binding: () => undefined, invoke } as never)
    client.execute({ contextId: 'session-1', line: '/codex login' })
    expect(invoke).toHaveBeenCalledWith(
      runtimeSupport, 'execute', { contextId: 'session-1', line: '/codex login' }, undefined,
    )
  })

  it('describes a portable command grammar without owning its renderer', () => {
    expect(() => extensionDefinition.validateSpec({
      title: 'Manage an account',
      titles: { 'zh-CN': '管理账号', ja: 'アカウント管理' },
      children: [{
        name: 'login',
        spec: {
          title: 'Sign in',
          arguments: [{
            name: 'method',
            required: true,
            values: [{ value: 'browser', title: 'Browser' }, { value: 'device', title: 'Device code' }],
          }],
          options: [{ names: ['--force', '-f'], title: 'Replace the current sign-in' }],
        },
      }],
    })).not.toThrow()
  })

  it('rejects ambiguous command trees before a client consumes them', () => {
    expect(() => extensionDefinition.validateSpec({
      title: 'Root',
      children: [
        { name: 'login', spec: { title: 'Login', aliases: ['auth'] } },
        { name: 'auth', spec: { title: 'Authenticate' } },
      ],
    })).toThrow(/duplicate name or alias/)
  })

  it('requires a variadic argument to be last', () => {
    expect(() => extensionDefinition.validateSpec({
      title: 'Copy files',
      arguments: [
        { name: 'source', variadic: true },
        { name: 'destination', required: true },
      ],
    })).toThrow(/last argument/)
  })

  it('rejects accidental fields while preserving namespaced extensions', () => {
    expect(() => extensionDefinition.validateSpec({ title: 'Root', input: 'legacy-hint' })).toThrow(/unknown field "input"/)
    expect(() => extensionDefinition.validateSpec({ title: 'Root', 'x-example-hint': 'value' })).not.toThrow()
  })
})

async function* emptyProgress(): AsyncIterableIterator<never> {}
