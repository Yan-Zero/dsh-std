import { describe, expect, it, vi } from 'vitest'
import {
  API_VERSION,
  CATALOG_KIND,
  PROVIDER_KIND,
  catalogProtocol,
  catalogSupport,
  modelCatalog,
  providerExtensionDefinition,
  validateProviderStatus,
  assertModelProviderHandler,
} from '../src/index.js'

describe('@dsh-std/model', () => {
  it('separates named ModelProvider resources from the callable catalog', () => {
    expect(providerExtensionDefinition).toMatchObject({ apiVersion: API_VERSION, kind: PROVIDER_KIND })
    expect(catalogProtocol).toMatchObject({ apiVersion: API_VERSION, kind: CATALOG_KIND })
    expect(catalogSupport).toEqual({ apiVersion: API_VERSION, kind: CATALOG_KIND })
  })

  it('uses structured command references for provider management actions', () => {
    expect(() => providerExtensionDefinition.validateSpec({
      title: 'OpenAI Codex',
      actions: {
        authenticate: { name: 'codex', path: ['login'] },
        signout: { name: 'codex', path: ['logout'] },
      },
    })).not.toThrow()
    expect(() => providerExtensionDefinition.validateSpec({
      title: 'OpenAI Codex', actions: { authenticate: '/codex login' },
    })).toThrow(/CommandReference/)
  })

  it('wraps generic connection invocation behind typed catalog methods', () => {
    const invoke = vi.fn(() => ({
      invocationId: 'invocation-1', result: Promise.resolve(undefined), progress: emptyProgress(), cancel() {},
    }))
    const client = modelCatalog({ participantId: 'example.client.settings', binding: () => undefined, invoke } as never)
    client.get({ name: 'openai-codex' })
    expect(invoke).toHaveBeenCalledWith(catalogSupport, 'get', { name: 'openai-codex' }, undefined)
  })

  it('distinguishes authentication from model selectability', () => {
    expect(() => validateProviderStatus({
      state: 'authentication-required',
      models: [{
        id: 'gpt-test', name: 'GPT Test', selectable: false, reason: 'authentication-required',
      }],
    })).not.toThrow()
    expect(() => validateProviderStatus({
      state: 'ready', models: [{ id: 'gpt-test', name: 'GPT Test', selectable: 'yes' }],
    })).toThrow(/selectable must be boolean/)
  })

  it('requires an executable handler for a live provider', () => {
    expect(() => assertModelProviderHandler({ listModels: () => [], stream: async function* () {} })).not.toThrow()
    expect(() => assertModelProviderHandler({})).toThrow(/listModels/)
  })
})

async function* emptyProgress(): AsyncIterableIterator<never> {}
