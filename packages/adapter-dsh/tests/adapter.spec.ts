import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { defineProtocolDeclaration } from '@dsh-std/core'
import { defineComponentManifest } from '@dsh-std/manifest'
import { StandardEndpointRuntime, resolveConnection } from '@dsh-std/connection'
import {
  DSH_ACTIVATION_API_VERSION,
  DSH_ACTIVATION_KIND,
  DSH_COMMAND_API_VERSION,
  DSH_COMMAND_RUNTIME_KIND,
  DSH_MODEL_API_VERSION,
  DSH_MODEL_CATALOG_KIND,
  DSH_MODEL_PROVIDER_KIND,
  DSH_PRESENTATION_API_VERSION,
  DSH_SESSION_API_VERSION,
  DSH_TOOL_API_VERSION,
  DshStandardAdapter,
  default as dshStandardAdapterPlugin,
} from '../src/index.js'

let context: Context | undefined
const temporaryRoots: string[] = []

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function presentation(kinds: readonly string[]) {
  return {
    clientId: 'client-1',
    contracts: kinds.map(kind => ({ apiVersion: DSH_PRESENTATION_API_VERSION, kind })),
  }
}

async function fixture(declarePresentation = true): Promise<{
  adapter: DshStandardAdapter
  events: Array<{ type: string; data: unknown }>
  agent: { id: string; ctx: { tools: { register(definition: { name: string }): () => void } } }
  tools: {
    get(name: string, scope?: object): ({ name: string; enhanced?: boolean } | undefined)
    setGlobal(definition: { name: string }): void
  }
}> {
  const ctx = new Context()
  context = ctx
  const events: Array<{ type: string; data: unknown }> = []
  const globalTools = new Map<string, { name: string; enhanced?: boolean }>()
  const scopedTools = new WeakMap<object, Map<string, { name: string; enhanced?: boolean }>>()
  const agent = {
    id: 'session-1', ctx: {
      tools: {
        register(definition: { name: string; enhanced?: boolean }) {
          const layer = scopedTools.get(agent) ?? new Map()
          if (layer.has(definition.name)) throw new Error(`duplicate scoped tool ${definition.name}`)
          scopedTools.set(agent, layer)
          layer.set(definition.name, definition)
          ctx.emit('tools/change')
          return () => { layer.delete(definition.name); ctx.emit('tools/change') }
        },
      },
    },
    session: {
      append(type: string, data: unknown) {
        events.push({ type, data })
        return { type, seq: events.length - 1, time: Date.now(), data }
      },
    },
  }
  const tools = {
    get(name: string, scope?: object) {
      return (scope === undefined ? undefined : scopedTools.get(scope)?.get(name)) ?? globalTools.get(name)
    },
    setGlobal(definition: { name: string }) {
      globalTools.set(definition.name, definition)
      ctx.emit('tools/change')
    },
  }
  ctx.provide('agents', { get: (id: string) => id === 'session-1' ? agent : undefined } as never)
  ;(ctx.get('agents') as unknown as { list?: () => unknown[] }).list = () => [agent]
  ctx.provide('tools', tools as never)
  await ctx.plugin(CommandRuntime)
  const adapter = new DshStandardAdapter(ctx, { profile: 'host' })
  const manifest = defineComponentManifest({
    apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
    metadata: { name: 'example.acme.account', displayName: 'Account', version: '1.0.0' },
    spec: {
      facets: [{
        name: 'runtime',
        activation: {
          apiVersion: DSH_ACTIVATION_API_VERSION,
          kind: DSH_ACTIVATION_KIND,
          spec: { module: 'acme/account' },
        },
        ...(declarePresentation ? { protocols: { requires: [{
          apiVersion: DSH_PRESENTATION_API_VERSION,
          kind: 'OpenExternal',
          optional: true,
        }] } } : {}),
        extensions: [
          {
            apiVersion: DSH_COMMAND_API_VERSION, kind: 'Command',
            metadata: { name: 'account' },
            spec: {
              title: 'Manage account',
              children: [{ name: 'login', spec: { title: 'Sign in' } }],
            },
          },
          {
            apiVersion: DSH_MODEL_API_VERSION, kind: DSH_MODEL_PROVIDER_KIND,
            metadata: { name: 'example-provider' },
            spec: { title: 'Example Provider', actions: { authenticate: { name: 'account', path: ['login'] } } },
          },
        ],
      }],
    },
  })
  await adapter.mount({
    manifest,
    facet: 'runtime',
    activate(activation) {
      activation.extensions.publish({ apiVersion: DSH_COMMAND_API_VERSION, kind: 'Command' }, 'account', {})
      activation.extensions.publish({ apiVersion: DSH_MODEL_API_VERSION, kind: DSH_MODEL_PROVIDER_KIND }, 'example-provider', {})
    },
    snapshot: () => ({
      extensions: [{
        apiVersion: DSH_MODEL_API_VERSION,
        kind: DSH_MODEL_PROVIDER_KIND,
        name: 'example-provider',
        status: {
          state: 'authentication-required',
          models: [{ id: 'model-test', name: 'Model Test', selectable: false, reason: 'authentication-required' }],
        },
      }],
    }),
  })
  ctx.commands.register({
    name: 'account', description: 'Manage account', input: { hint: 'subcommand' },
    handler: () => {
      const opened = adapter.present({
        apiVersion: DSH_PRESENTATION_API_VERSION,
        kind: 'OpenExternal',
        uri: 'https://example.test/login',
      })
      return { kind: 'success', text: opened ? 'opened' : 'copy the URL' }
    },
  })
  return { adapter, events, agent, tools }
}

describe('@dsh-std/adapter-dsh', () => {
  it('discovers portable facet modules from installed profile dependencies', async () => {
    const { adapter } = await fixture()
    const profileDir = mkdtempSync(join(tmpdir(), 'dsh-std-profile-'))
    temporaryRoots.push(profileDir)
    const componentDir = join(profileDir, 'node_modules', 'fixture-component')
    mkdirSync(componentDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture-profile', private: true, dependencies: { 'fixture-component': '1.0.0' },
    }))
    writeFileSync(join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component', version: '1.0.0', type: 'module',
      exports: { './standard': './standard.js' },
    }))
    writeFileSync(join(componentDir, 'dsh-plugin.json'), JSON.stringify({
      $schema: 'urn:dsh-std:draft:dsh-plugin:0.1.0',
      manifestVersion: '0.1.0',
      id: 'example.fixture.component',
      name: 'Fixture Component',
      version: '1.0.0',
      apiVersion: '>=0.1.0 <0.2.0',
      entrypoints: { host: 'fixture-component/standard' },
      contributes: {
        'x-dev.dsh-std.extensions': [{
          id: 'example.fixture.component.session-event',
          apiVersion: 'session.dsh/v1alpha1',
          kind: 'SessionEvent',
          name: 'fixture/event',
          spec: { description: 'Fixture event', replay: 'ignorable' },
        }],
      },
    }))
    writeFileSync(join(componentDir, 'standard.js'), 'export default { activate() {} }\n')

    const disposers = await adapter.mountProfileComponents(profileDir)
    expect((await adapter.snapshot()).facets).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity: expect.objectContaining({
          component: 'example.fixture.component', facet: 'host',
      }) }),
    ]))
    for (const dispose of disposers) await dispose()
    expect((await adapter.snapshot()).facets.some(row => row.identity.component === 'example.fixture.component')).toBe(false)
  })

  it('discovers from the profile directory URL supplied by the DSH bundle', async () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'dsh-std-profile-url-'))
    temporaryRoots.push(profileDir)
    const componentDir = join(profileDir, 'node_modules', 'fixture-component')
    mkdirSync(componentDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture-profile', private: true, dependencies: { 'fixture-component': '1.0.0' },
    }))
    writeFileSync(join(componentDir, 'package.json'), JSON.stringify({
      name: 'fixture-component', version: '1.0.0', type: 'module',
      exports: { './standard': './standard.js' },
    }))
    writeFileSync(join(componentDir, 'dsh-plugin.json'), JSON.stringify({
      $schema: 'urn:dsh-std:draft:dsh-plugin:0.1.0',
      manifestVersion: '0.1.0',
      id: 'example.fixture.from-profile-url',
      name: 'Fixture From Profile URL',
      version: '1.0.0',
      apiVersion: '>=0.1.0 <0.2.0',
      entrypoints: { host: 'fixture-component/standard' },
      contributes: {
        'x-dev.dsh-std.extensions': [{
          id: 'example.fixture.from-profile-url.model-provider',
          apiVersion: 'models.dsh/v1alpha1',
          kind: 'ModelProvider',
          name: 'fixture-models',
          spec: { title: 'Fixture Models' },
        }],
      },
    }))
    writeFileSync(join(componentDir, 'standard.js'), `
export default {
  activate(context) {
    context.extensions.publish(
      { apiVersion: 'models.dsh/v1alpha1', kind: 'ModelProvider' },
      'fixture-models',
      {
        async listModels() { return [{ id: 'fixture-model', name: 'Fixture Model' }] },
        async *stream() {},
      },
    )
  },
}
`)

    const ctx = new Context()
    // Cordis scopes the plugin context to its package. The bundle evaluates
    // profileBaseUrl in the root profile context before that scope is created.
    ctx.baseUrl = pathToFileURL(`${join(profileDir, 'node_modules', '@dsh-std', 'adapter-dsh')}/`).href
    ctx.provide('agents', { get: () => undefined, list: () => [] } as never)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(dshStandardAdapterPlugin, { profileBaseUrl: pathToFileURL(`${profileDir}/`).href })
    const adapter = ctx.dshStd
    for (let attempt = 0; attempt < 20 && (await adapter.snapshot()).facets.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect((await adapter.snapshot()).facets).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity: expect.objectContaining({
        component: 'example.fixture.from-profile-url', facet: 'host',
      }) }),
    ]))
    expect(ctx.llm.listProviders()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fixture-models' }),
    ]))
    await ctx.fiber.dispose()
  })

  it('describes live protocol declarations without exposing a plugin registry', async () => {
    const { adapter } = await fixture()
    expect(adapter.describe()).toMatchObject({
      apiVersion: 'adapter.dsh/v1alpha1',
      runtime: {
        profile: 'host',
        declaration: { participant: { id: 'std.dsh.adapter-dsh/runtime' }, supports: expect.arrayContaining([
          { apiVersion: DSH_COMMAND_API_VERSION, kind: DSH_COMMAND_RUNTIME_KIND },
          { apiVersion: DSH_MODEL_API_VERSION, kind: DSH_MODEL_CATALOG_KIND },
        ]) },
      },
    })
    expect(adapter).not.toHaveProperty('registry')
  })

  it('activates one facet and publishes only its live extensions', async () => {
    const { adapter } = await fixture()
    await expect(adapter.snapshot()).resolves.toMatchObject({
      apiVersion: 'adapter.dsh/snapshot/v1alpha1',
      facets: [{
        identity: { component: 'example.acme.account', facet: 'runtime' },
        state: 'active',
        extensions: [{ kind: DSH_MODEL_PROVIDER_KIND, name: 'example-provider' }],
      }],
    })
    expect(adapter.publications.list()).toHaveLength(2)
  })

  it('rolls staged facts back when activation fails', async () => {
    const { adapter } = await fixture()
    const before = adapter.publications.list().length
    await expect(adapter.mount({
      manifest: defineComponentManifest({
        apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
        metadata: { name: 'example.acme.broken', version: '1.0.0' },
        spec: { facets: [{
          name: 'runtime',
          activation: { apiVersion: DSH_ACTIVATION_API_VERSION, kind: DSH_ACTIVATION_KIND, spec: { module: 'broken' } },
          extensions: [{
            apiVersion: DSH_COMMAND_API_VERSION, kind: 'Command',
            metadata: { name: 'broken' }, spec: { title: 'Broken' },
          }],
        }] },
      }),
      facet: 'runtime',
      activate(activation) {
        activation.extensions.publish({ apiVersion: DSH_COMMAND_API_VERSION, kind: 'Command' }, 'broken', {})
        throw new Error('activation failed')
      },
    })).rejects.toThrow('activation failed')
    expect(adapter.publications.list()).toHaveLength(before)
    expect((await adapter.snapshot()).facets).toHaveLength(1)
  })

  it('rejects an extension identity already owned by a live facet', async () => {
    const { adapter } = await fixture()
    await expect(adapter.mount({
      manifest: defineComponentManifest({
        apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
        metadata: { name: 'example.acme.duplicate', version: '1.0.0' },
        spec: { facets: [{
          name: 'runtime',
          activation: { apiVersion: DSH_ACTIVATION_API_VERSION, kind: DSH_ACTIVATION_KIND, spec: { module: 'duplicate' } },
          extensions: [{
            apiVersion: DSH_COMMAND_API_VERSION, kind: 'Command',
            metadata: { name: 'account' }, spec: { title: 'Duplicate account' },
          }],
        }] },
      }),
      facet: 'runtime',
      activate() { throw new Error('must not activate') },
    })).rejects.toThrow(/multiple owners/)
    expect((await adapter.snapshot()).facets).toHaveLength(1)
  })

  it('dispatches adapter-owned catalogs through negotiated connection bindings', async () => {
    const { adapter } = await fixture()
    const client = new StandardEndpointRuntime({ id: 'client', instanceId: 'client-1' })
    client.register({ declaration: defineProtocolDeclaration({
      participant: { id: 'client/catalog' },
      requires: [
        { apiVersion: DSH_COMMAND_API_VERSION, kind: DSH_COMMAND_RUNTIME_KIND },
        { apiVersion: DSH_MODEL_API_VERSION, kind: DSH_MODEL_CATALOG_KIND },
      ],
    }) })
    const plan = resolveConnection(client.offer, adapter.connectionEndpoint.offer, {
      connectionId: 'connection-1', revision: 1, protocols: adapter.protocols,
    })
    expect(plan.compatible).toBe(true)
    const signal = new AbortController().signal
    const commandBinding = plan.bindings.find(binding => binding.requirement.kind === DSH_COMMAND_RUNTIME_KIND)!
    await expect(adapter.connectionEndpoint.dispatch({
      connectionId: plan.connectionId, planRevision: plan.revision, invocationId: 'commands-1',
      binding: commandBinding, operation: 'catalog',
      input: { contextId: 'session-1', presentation: presentation(['OpenExternal']) },
      signal, progress: () => undefined,
    })).resolves.toMatchObject({ commands: [{ name: 'account', owner: { component: 'example.acme.account', facet: 'runtime' } }] })
    const modelBinding = plan.bindings.find(binding => binding.requirement.kind === DSH_MODEL_CATALOG_KIND)!
    await expect(adapter.connectionEndpoint.dispatch({
      connectionId: plan.connectionId, planRevision: plan.revision, invocationId: 'models-1',
      binding: modelBinding, operation: 'list', input: {}, signal, progress: () => undefined,
    })).resolves.toMatchObject({ providers: [{
      owner: { component: 'example.acme.account', facet: 'runtime' },
      resource: { metadata: { name: 'example-provider' }, status: { state: 'authentication-required' } },
    }] })
  })

  it('executes commands and records only declared, available presentation operations', async () => {
    const { adapter, events } = await fixture()
    await expect(adapter.execute(
      'session-1', '/account login', presentation(['OpenExternal']), new AbortController().signal,
    )).resolves.toMatchObject({
      result: { kind: 'success', text: 'opened' },
      operations: [{ kind: 'OpenExternal', uri: 'https://example.test/login' }],
    })
    await expect(adapter.execute(
      'session-1', '/account login', presentation([]), new AbortController().signal,
    )).resolves.toMatchObject({ result: { text: 'copy the URL' }, operations: [] })
    expect(events.map(event => event.type)).toEqual(['command/run', 'command/done', 'command/run', 'command/done'])
  })

  it('rejects a presentation operation that its facet did not declare', async () => {
    const { adapter } = await fixture(false)
    await expect(adapter.execute(
      'session-1', '/account login', presentation(['OpenExternal']), new AbortController().signal,
    )).rejects.toThrow(/undeclared protocol.*OpenExternal/)
  })

  it('maps ToolOverride ownership to every live DSH agent tool view', async () => {
    const { adapter, agent, tools } = await fixture()
    const original = { name: 'read_image' }
    tools.setGlobal(original)
    const dispose = await adapter.mount({
      manifest: defineComponentManifest({
        apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
        metadata: { name: 'example.acme.image', version: '1.0.0' },
        spec: { facets: [{
          name: 'runtime',
          activation: { apiVersion: DSH_ACTIVATION_API_VERSION, kind: DSH_ACTIVATION_KIND, spec: { module: 'image' } },
          extensions: [{
            apiVersion: DSH_TOOL_API_VERSION, kind: 'ToolOverride',
            metadata: { name: 'enhanced-read-image' },
            spec: { target: 'read_image', description: 'Accept remote images.' },
          }],
        }] },
      }),
      facet: 'runtime',
      activate(activation) {
        activation.extensions.publish(
          { apiVersion: DSH_TOOL_API_VERSION, kind: 'ToolOverride' },
          'enhanced-read-image',
          { resolve: (base: { name: string }) => ({ ...base, enhanced: true }) },
        )
      },
    })
    expect(tools.get('read_image', agent)).toEqual({ name: 'read_image', enhanced: true })
    await dispose()
    expect(tools.get('read_image', agent)).toBe(original)
  })

  it('maps SessionEvent resources to the DSH vocabulary for the facet lifetime', async () => {
    const { adapter } = await fixture()
    const type = 'example/acme-event'
    expect(KNOWN_SESSION_EVENT_TYPES.has(type)).toBe(false)
    const dispose = await adapter.mount({
      manifest: defineComponentManifest({
        apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
        metadata: { name: 'example.acme.events', version: '1.0.0' },
        spec: { facets: [{
          name: 'runtime',
          activation: { apiVersion: DSH_ACTIVATION_API_VERSION, kind: DSH_ACTIVATION_KIND, spec: { module: 'events' } },
          extensions: [{
            apiVersion: DSH_SESSION_API_VERSION, kind: 'SessionEvent',
            metadata: { name: type },
            spec: { description: 'Example component event.', replay: 'required' },
          }],
        }] },
      }),
      facet: 'runtime',
      activate() {},
    })
    expect(KNOWN_SESSION_EVENT_TYPES.has(type)).toBe(true)
    await dispose()
    expect(KNOWN_SESSION_EVENT_TYPES.has(type)).toBe(false)
  })
})
