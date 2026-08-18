import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { defineProtocolDeclaration } from '@dsh-std/core'
import { defineComponentManifest } from '@dsh-std/manifest'
import { StandardEndpointRuntime, resolveConnection, type CapabilityClient } from '@dsh-std/connection'
import {
  notificationClient,
  notificationImplementation,
  notificationSupport,
} from '@dsh-std/presentation'
import {
  contributionHostRequirement,
  type ContributionHostClient,
} from '@dsh-std/ui'
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

interface FixtureTool {
  name: string
  description?: string
  parameters?: unknown
  output?: {
    schema: unknown
    render(args: unknown, value: unknown): unknown[]
    presentationMeta?(args: unknown, value: unknown): unknown
  }
  execute?(args: unknown, exec: unknown): Promise<unknown>
  isConcurrencySafe?(args: unknown): boolean
  timeoutMs?: number
  presentCall?(args: unknown): unknown
  presentResult?(args: unknown, result: unknown): unknown
}

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
  ctx: Context
  adapter: DshStandardAdapter
  events: Array<{ type: string; data: unknown }>
  agent: {
    id: string
    options: { provider: string; model: string }
    ctx: {
      tools: { register(definition: FixtureTool): () => void }
      on(name: 'tools/execute', listener: (exec: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void
      executeTool(exec: unknown, next: () => Promise<unknown>): Promise<unknown>
    }
    session: {
      id: string
      header: { cwd?: string }
      requestHeader(): { config: { provider: string; model: string } }
      deriveMessages(): unknown[]
      append(type: string, data: unknown): unknown
    }
  }
  tools: {
    get(name: string, scope?: object): FixtureTool | undefined
    setGlobal(definition: FixtureTool): void
    register(definition: FixtureTool): () => void
  }
}> {
  const ctx = new Context()
  context = ctx
  const events: Array<{ type: string; data: unknown }> = []
  const globalTools = new Map<string, FixtureTool>()
  const scopedTools = new WeakMap<object, Map<string, FixtureTool>>()
  const toolExecuteListeners = new Set<(exec: unknown, next: () => Promise<unknown>) => Promise<unknown>>()
  const agent = {
    id: 'session-1',
    options: { provider: 'example-provider', model: 'model-test' },
    ctx: {
      tools: {
        register(definition: FixtureTool) {
          const layer = scopedTools.get(agent) ?? new Map()
          if (layer.has(definition.name)) throw new Error(`duplicate scoped tool ${definition.name}`)
          scopedTools.set(agent, layer)
          layer.set(definition.name, definition)
          ctx.emit('tools/change')
          return () => { layer.delete(definition.name); ctx.emit('tools/change') }
        },
      },
      on(name: 'tools/execute', listener: (exec: unknown, next: () => Promise<unknown>) => Promise<unknown>) {
        if (name !== 'tools/execute') throw new Error(`unexpected agent event ${name}`)
        toolExecuteListeners.add(listener)
        return () => { toolExecuteListeners.delete(listener) }
      },
      async executeTool(exec: unknown, next: () => Promise<unknown>) {
        const listeners = [...toolExecuteListeners]
        let index = 0
        const dispatch = async (): Promise<unknown> => {
          const listener = listeners[index++]
          return listener === undefined ? await next() : await listener(exec, dispatch)
        }
        return await dispatch()
      },
    },
    session: {
      id: 'session-1',
      header: {},
      requestHeader: () => ({ config: { provider: agent.options.provider, model: agent.options.model } }),
      deriveMessages: () => [],
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
    register(definition: FixtureTool) {
      if (globalTools.has(definition.name)) throw new Error(`duplicate global tool ${definition.name}`)
      globalTools.set(definition.name, definition)
      ctx.emit('tools/change')
      return () => { globalTools.delete(definition.name); ctx.emit('tools/change') }
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
    handler: () => ({ kind: 'success', text: 'copy the URL' }),
  })
  return { ctx, adapter, events, agent, tools }
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
      exports: { './standard': './standard.js', './client': './missing-client.js' },
      dsh: { client: { platform: 'web', inject: [] } },
    }))
    writeFileSync(join(componentDir, 'dsh-plugin.json'), JSON.stringify({
      $schema: 'urn:example:dsh-plugin:0.15',
      manifestVersion: '0.15',
      id: 'example.fixture.component',
      name: 'Fixture Component',
      version: '1.0.0',
      facets: { host: { entry: 'standard.js', apiVersion: 'v1alpha1' } },
      requires: { contracts: [] },
      permissions: [],
      contributes: {
        commands: [],
        'x-dev.dsh-std.extensions': [{
          id: 'example.fixture.component.session-event',
          apiVersion: 'session.dsh/v1alpha1',
          kind: 'SessionEvent',
          name: 'fixture/event',
          spec: { description: 'Fixture event', replay: 'ignorable' },
        }],
      },
      subscriptions: [],
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

  it('loads a component browser half only when the Web client-module host is active', async () => {
    const { ctx, adapter } = await fixture()
    const loaderEntries: Array<{ options: { name: string } }> = []
    const created: string[] = []
    const removed: string[] = []
    const provide = ctx.provide.bind(ctx) as (name: string, value: unknown) => void
    provide('clientModules', {})
    provide('loader', {
      entries: () => loaderEntries,
      async create(options: { name: string }) {
        created.push(options.name)
        loaderEntries.push({ options })
        return `entry:${options.name}`
      },
      async remove(id: string) {
        removed.push(id)
        loaderEntries.splice(0)
      },
    })
    const profileDir = mkdtempSync(join(tmpdir(), 'dsh-std-web-profile-'))
    temporaryRoots.push(profileDir)
    const componentDir = join(profileDir, 'node_modules', 'web-component')
    mkdirSync(componentDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture-profile', private: true, dependencies: { 'web-component': '1.0.0' },
    }))
    writeFileSync(join(componentDir, 'package.json'), JSON.stringify({
      name: 'web-component', version: '1.0.0', type: 'module',
      exports: { '.': './index.js', './client': './client.js' },
      dsh: { client: { platform: 'web', inject: ['@dsh-std/adapter-dsh'] } },
    }))
    writeFileSync(join(componentDir, 'dsh-plugin.json'), JSON.stringify({
      $schema: 'urn:example:dsh-plugin:0.15', manifestVersion: '0.15',
      id: 'example.web.component', name: 'Web Component', version: '1.0.0',
      facets: { host: { entry: 'standard.js', apiVersion: 'v1alpha1' } },
      requires: { contracts: [] }, permissions: [], contributes: { commands: [] }, subscriptions: [],
    }))
    writeFileSync(join(componentDir, 'standard.js'), 'export default { activate() {} }\n')

    const disposers = await adapter.mountProfileComponents(profileDir)
    expect(created).toEqual(['web-component'])
    for (const dispose of [...disposers].reverse()) await dispose()
    expect(removed).toEqual(['entry:web-component'])
  })

  it('loads a Community v0.15 host facet from a package-relative entry', async () => {
    const { adapter } = await fixture()
    const profileDir = mkdtempSync(join(tmpdir(), 'dsh-std-community-profile-'))
    temporaryRoots.push(profileDir)
    const componentDir = join(profileDir, 'node_modules', 'community-component')
    mkdirSync(join(componentDir, 'dist'), { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'fixture-profile', private: true, dependencies: { 'community-component': '1.0.0' },
    }))
    writeFileSync(join(componentDir, 'package.json'), JSON.stringify({
      name: 'community-component', version: '1.0.0', type: 'module',
    }))
    writeFileSync(join(componentDir, 'dsh-plugin.json'), JSON.stringify({
      $schema: 'urn:example:dsh-plugin:0.15',
      manifestVersion: '0.15',
      id: 'example.community.component',
      name: 'Community Component',
      version: '1.0.0',
      facets: { host: { entry: 'dist/host.js', apiVersion: 'v1alpha1' } },
      requires: { contracts: [{ apiVersion: 'commands.dsh/v1alpha1', kind: 'Command' }] },
      permissions: [],
      contributes: { commands: [] },
      subscriptions: [],
    }))
    writeFileSync(join(componentDir, 'dist', 'host.js'), 'export default { activate() {} }\n')

    const disposers = await adapter.mountProfileComponents(profileDir)
    expect((await adapter.snapshot()).facets).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity: expect.objectContaining({
        component: 'example.community.component', facet: 'host',
      }) }),
    ]))
    for (const dispose of disposers) await dispose()
  })

  it('gives a standard facet a callable client for its negotiated protocol', async () => {
    const { adapter } = await fixture(false)
    const notices: string[] = []
    let issuedCapability: CapabilityClient | undefined
    const provider = defineComponentManifest({
      apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
      metadata: { name: 'example.presentation.terminal', version: '1.0.0' },
      spec: { facets: [{
        name: 'runtime',
        activation: { apiVersion: DSH_ACTIVATION_API_VERSION, kind: DSH_ACTIVATION_KIND, spec: { module: 'terminal' } },
        protocols: { supports: [notificationSupport] },
      }] },
    })
    await adapter.mount({
      manifest: provider,
      facet: 'runtime',
      activate(activation) {
        activation.protocols.implement(notificationSupport, notificationImplementation(
          activation.identity.participantId,
          {
            notify(request) {
              notices.push(request.text)
              return { status: 'submitted', value: { accepted: true } }
            },
          },
        ))
      },
    })

    const consumer = defineComponentManifest({
      apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
      metadata: { name: 'example.presentation.consumer', version: '1.0.0' },
      spec: { facets: [{
        name: 'runtime',
        activation: { apiVersion: DSH_ACTIVATION_API_VERSION, kind: DSH_ACTIVATION_KIND, spec: { module: 'consumer' } },
        protocols: { requires: [notificationSupport] },
      }] },
    })
    const disposeConsumer = await adapter.mount({
      manifest: consumer,
      facet: 'runtime',
      async activate(activation) {
        const capability = activation.protocols.client<CapabilityClient>(notificationSupport)
        if (capability === undefined) throw new Error('Notification client is unavailable')
        issuedCapability = capability
        let request = 0
        const notification = notificationClient(capability, {
          invocationId: activation.identity.instanceId,
          origin: activation.identity.participantId,
          nextRequestId: () => `${activation.identity.instanceId}:${String(++request)}`,
        })
        await expect(notification.notify({ text: 'standard notification' })).resolves.toEqual({
          status: 'submitted', value: { accepted: true },
        })
      },
    })
    expect(notices).toEqual(['standard notification'])
    await disposeConsumer()
    expect(issuedCapability?.binding(notificationSupport)).toBeUndefined()
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
      $schema: 'urn:example:dsh-plugin:0.15',
      manifestVersion: '0.15',
      id: 'example.fixture.from-profile-url',
      name: 'Fixture From Profile URL',
      version: '1.0.0',
      facets: { host: { entry: 'standard.js', apiVersion: 'v1alpha1' } },
      requires: { contracts: [] },
      permissions: [],
      contributes: {
        commands: [],
        'x-dev.dsh-std.extensions': [{
          id: 'example.fixture.from-profile-url.model-provider',
          apiVersion: 'models.dsh/v1alpha1',
          kind: 'ModelProvider',
          name: 'fixture-models',
          spec: { title: 'Fixture Models' },
        }],
      },
      subscriptions: [],
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

  it('returns command results without deferred presentation operations', async () => {
    const { adapter, events } = await fixture()
    await expect(adapter.execute(
      'session-1', '/account login', presentation(['OpenExternal']), new AbortController().signal,
    )).resolves.toEqual(expect.objectContaining({ result: { kind: 'success', text: 'copy the URL' } }))
    const execution = await adapter.execute(
      'session-1', '/account login', presentation([]), new AbortController().signal,
    )
    expect(execution).not.toHaveProperty('operations')
    expect(events.map(event => event.type)).toEqual(['command/run', 'command/done', 'command/run', 'command/done'])
  })

  it('offers Web clients a presentation-neutral command Remote entry', async () => {
    const { adapter } = await fixture()
    await expect(adapter.command('session-1', '/account login')).resolves.toEqual(expect.objectContaining({
      result: { kind: 'success', text: 'copy the URL' },
    }))
  })

  it('maps ToolOverride ownership to every live DSH agent tool view', async () => {
    const { adapter, agent, tools } = await fixture()
    const original: FixtureTool = {
      name: 'read_image', description: 'Read an image.', parameters: { type: 'object' },
      output: { schema: { type: 'object' }, render: () => [] },
      execute: async () => ({ path: 'image.png' }),
    }
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
          { resolve: (base: FixtureTool) => ({ ...base, description: 'Read local or remote images.' }) },
        )
      },
    })
    expect(tools.get('read_image', agent)).toMatchObject({
      name: 'read_image', description: 'Read local or remote images.',
    })
    await expect(tools.get('read_image', agent)!.execute!({ file_path: 'image.png' }, {
      signal: new AbortController().signal,
      deferContext: () => undefined,
    } as never)).resolves.toEqual({ data: { path: 'image.png' }, content: [] })
    await dispose()
    expect(tools.get('read_image', agent)).toBe(original)
  })

  it('replaces execution for a matching provider without shadowing its agent-scoped tool definition', async () => {
    const { ctx, adapter, agent, events, tools } = await fixture()
    const presentCall = () => ({ card: 'generic', title: 'search' })
    const presentResult = () => ({ card: 'web', kind: 'search' })
    const original: FixtureTool = {
      name: 'web_search', description: 'Search the selected web provider.', parameters: { type: 'object' },
      output: {
        schema: { type: 'object' }, render: () => [{ type: 'text', text: 'original' }],
        presentationMeta: () => ({ original: true }),
      },
      execute: async () => ({ sources: [], truncated: false }),
      timeoutMs: 60_000,
      presentCall,
      presentResult,
    }
    agent.ctx.tools.register(original)
    const dispose = await adapter.mount({
      manifest: defineComponentManifest({
        apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
        metadata: { name: 'example.acme.search', version: '1.0.0' },
        spec: { facets: [{
          name: 'runtime',
          activation: { apiVersion: DSH_ACTIVATION_API_VERSION, kind: DSH_ACTIVATION_KIND, spec: { module: 'search' } },
          extensions: [
            {
              apiVersion: DSH_TOOL_API_VERSION, kind: 'ToolOverride', metadata: { name: 'codex-search' },
              spec: {
                target: 'web_search', providers: ['openai-codex'], executionOnly: true,
                description: 'Use provider-native search.',
              },
            },
            {
              apiVersion: DSH_SESSION_API_VERSION, kind: 'SessionEvent', metadata: { name: 'example/search-request' },
              spec: { description: 'Search request.', replay: 'required' },
            },
          ],
        }] },
      }),
      facet: 'runtime',
      activate(activation) {
        activation.extensions.publish(
          { apiVersion: DSH_TOOL_API_VERSION, kind: 'ToolOverride' }, 'codex-search',
          { resolve: (base: FixtureTool) => ({
            ...base,
            async execute(_input: unknown, host: {
              session?: { id: string; appendEvent(type: string, data: object): void }
            }) {
              host.session?.appendEvent('example/search-request', { query: 'q' })
              return {
                data: { sources: [], truncated: false },
                content: [{ type: 'text', text: 'provider search' }],
                presentation: { sources: [], truncated: false },
              }
            },
          }) },
        )
      },
    })

    expect(tools.get('web_search', agent)).toBe(original)
    agent.options.provider = 'openai-codex'
    ctx.emit('tools/change')
    const visible = tools.get('web_search', agent)!
    expect(visible).toBe(original)
    expect(visible.presentCall).toBe(presentCall)
    expect(visible.presentResult).toBe(presentResult)
    expect(visible.timeoutMs).toBe(60_000)
    let usedOriginal = false
    const value = await agent.ctx.executeTool({
      name: 'web_search', arguments: {}, signal: new AbortController().signal, agent,
      deferContext: () => undefined,
    }, async () => {
      usedOriginal = true
      return { isError: false, value: { sources: [{ title: 'original' }] }, content: [] }
    })
    expect(events).toContainEqual({ type: 'example/search-request', data: { query: 'q' } })
    expect(usedOriginal).toBe(false)
    expect(value).toEqual({
      isError: false,
      value: { sources: [], truncated: false },
      content: [{ type: 'text', text: 'provider search' }],
      meta: { sources: [], truncated: false },
    })
    expect(visible.output?.presentationMeta?.({}, (value as { value: unknown }).value)).toEqual({ original: true })

    agent.options.provider = 'example-provider'
    ctx.emit('tools/change')
    expect(tools.get('web_search', agent)).toBe(original)
    await expect(agent.ctx.executeTool({ name: 'web_search' }, async () => 'original execution')).resolves.toBe('original execution')
    await dispose()
  })

  it('registers and executes an owned Tool with host image, workspace, observation, and deferral facilities', async () => {
    const { ctx, adapter, tools } = await fixture()
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-std-tool-workspace-'))
    temporaryRoots.push(workspace)
    writeFileSync(join(workspace, 'one.png'), new Uint8Array([1, 2, 3]))
    const image = new Uint8Array([1, 2, 3])
    const reference = {
      attachmentId: 'image-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'one.png',
    }
    const validated: unknown[] = []
    const writes: unknown[] = []
    const observed: unknown[] = []
    ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 1024, maxImagesPerMessage: 5, maxMessageImageBytes: 2048,
        maxImagePixels: 4096, mediaTypes: ['image/png'],
      },
      validateImage: async (input: unknown) => { validated.push(input) },
      saveImage: async () => reference,
      readImage: async () => ({ ref: reference, data: image }),
    } as never)
    ctx.provide('llm', {
      resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
    } as never)
    ctx.provide('sandboxPolicy', {
      resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }),
    } as never)
    const versions = new Map<string, object>()
    ctx.provide('fs', {
      sandboxMode: 'workspace-write',
      resolve: async (path: string) => ({ displayPath: path.startsWith(workspace) ? path : join(workspace, path) }),
      stat: async (target: { displayPath: string }) => existsSync(target.displayPath)
        ? { type: 'file', version: versions.get(target.displayPath) ?? (() => {
          const version = {}
          versions.set(target.displayPath, version)
          return version
        })() }
        : undefined,
      readBytes: async () => image,
      fileUrl: (target: { displayPath: string }) => target.displayPath.endsWith('out.png')
        ? new URL('ssh://example/workspace/out.png')
        : pathToFileURL(target.displayPath),
      processPath: (target: { displayPath: string }) => target.displayPath,
      contains: (parent: { displayPath: string }, child: { displayPath: string }) => {
        const path = relative(parent.displayPath, child.displayPath)
        return path === '' || (!path.startsWith('..') && !isAbsolute(path))
      },
      writeBytes: async (...args: unknown[]) => {
        writes.push(args)
        return { operation: 'update', bytes: 3, version: 'version-2' }
      },
    } as never)
    const eventContext = ctx as unknown as { on(name: string, listener: (...args: unknown[]) => unknown): void }
    eventContext.on('fs/write-intent', () => ({ kind: 'createIfAbsent' }))
    eventContext.on('fs/observed', (...args) => { observed.push(args) })

    const dispose = await adapter.mount({
      manifest: defineComponentManifest({
        apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
        metadata: { name: 'example.acme.tool', version: '1.0.0' },
        spec: { facets: [{
          name: 'runtime',
          activation: { apiVersion: DSH_ACTIVATION_API_VERSION, kind: DSH_ACTIVATION_KIND, spec: { module: 'tool' } },
          extensions: [{
            apiVersion: DSH_TOOL_API_VERSION, kind: 'Tool', metadata: { name: 'make_image' },
            spec: { title: 'Make image', description: 'Makes an image.' },
          }],
        }] },
      }),
      facet: 'runtime',
      activate(activation) {
        activation.extensions.publish(
          { apiVersion: DSH_TOOL_API_VERSION, kind: 'Tool' },
          'make_image',
          { resolve: () => ({
            name: 'make_image', description: 'Makes an image.',
            parameters: { type: 'object' }, output: { type: 'object' },
            async execute(_input: unknown, host: {
              model?: { inputModalities?: readonly string[] }
              imageLimits?: { mediaTypes: readonly string[] }
              validateImage(input: unknown): Promise<void>
              saveImage(input: unknown): Promise<{ reference: unknown }>
              recentImages(count: number): Promise<readonly unknown[]>
              readWorkspaceFile(path: string, maxBytes: number): Promise<{ data: Uint8Array }>
              writeWorkspaceFile(path: string, data: Uint8Array): Promise<unknown>
              deferContent?(content: readonly unknown[]): void
            }) {
              expect(host.model?.inputModalities).toContain('image')
              expect(host.imageLimits?.mediaTypes).toEqual(['image/png'])
              await host.validateImage({ data: image, mediaType: 'image/png' })
              const stored = await host.saveImage({ data: image, mediaType: 'image/png' })
              expect(await host.recentImages(1)).toHaveLength(1)
              expect((await host.readWorkspaceFile('one.png', 1024)).data).toEqual(image)
              await host.writeWorkspaceFile('out.png', image)
              await host.writeWorkspaceFile('local.png', image)
              const content = [{ type: 'image', reference: stored.reference }] as const
              host.deferContent?.(content)
              return { data: { ok: true }, content }
            },
          }) },
        )
      },
    })

    const definition = tools.get('make_image')
    expect(definition?.execute).toBeTypeOf('function')
    const deferred: unknown[] = []
    const result = await definition!.execute!({}, {
      signal: new AbortController().signal,
      parent: {},
      agent: {
        options: {},
        session: {
          header: { cwd: workspace },
          requestHeader: () => ({ config: { provider: 'example', model: 'vision' } }),
          deriveMessages: () => [{ content: [{ type: 'tool-result', content: [{ type: 'image', attachment: reference }] }] }],
        },
      },
      deferContext: (message: unknown) => { deferred.push(message) },
    } as never)
    expect(result).toMatchObject({ data: { ok: true } })
    expect(validated).toHaveLength(1)
    expect(writes).toHaveLength(1)
    expect((writes[0] as unknown[])[2]).toEqual({ kind: 'createIfAbsent' })
    expect((writes[0] as unknown[])[4]).toMatchObject({ mode: 'workspace-write' })
    expect(new Uint8Array(readFileSync(join(workspace, 'local.png')))).toEqual(image)
    expect(observed).toHaveLength(3)
    expect(deferred).toHaveLength(1)
    expect(definition!.output!.render({}, result)).toEqual([{ type: 'image', attachment: reference }])
    await dispose()
    expect(tools.get('make_image')).toBeUndefined()
  })

  it('keeps mounted SessionEvent resources recognizable after facet unload', async () => {
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
    expect(KNOWN_SESSION_EVENT_TYPES.has(type)).toBe(true)
  })

  it('maps a negotiated local UI host into an activation-scoped client and retracts its contributions', async () => {
    const { adapter } = await fixture()
    const surface = { apiVersion: 'tui.dsh/v1alpha1', kind: 'SettingsSection' } as const
    const registered: string[] = []
    const disposed: string[] = []
    const unregisterProvider = adapter.registerUiContributionProvider({
      participantId: 'tui/surface-host',
      support: { surfaces: [{ ...surface, modes: ['host-rendered'] }] },
      register(owner, contribution, context) {
        expect(owner.component).toBe('example.acme.ui')
        expect(context.signal.aborted).toBe(false)
        registered.push(contribution.descriptor.id)
        return () => {
          expect(context.signal.aborted).toBe(true)
          disposed.push(contribution.descriptor.id)
        }
      },
    })
    const disposeFacet = await adapter.mount({
      manifest: defineComponentManifest({
        apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
        metadata: { name: 'example.acme.ui', version: '1.0.0' },
        spec: { facets: [{
          name: 'tui',
          activation: { apiVersion: DSH_ACTIVATION_API_VERSION, kind: DSH_ACTIVATION_KIND, spec: { module: 'ui' } },
          protocols: { requires: [contributionHostRequirement({
            surfaces: [{ ...surface, mode: 'host-rendered' }],
          })] },
        }] },
      }),
      facet: 'tui',
      activate(activation) {
        const ui = activation.protocols.client<ContributionHostClient>({
          apiVersion: 'ui.dsh/v1alpha1', kind: 'ContributionHost',
        })
        expect(ui).toBeDefined()
        ui!.register({
          descriptor: { id: 'openai-codex', surface, content: { title: 'OpenAI Codex' } },
        })
      },
    })
    expect(registered).toEqual(['openai-codex'])
    await disposeFacet()
    expect(disposed).toEqual(['openai-codex'])
    await unregisterProvider()
  })
})
