import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ToolDefinition, ToolRuntime } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import {
  ProtocolCatalog,
  defineProtocolDeclaration,
  satisfiesVersionRange,
  sameProtocol,
  type ProtocolRequirement,
  type ProtocolSupport,
} from '@dsh-std/core'
import {
  ManifestDefinitionCatalog,
  defineComponentManifest,
  projectManifest,
  facetKey,
  findFacet,
  parseManifest,
  type ComponentManifest,
  type FacetIdentity,
  type ManifestExtension,
  type PluginManifest,
} from '@dsh-std/manifest'
import { CompositionRuleCatalog, compose } from '@dsh-std/composition'
import {
  ActivationDriverRegistry,
  FACET_MODULE_API_VERSION,
  FACET_MODULE_KIND,
  LifecycleCoordinator,
  PublicationRegistry,
  facetModuleActivationDefinition,
  type ActivationContext,
  type ActivationHandle,
} from '@dsh-std/lifecycle'
import {
  StandardEndpointRuntime,
  type CapabilityImplementation,
} from '@dsh-std/connection'
import {
  API_VERSION as COMMAND_API_VERSION,
  KIND as COMMAND_KIND,
  RUNTIME_KIND as COMMAND_RUNTIME_KIND,
  commandRuntimeImplementation,
  assertCommandHandler,
  extensionDefinition as commandExtensionDefinition,
  register as registerCommand,
  runtimeSupport as commandRuntimeSupport,
  type CommandCatalog,
  type CommandDescriptor,
  type CommandExecution,
  type CommandHandler,
  type CommandPresentationDescriptor,
  type CommandResource,
} from '@dsh-std/command'
import {
  API_VERSION as MODEL_API_VERSION,
  CATALOG_KIND as MODEL_CATALOG_KIND,
  PROVIDER_KIND as MODEL_PROVIDER_KIND,
  catalogSupport as modelCatalogSupport,
  modelCatalogImplementation,
  providerExtensionDefinition,
  register as registerModel,
  validateProviderStatus,
  type ModelCatalog,
  assertModelProviderHandler,
  type ModelProviderHandler,
  type ModelContentBlock,
  type ModelMessage,
  type ModelStreamChunk,
  type ModelProviderCatalogEntry,
  type ModelProviderResource,
} from '@dsh-std/model'
import {
  API_VERSION as TOOL_API_VERSION,
  OVERRIDE_KIND as TOOL_OVERRIDE_KIND,
  assertToolOverrideHandler,
  extensionDefinition as toolExtensionDefinition,
  overrideExtensionDefinition as toolOverrideExtensionDefinition,
  registerComposition as registerToolComposition,
  validateToolStatus,
  type ToolOverrideHandler,
  type ToolOverrideResource,
} from '@dsh-std/tool'
import {
  API_VERSION as SESSION_API_VERSION,
  EVENT_KIND as SESSION_EVENT_KIND,
  eventExtensionDefinition as sessionEventExtensionDefinition,
} from '@dsh-std/session'
import {
  API_VERSION as PRESENTATION_API_VERSION,
  protocols as presentationProtocols,
  register as registerPresentation,
  validateOperation,
  type Operation as PresentationOperation,
} from '@dsh-std/presentation'
import type { FacetModule } from '@dsh-std/sdk'

export const name = 'dsh-std-adapter'
export const DSH_STD_NAMESPACE = 'dshStd'
export const DSH_ACTIVATION_API_VERSION = FACET_MODULE_API_VERSION
export const DSH_ACTIVATION_KIND = FACET_MODULE_KIND
export const DSH_ACTIVATION_DRIVER_ID = '@dsh-std/adapter-dsh'

export const DSH_COMMAND_API_VERSION = COMMAND_API_VERSION
export const DSH_COMMAND_RUNTIME_KIND = COMMAND_RUNTIME_KIND
export const DSH_MODEL_API_VERSION = MODEL_API_VERSION
export const DSH_MODEL_PROVIDER_KIND = MODEL_PROVIDER_KIND
export const DSH_MODEL_CATALOG_KIND = MODEL_CATALOG_KIND
export const DSH_TOOL_API_VERSION = TOOL_API_VERSION
export const DSH_SESSION_API_VERSION = SESSION_API_VERSION
export const DSH_PRESENTATION_API_VERSION = PRESENTATION_API_VERSION
export const DSH_HOST_API_VERSION = '0.1.0'

const DSH_HOST_CAPABILITIES: Readonly<Record<string, string>> = Object.freeze({ commands: '0.1.0' })

const ADAPTER_COMPONENT = 'std.dsh.adapter-dsh'
const ADAPTER_PARTICIPANT = `${ADAPTER_COMPONENT}/runtime`

export interface AdapterConfig {
  readonly profile?: string
  /** URL of the active DSH profile directory, supplied by the host bundle. */
  readonly profileBaseUrl?: string
  readonly runtimeId?: string
  /** Discover standard component manifests from the active DSH profile. */
  readonly discover?: boolean
}

export interface DshRuntimeDescriptor {
  readonly id: string
  readonly instanceId: string
  readonly profile?: string
  readonly declaration: ReturnType<typeof defineProtocolDeclaration>
}

export interface DshExtensionStatus {
  readonly apiVersion: string
  readonly kind: string
  readonly name: string
  readonly status: unknown
}

export interface DshFacetProjection {
  readonly state?: 'active' | 'degraded'
  readonly message?: string
  readonly extensions?: readonly DshExtensionStatus[]
}

/** A product loader resolves the manifest module and gives this adapter its facet entrypoint. */
export interface DshFacetPublication {
  readonly manifest: ComponentManifest
  readonly facet: string
  activate(context: ActivationContext): void | Promise<void>
  deactivate?(reason: string): void | Promise<void>
  snapshot?(): DshFacetProjection | Promise<DshFacetProjection>
}

export interface DshFacetSnapshot extends DshFacetProjection {
  readonly identity: FacetIdentity
  readonly participantId: string
  readonly extensions: readonly DshExtensionStatus[]
}

export interface DshRuntimeSnapshot {
  readonly apiVersion: 'adapter.dsh/snapshot/v1alpha1'
  readonly runtime: DshRuntimeDescriptor
  readonly facets: readonly DshFacetSnapshot[]
}

export type DshPresentationDescriptor = CommandPresentationDescriptor
export type DshPresentationOperation = PresentationOperation
export type DshCommandCatalog = CommandCatalog
export type DshCommandExecution = CommandExecution

interface InvocationStore {
  readonly facet: MountedFacet
  readonly presentation?: DshPresentationDescriptor
  readonly operations: DshPresentationOperation[]
}

interface MountedFacet {
  readonly publication: DshFacetPublication
  readonly manifest: ComponentManifest
  readonly facet: NonNullable<ReturnType<typeof findFacet>>
  readonly handle: ActivationHandle
  readonly unregisterEndpoint: () => void
  readonly disposeProductExtensions: () => void
}

interface DshAgentLike {
  readonly id: string
  readonly ctx: { readonly tools: ToolRuntime }
}

interface InstalledToolOverride {
  readonly original: ToolDefinition
  readonly dispose: () => void
}

interface LiveToolOverride {
  readonly resource: ToolOverrideResource
  readonly handler: ToolOverrideHandler<ToolDefinition>
  readonly installed: Map<DshAgentLike, InstalledToolOverride>
  readonly unsubscribe: () => void
}

interface CommandRuntime {
  list(agent: unknown): readonly { name: string; description: string; input?: { hint: string } }[]
  execute(agent: unknown, line: string, signal: AbortSignal): Promise<{
    commandId: string
    result: { kind: 'success' | 'error'; text?: string; sourceEventSeq?: number }
  } | undefined>
  register(definition: {
    readonly name: string
    readonly description: string
    readonly input?: { readonly hint: string }
    readonly handler: (invocation: { readonly rawInput: string; readonly signal: AbortSignal }) =>
      CommandExecution['result'] | Promise<CommandExecution['result']>
  }): () => void
}

/** Product binding for standard ToolOverride declarations. */
class DshToolOverrideRegistry {
  private readonly overrides = new Map<string, LiveToolOverride>()
  private syncing = false

  constructor(private readonly ctx: Context) {
    ctx.on('agent/created', ({ agent }) => { this.syncAgent(agent as DshAgentLike) })
    ctx.on('agent/disposed', ({ agent }) => { this.forgetAgent(agent as DshAgentLike) })
    ctx.on('tools/change', () => { this.syncAll() })
  }

  register(resource: ToolOverrideResource, candidate: unknown): () => void {
    assertToolOverrideHandler(candidate)
    const handler = candidate as ToolOverrideHandler<ToolDefinition>
    const target = resource.spec.target
    if (this.overrides.has(target)) throw new Error(`tool ${JSON.stringify(target)} already has a live ToolOverride`)
    const live: LiveToolOverride = {
      resource,
      handler,
      installed: new Map(),
      unsubscribe: handler.subscribe?.(() => { this.syncAll() }) ?? (() => undefined),
    }
    this.overrides.set(target, live)
    try { this.syncAll() } catch (error) {
      this.overrides.delete(target)
      live.unsubscribe()
      this.disposeOverride(live)
      throw error
    }
    return () => {
      if (this.overrides.get(target) !== live) return
      this.overrides.delete(target)
      live.unsubscribe()
      this.disposeOverride(live)
    }
  }

  private syncAll(): void {
    if (this.syncing || this.overrides.size === 0) return
    this.syncing = true
    try {
      const agents = this.ctx.get('agents') as unknown as { list(): DshAgentLike[] } | undefined
      if (agents === undefined) throw new Error('ToolOverride requires the DSH agents service')
      const liveAgents = agents.list()
      for (const agent of liveAgents) this.syncAgent(agent)
      const current = new Set(liveAgents)
      for (const override of this.overrides.values()) {
        for (const agent of [...override.installed.keys()]) if (!current.has(agent)) this.remove(override, agent)
      }
    } finally {
      this.syncing = false
    }
  }

  private syncAgent(agent: DshAgentLike): void {
    const tools = this.ctx.get('tools') as ToolRuntime | undefined
    if (tools === undefined) throw new Error('ToolOverride requires the DSH tools service')
    for (const override of this.overrides.values()) {
      const target = override.resource.spec.target
      const current = override.installed.get(agent)
      const original = tools.get(target)
      if (original === undefined) {
        if (current !== undefined) this.remove(override, agent)
        continue
      }
      if (current?.original === original) continue
      if (current !== undefined) this.remove(override, agent)
      if (tools.get(target, agent as never) !== original) continue
      const replacement = override.handler.resolve(original)
      if (replacement === undefined) continue
      if (replacement.name !== target) {
        throw new TypeError(`ToolOverride for ${JSON.stringify(target)} returned tool ${JSON.stringify(replacement.name)}`)
      }
      const dispose = agent.ctx.tools.register(replacement)
      override.installed.set(agent, { original, dispose })
    }
  }

  private forgetAgent(agent: DshAgentLike): void {
    for (const override of this.overrides.values()) override.installed.delete(agent)
  }

  private remove(override: LiveToolOverride, agent: DshAgentLike): void {
    const installed = override.installed.get(agent)
    if (installed === undefined) return
    override.installed.delete(agent)
    installed.dispose()
  }

  private disposeOverride(override: LiveToolOverride): void {
    for (const agent of [...override.installed.keys()]) this.remove(override, agent)
  }
}

/** Product binding for component-owned durable session event vocabularies. */
class DshSessionEventRegistry {
  private readonly baseline = new Set(KNOWN_SESSION_EVENT_TYPES)
  private readonly owned = new Map<string, number>()
  private readonly vocabulary: Set<string>

  constructor() {
    if (!(KNOWN_SESSION_EVENT_TYPES instanceof Set)) {
      throw new Error('this DSH build does not expose an extensible session event vocabulary')
    }
    this.vocabulary = KNOWN_SESSION_EVENT_TYPES as Set<string>
  }

  register(type: string): () => void {
    const count = this.owned.get(type) ?? 0
    this.owned.set(type, count + 1)
    this.vocabulary.add(type)
    let active = true
    return () => {
      if (!active) return
      active = false
      const next = (this.owned.get(type) ?? 1) - 1
      if (next > 0) this.owned.set(type, next)
      else {
        this.owned.delete(type)
        if (!this.baseline.has(type)) this.vocabulary.delete(type)
      }
    }
  }
}

function toStandardBlock(block: ContentBlock): ModelContentBlock {
  if (block.type === 'image') return { type: 'image', reference: block.attachment }
  if (block.type === 'tool-result') return {
    type: 'tool-result', toolCallId: String(block.toolCallId),
    content: block.content.map(toStandardBlock),
    ...(block.isError === undefined ? {} : { isError: block.isError }),
  }
  if (block.type === 'tool-call') return {
    type: 'tool-call', id: String(block.id), name: block.name, arguments: block.arguments,
  }
  return { type: block.type, text: block.text }
}

function toStandardMessage(message: Message): ModelMessage {
  return {
    role: message.role,
    content: message.content.map(toStandardBlock),
    source: structuredClone(message.source) as Readonly<Record<string, unknown>>,
  }
}

function fromStandardBlock(block: ModelContentBlock): ContentBlock {
  if (block.type === 'image') return { type: 'image', attachment: block.reference as never }
  if (block.type === 'tool-result') return {
    type: 'tool-result', toolCallId: block.toolCallId as never,
    content: block.content.map(fromStandardBlock),
    ...(block.isError === undefined ? {} : { isError: block.isError }),
  }
  if (block.type === 'tool-call') return {
    type: 'tool-call', id: block.id as never, name: block.name, arguments: block.arguments,
  }
  return { type: block.type, text: block.text }
}

function fromStandardChunk(chunk: ModelStreamChunk): StreamChunk {
  if (chunk.type === 'block-end') return { ...chunk, block: fromStandardBlock(chunk.block) }
  return chunk as StreamChunk
}

class DshStandardModelAdapter extends LlmAdapter {
  constructor(
    private readonly provider: string,
    private readonly handler: ModelProviderHandler,
    private readonly attachments: () => AttachmentStore | undefined,
  ) { super() }

  providerInfo(provider: string): { id: string; name: string } {
    if (provider !== this.provider) throw new Error(`model provider ${JSON.stringify(provider)} is not owned by this adapter`)
    return { id: provider, name: provider }
  }

  async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    this.providerInfo(provider)
    return (await this.handler.listModels()).map(model => ({
      provider, id: model.id, name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
      ...(model.inputModalities === undefined ? {} : { inputModalities: model.inputModalities }),
    }))
  }

  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const known = (await this.listModels(provider)).find(row => row.id === model)
    const descriptor = (await this.handler.listModels()).find(row => row.id === model)
    return {
      ...(known ?? { provider, id: model, name: model }),
      ...(descriptor?.contextWindow === undefined ? {} : { context: { contextWindow: descriptor.contextWindow } }),
      ...(descriptor?.maxTokens === undefined ? {} : { defaultMaxTokens: descriptor.maxTokens }),
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = options.signal ?? new AbortController().signal
    const { signal: _signal, sessionId, ...base } = options
    const request = {
      ...base,
      messages: options.messages.map(toStandardMessage),
      ...(sessionId === undefined ? {} : { sessionId: String(sessionId) }),
    }
    for await (const chunk of this.handler.stream(request as never, {
      signal,
      readImage: async reference => {
        const store = this.attachments()
        if (store === undefined) throw new Error('model requested an image but the DSH attachment service is unavailable')
        const image = await store.readImage(reference as never, signal)
        return { data: image.data, mediaType: image.ref.mediaType }
      },
    })) yield fromStandardChunk(chunk)
  }
}

/** Product binding for executable standard Command extensions. */
class DshCommandExtensionRegistry {
  constructor(
    private readonly commands: () => CommandRuntime,
    private readonly presentation: () => DshPresentationDescriptor | undefined,
    private readonly present: (operation: DshPresentationOperation) => boolean,
  ) {}

  register(resource: CommandResource, candidate: unknown): () => void {
    assertCommandHandler(candidate)
    const handler = candidate as CommandHandler
    return this.commands().register({
      name: resource.metadata.name,
      description: resource.spec.description ?? resource.spec.title,
      input: { hint: 'subcommand' },
      handler: invocation => {
        const presentation = this.presentation()
        return handler.execute(
          { rawInput: invocation.rawInput },
          {
            signal: invocation.signal,
            ...(presentation === undefined ? {} : { presentation }),
            present: operation => this.present(operation),
          },
        )
      },
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { dshStd: DshStandardAdapter }
}

export class DshStandardAdapter extends TypertRemoteService {
  static inject = ['agents', 'commands', 'llm']
  static Config = z.object({
    profile: z.string(),
    profileBaseUrl: z.string(),
    runtimeId: z.string().default('dsh'),
    discover: z.boolean().default(true),
  })

  readonly protocols = createDshProtocolCatalog()
  readonly manifestDefinitions = createDshManifestCatalog()
  readonly drivers = new ActivationDriverRegistry()
  readonly publications = new PublicationRegistry()
  readonly compositionRules = new CompositionRuleCatalog()
  readonly lifecycle: LifecycleCoordinator
  readonly connectionEndpoint: StandardEndpointRuntime
  readonly runtime: DshRuntimeDescriptor

  private readonly selfCtx: Context
  private readonly manifests = new Map<string, ComponentManifest>()
  private readonly facets = new Map<string, MountedFacet>()
  private readonly pending = new Map<string, DshFacetPublication>()
  private readonly activeEntrypoints = new Map<string, DshFacetPublication>()
  private readonly invocation = new AsyncLocalStorage<InvocationStore>()
  private readonly toolOverrides: DshToolOverrideRegistry
  private readonly sessionEvents = new DshSessionEventRegistry()
  private readonly commandExtensions: DshCommandExtensionRegistry

  constructor(ctx: Context, config: AdapterConfig) {
    super(ctx, 'dshStd', { namespace: DSH_STD_NAMESPACE })
    this.selfCtx = ctx
    this.toolOverrides = new DshToolOverrideRegistry(ctx)
    this.commandExtensions = new DshCommandExtensionRegistry(
      () => this.commands(),
      () => this.presentation(),
      operation => this.present(operation),
    )
    registerToolComposition(this.compositionRules)
    this.lifecycle = new LifecycleCoordinator(this.protocols, this.drivers, this.publications)
    const instanceId = randomUUID()
    // A Loader entry's scoped context is anchored at the package that owns the
    // entry. The active profile is therefore passed while the bundle patch is
    // still evaluated in the root Loader context; guessing it from this
    // plugin's ctx.baseUrl discovers the adapter package instead.
    const profileBaseUrl = config.profileBaseUrl?.trim() || ctx.baseUrl
    const profile = config.profile?.trim() || profileFromBaseUrl(profileBaseUrl)
    const declaration = defineProtocolDeclaration({
      participant: { id: ADAPTER_PARTICIPANT },
      supports: [commandRuntimeSupport, modelCatalogSupport],
    })
    this.runtime = Object.freeze({
      id: config.runtimeId?.trim() || 'dsh', instanceId,
      ...(profile === undefined ? {} : { profile }), declaration,
    })
    this.connectionEndpoint = new StandardEndpointRuntime({ id: this.runtime.id, instanceId })
    this.connectionEndpoint.register({ declaration, implementations: this.standardImplementations() })
    this.publications.publish({
      identity: Object.freeze({
        component: ADAPTER_COMPONENT, version: '0.1.0', facet: 'runtime',
        instanceId: `${instanceId}:runtime`, participantId: ADAPTER_PARTICIPANT,
      }),
      declaration,
      protocols: Object.freeze(this.standardImplementations().map(implementation => Object.freeze({
        support: implementation.protocol, implementation,
      }))),
      extensions: Object.freeze([]),
    })
    this.drivers.register({
      id: DSH_ACTIVATION_DRIVER_ID,
      apiVersion: DSH_ACTIVATION_API_VERSION,
      kind: DSH_ACTIVATION_KIND,
      activate: async ({ selected, context }) => {
        const publication = this.pending.get(facetKey(selected.identity))
        if (publication === undefined) throw new Error(`no entrypoint was supplied for ${facetKey(selected.identity)}`)
        this.activeEntrypoints.set(context.identity.instanceId, publication)
        await publication.activate(context)
      },
      deactivate: async (identity, reason) => {
        const publication = this.activeEntrypoints.get(identity.instanceId)
        this.activeEntrypoints.delete(identity.instanceId)
        await publication?.deactivate?.(reason)
      },
    })
    ctx.effect(() => async () => {
      for (const [key, mounted] of [...this.facets.entries()].reverse()) {
        this.facets.delete(key)
        mounted.disposeProductExtensions()
        mounted.unregisterEndpoint()
        await mounted.handle.deactivate('adapter disposed')
      }
      this.manifests.clear()
    }, '@dsh-std/adapter-dsh lifecycle')
    for (const initialize of REMOTE_INITIALIZERS) initialize.call(this)
  }

  /** Discover and activate every portable FacetModule installed in one profile. */
  async mountProfileComponents(profileDir: string): Promise<ReadonlyArray<() => Promise<void>>> {
    const manifestPath = join(profileDir, 'package.json')
    if (!existsSync(manifestPath)) return Object.freeze([])
    const profile = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
    const disposers: Array<() => Promise<void>> = []
    try {
      for (const packageName of Object.keys(profile.dependencies ?? {}).sort()) {
        const packageDir = packageDirectory(manifestPath, packageName)
        if (packageDir === undefined) continue
        const standardPath = join(packageDir, 'dsh-plugin.json')
        if (!existsSync(standardPath)) continue
        const portableManifest = parseManifest(readFileSync(standardPath, 'utf8'), { source: standardPath })
        assertHostCompatibility(portableManifest)
        const manifest = projectManifest(portableManifest)
        for (const facet of manifest.spec.facets) {
          if (facet.activation?.apiVersion !== FACET_MODULE_API_VERSION
            || facet.activation.kind !== FACET_MODULE_KIND) continue
          const spec = facetModuleActivationDefinition.validateSpec(facet.activation.spec)
          const resolved = createRequire(manifestPath).resolve(spec.module)
          const namespace = await import(pathToFileURL(resolved).href) as Record<string, unknown>
          const module = namespace.default ?? namespace.facet
          assertFacetModule(module, spec.module)
          disposers.push(await this.mount({
            manifest,
            facet: facet.name,
            activate: context => module.activate(context),
            ...(module.deactivate === undefined ? {} : { deactivate: reason => module.deactivate?.(reason) }),
            ...(module.snapshot === undefined ? {} : { snapshot: () => module.snapshot?.() ?? {} }),
          }))
        }
      }
      return Object.freeze(disposers)
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      throw error
    }
  }

  describe(): { readonly runtime: DshRuntimeDescriptor; readonly apiVersion: 'adapter.dsh/v1alpha1' } {
    return Object.freeze({ runtime: this.runtime, apiVersion: 'adapter.dsh/v1alpha1' })
  }

  async snapshot(): Promise<DshRuntimeSnapshot> {
    const facets: DshFacetSnapshot[] = []
    for (const mounted of [...this.facets.values()].sort((a, b) => facetKey(identityOf(a)).localeCompare(facetKey(identityOf(b))))) {
      facets.push(await this.facetSnapshot(mounted))
    }
    return Object.freeze({
      apiVersion: 'adapter.dsh/snapshot/v1alpha1', runtime: this.runtime, facets: Object.freeze(facets),
    })
  }

  /** Activate exactly one manifest facet through the standard lifecycle publication barrier. */
  async mount(input: DshFacetPublication): Promise<() => Promise<void>> {
    const manifest = defineComponentManifest(input.manifest)
    const facet = findFacet(manifest, input.facet)
    if (facet === undefined) throw new TypeError(`component has no facet ${JSON.stringify(input.facet)}`)
    if (facet.activation === undefined
      || facet.activation.apiVersion !== DSH_ACTIVATION_API_VERSION
      || facet.activation.kind !== DSH_ACTIVATION_KIND) {
      throw new TypeError(`facet ${JSON.stringify(input.facet)} is not activated by ${DSH_ACTIVATION_API_VERSION} ${DSH_ACTIVATION_KIND}`)
    }
    const validation = this.manifestDefinitions.validate(manifest, this.protocols)
    if (!validation.compatible) throw new Error(validation.issues.filter(row => row.severity === 'error').map(row => row.message).join('; '))
    const identity = Object.freeze({ component: manifest.metadata.name, version: manifest.metadata.version, facet: facet.name })
    const key = facetKey(identity)
    if (this.facets.has(key) || this.pending.has(key)) throw new Error(`facet ${key} is already mounted`)
    const installed = this.manifests.get(manifest.metadata.name)
    if (installed !== undefined && installed.metadata.version !== manifest.metadata.version) {
      throw new Error(`component ${JSON.stringify(manifest.metadata.name)} is already mounted at version ${installed.metadata.version}`)
    }
    const manifests = [...this.manifests.values()].filter(row => row.metadata.name !== manifest.metadata.name)
    manifests.push(manifest)
    const plan = compose({
      manifests,
      drivers: this.drivers.descriptors(),
      protocols: this.protocols,
      liveDeclarations: this.publications.declarations(),
      liveExtensions: [...this.facets.values()].flatMap(mounted =>
        (mounted.facet.extensions ?? []).map(extension => ({ owner: identityOf(mounted), extension }))),
      select: [{ component: identity.component, facet: identity.facet, required: true }],
    }, this.compositionRules)
    if (!plan.compatible) throw new Error(`facet ${key} cannot be composed: ${plan.issues.filter(row => row.severity === 'error').map(row => row.message).join('; ')}`)

    this.pending.set(key, input)
    let handle: ActivationHandle
    try {
      const handles = await this.lifecycle.activate(plan)
      if (handles.length !== 1) throw new Error(`facet ${key} did not produce one activation instance`)
      handle = handles[0] as ActivationHandle
    } finally {
      this.pending.delete(key)
    }
    const publication = this.publications.get(handle.identity.instanceId)
    if (publication === undefined) {
      await handle.deactivate('publication missing')
      throw new Error(`facet ${key} did not cross the publication barrier`)
    }
    let unregisterEndpoint: () => void
    try {
      unregisterEndpoint = this.connectionEndpoint.register({
        declaration: publication.declaration,
        implementations: publication.protocols.map(row => capabilityImplementation(handle.identity.participantId, row.support, row.implementation)),
      })
    } catch (error) {
      await handle.deactivate('connection publication failed')
      throw error
    }
    let disposeProductExtensions: () => void
    try {
      disposeProductExtensions = this.installProductExtensions(facet, publication)
    } catch (error) {
      unregisterEndpoint()
      await handle.deactivate('product extension publication failed')
      throw error
    }
    const mounted: MountedFacet = { publication: input, manifest, facet, handle, unregisterEndpoint, disposeProductExtensions }
    this.manifests.set(manifest.metadata.name, manifest)
    this.facets.set(key, mounted)
    let active = true
    return async () => {
      if (!active) return
      active = false
      if (this.facets.get(key) !== mounted) return
      this.facets.delete(key)
      disposeProductExtensions()
      unregisterEndpoint()
      await handle.deactivate('facet unmounted')
      if (![...this.facets.values()].some(row => row.manifest.metadata.name === manifest.metadata.name)) {
        this.manifests.delete(manifest.metadata.name)
      }
    }
  }

  catalog(sessionId: string, presentation: DshPresentationDescriptor | undefined): DshCommandCatalog {
    validatePresentation(presentation)
    const live = this.commands().list(this.agent(sessionId))
    const descriptors: CommandDescriptor[] = []
    for (const mounted of this.facets.values()) {
      const publication = this.publications.get(mounted.handle.identity.instanceId)
      if (publication === undefined) continue
      for (const row of publication.extensions) {
        if (!sameProtocol(row.extension, { apiVersion: COMMAND_API_VERSION, kind: COMMAND_KIND })) continue
        const command = live.find(candidate => candidate.name === row.extension.metadata.name)
        if (command === undefined) continue
        const unavailablePresentation = missingPresentation(mounted.facet.protocols?.requires ?? [], presentation)
        descriptors.push(Object.freeze({
          name: command.name,
          description: command.description,
          ...(command.input === undefined ? {} : { input: Object.freeze({ hint: command.input.hint }) }),
          owner: ownerOf(mounted), resource: row.extension as CommandResource,
          available: unavailablePresentation.length === 0,
          missingPresentation: unavailablePresentation,
          issues: Object.freeze([]),
        }))
      }
    }
    descriptors.sort((a, b) => a.name.localeCompare(b.name))
    return Object.freeze({ apiVersion: COMMAND_API_VERSION, commands: Object.freeze(descriptors) })
  }

  async execute(
    sessionId: string, line: string, presentation: DshPresentationDescriptor | undefined, signal: AbortSignal,
  ): Promise<DshCommandExecution | undefined> {
    validatePresentation(presentation)
    const root = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line)?.[1]
    if (root === undefined) return undefined
    const facet = this.commandOwner(root)
    if (facet === undefined) return undefined
    const missing = missingPresentation(facet.facet.protocols?.requires ?? [], presentation)
    if (missing.length > 0) throw new Error(`command requires unavailable presentation protocols: ${missing.map(row => `${row.apiVersion} ${row.kind}`).join(', ')}`)
    const store: InvocationStore = { facet, ...(presentation === undefined ? {} : { presentation }), operations: [] }
    return await this.invocation.run(store, async () => {
      const execution = await this.commands().execute(this.agent(sessionId), line, signal)
      if (execution === undefined) return undefined
      return Object.freeze({
        apiVersion: COMMAND_API_VERSION,
        commandId: execution.commandId,
        result: execution.result,
        operations: Object.freeze([...store.operations]),
      })
    })
  }

  presentation(): DshPresentationDescriptor | undefined { return this.invocation.getStore()?.presentation }

  present(operation: DshPresentationOperation): boolean {
    validateOperation(operation)
    const store = this.invocation.getStore()
    if (store === undefined) return false
    const reference = { apiVersion: operation.apiVersion, kind: operation.kind }
    const declared = (store.facet.facet.protocols?.requires ?? []).some(row => sameProtocol(row, reference))
    if (!declared) throw new Error(`facet ${facetKey(identityOf(store.facet))} used undeclared protocol ${operation.apiVersion} ${operation.kind}`)
    if (!(store.presentation?.contracts ?? []).some(row => sameProtocol(row, reference))) return false
    store.operations.push(Object.freeze(structuredClone(operation)))
    return true
  }

  private commandOwner(name: string): MountedFacet | undefined {
    for (const mounted of this.facets.values()) {
      const publication = this.publications.get(mounted.handle.identity.instanceId)
      if (publication?.extensions.some(row => sameProtocol(row.extension, { apiVersion: COMMAND_API_VERSION, kind: COMMAND_KIND })
        && row.extension.metadata.name === name) === true) return mounted
    }
    return undefined
  }

  private installProductExtensions(
    facet: NonNullable<ReturnType<typeof findFacet>>,
    publication: NonNullable<ReturnType<PublicationRegistry['get']>>,
  ): () => void {
    const disposers: Array<() => void> = []
    try {
      for (const extension of facet.extensions ?? []) {
        if (sameProtocol(extension, { apiVersion: COMMAND_API_VERSION, kind: COMMAND_KIND })) {
          const published = publication.extensions.find(row => row.extension === extension
            || (sameProtocol(row.extension, extension) && row.extension.metadata.name === extension.metadata.name))
          if (published !== undefined && record(published.handler) && typeof published.handler.execute === 'function') {
            disposers.push(this.commandExtensions.register(extension as CommandResource, published.handler))
          }
        }
        if (sameProtocol(extension, { apiVersion: MODEL_API_VERSION, kind: MODEL_PROVIDER_KIND })) {
          const published = publication.extensions.find(row => row.extension === extension
            || (sameProtocol(row.extension, extension) && row.extension.metadata.name === extension.metadata.name))
          if (published === undefined || !record(published.handler)
            || typeof published.handler.listModels !== 'function' || typeof published.handler.stream !== 'function') continue
          assertModelProviderHandler(published.handler)
          const registerAdapter = (ctx: Context): (() => void) => ctx.llm.registerAdapter(
            [extension.metadata.name],
            new DshStandardModelAdapter(
              extension.metadata.name,
              published.handler as ModelProviderHandler,
              () => this.selfCtx.get('attachments'),
            ),
          )
          const llm = this.selfCtx.get('llm')
          if (llm !== undefined) disposers.push(registerAdapter(this.selfCtx))
          else {
            const fiber = this.selfCtx.inject(['llm'], modelCtx => {
              modelCtx.effect(() => registerAdapter(modelCtx), `standard ModelProvider ${extension.metadata.name}`)
            })
            disposers.push(() => { void fiber.dispose() })
          }
        }
        if (sameProtocol(extension, { apiVersion: TOOL_API_VERSION, kind: TOOL_OVERRIDE_KIND })) {
          const published = publication.extensions.find(row => row.extension === extension
            || (sameProtocol(row.extension, extension) && row.extension.metadata.name === extension.metadata.name))
          if (published === undefined) {
            throw new Error(`ToolOverride ${JSON.stringify(extension.metadata.name)} did not publish a runtime handler`)
          }
          disposers.push(this.toolOverrides.register(extension as ToolOverrideResource, published.handler))
        }
        if (sameProtocol(extension, { apiVersion: SESSION_API_VERSION, kind: SESSION_EVENT_KIND })) {
          disposers.push(this.sessionEvents.register(extension.metadata.name))
        }
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      for (const dispose of disposers.reverse()) dispose()
    }
  }

  private async facetSnapshot(mounted: MountedFacet): Promise<DshFacetSnapshot> {
    let projection: DshFacetProjection
    try { projection = await mounted.publication.snapshot?.() ?? {} } catch (error) {
      projection = { state: 'degraded', message: errorMessage(error) }
    }
    const declared = this.publications.get(mounted.handle.identity.instanceId)?.extensions ?? []
    let supplied = projection.extensions ?? []
    try {
      for (const status of supplied) {
        if (!declared.some(row => sameProtocol(row.extension, status) && row.extension.metadata.name === status.name)) {
          throw new TypeError(`snapshot status belongs to an unpublished extension ${status.apiVersion} ${status.kind} ${status.name}`)
        }
        if (sameProtocol(status, { apiVersion: MODEL_API_VERSION, kind: MODEL_PROVIDER_KIND })) validateProviderStatus(status.status)
        if (sameProtocol(status, { apiVersion: TOOL_API_VERSION, kind: 'Tool' })) validateToolStatus(status.status)
      }
    } catch (error) {
      projection = { ...projection, state: 'degraded', message: errorMessage(error), extensions: [] }
      supplied = []
    }
    return Object.freeze({
      identity: identityOf(mounted), participantId: mounted.handle.identity.participantId,
      state: projection.state ?? 'active',
      ...(projection.message === undefined ? {} : { message: projection.message }),
      extensions: Object.freeze(supplied.map(row => Object.freeze(structuredClone(row)))),
    })
  }

  private async modelCatalog(): Promise<ModelCatalog> {
    const snapshot = await this.snapshot()
    const states = new Map(snapshot.facets.map(row => [facetKey(row.identity), row]))
    const providers: ModelProviderCatalogEntry[] = []
    for (const mounted of this.facets.values()) {
      const publication = this.publications.get(mounted.handle.identity.instanceId)
      const state = states.get(facetKey(identityOf(mounted)))
      if (publication === undefined || state === undefined) continue
      for (const row of publication.extensions) {
        if (!sameProtocol(row.extension, { apiVersion: MODEL_API_VERSION, kind: MODEL_PROVIDER_KIND })) continue
        const status = state.extensions.find(candidate => sameProtocol(candidate, row.extension)
          && candidate.name === row.extension.metadata.name)?.status
        providers.push(Object.freeze({
          owner: ownerOf(mounted), state: state.state ?? 'active',
          ...(state.message === undefined ? {} : { message: state.message }),
          resource: Object.freeze({ ...row.extension, ...(status === undefined ? {} : { status }) }) as ModelProviderResource,
        }))
      }
    }
    providers.sort((a, b) => a.resource.metadata.name.localeCompare(b.resource.metadata.name))
    return Object.freeze({ apiVersion: MODEL_API_VERSION, providers: Object.freeze(providers) })
  }

  private standardImplementations(): readonly CapabilityImplementation[] {
    return Object.freeze([
      commandRuntimeImplementation(ADAPTER_PARTICIPANT, {
        catalog: input => this.catalog(input.contextId, input.presentation),
        execute: (input, context) => this.execute(input.contextId, input.line, input.presentation, context.signal),
      }),
      modelCatalogImplementation(ADAPTER_PARTICIPANT, {
        list: () => this.modelCatalog(),
        get: async input => (await this.modelCatalog()).providers.find(provider => provider.resource.metadata.name === input.name),
      }),
    ])
  }

  private agent(sessionId: string): unknown {
    nonEmpty(sessionId, 'sessionId')
    const agent = (this.selfCtx.get('agents') as unknown as { get(id: string): unknown }).get(sessionId)
    if (agent === undefined) throw new Error(`session ${JSON.stringify(sessionId)} is not attached`)
    return agent
  }

  private commands(): CommandRuntime { return this.selfCtx.get('commands') as unknown as CommandRuntime }
}

export function createDshProtocolCatalog(): ProtocolCatalog {
  const catalog = new ProtocolCatalog({ name: '@dsh-std/adapter-dsh', version: '0.1.0' })
  registerCommand(catalog)
  registerModel(catalog)
  registerPresentation(catalog)
  return catalog
}

export function createDshManifestCatalog(): ManifestDefinitionCatalog {
  const catalog = new ManifestDefinitionCatalog()
  catalog.registerActivation(facetModuleActivationDefinition)
  catalog.registerExtension(commandExtensionDefinition)
  catalog.registerExtension(providerExtensionDefinition)
  catalog.registerExtension(toolExtensionDefinition)
  catalog.registerExtension(toolOverrideExtensionDefinition)
  catalog.registerExtension(sessionEventExtensionDefinition)
  return catalog
}

const REMOTE_INITIALIZERS: Array<(this: DshStandardAdapter) => void> = []
for (const method of ['describe', 'snapshot', 'catalog', 'execute'] as const) {
  const implementation = DshStandardAdapter.prototype[method]
  const applyRemote = Remote as unknown as (
    value: (...args: never[]) => unknown,
    context: { name: string; private: boolean; static: boolean; addInitializer(initializer: (this: DshStandardAdapter) => void): void },
  ) => void
  applyRemote(implementation as (...args: never[]) => unknown, {
    name: method, private: false, static: false,
    addInitializer: initializer => { REMOTE_INITIALIZERS.push(initializer) },
  })
}

function capabilityImplementation(
  participantId: string, support: ProtocolSupport, value: unknown,
): CapabilityImplementation {
  if (!record(value) || typeof value.handle !== 'function') throw new TypeError('staged protocol implementation must be a CapabilityImplementation')
  const implementation = value as unknown as CapabilityImplementation
  if (implementation.participantId !== participantId) throw new TypeError(`implementation participantId must be ${JSON.stringify(participantId)}`)
  if (!sameProtocol(implementation.protocol, support)) throw new TypeError('implementation protocol differs from its staged support')
  return implementation
}

function identityOf(mounted: MountedFacet): FacetIdentity {
  return Object.freeze({
    component: mounted.manifest.metadata.name,
    version: mounted.manifest.metadata.version,
    facet: mounted.facet.name,
  })
}

function ownerOf(mounted: MountedFacet): { component: string; facet: string; participantId: string } {
  return Object.freeze({
    component: mounted.manifest.metadata.name,
    facet: mounted.facet.name,
    participantId: mounted.handle.identity.participantId,
  })
}

function missingPresentation(
  requirements: readonly ProtocolRequirement[], presentation: DshPresentationDescriptor | undefined,
): readonly ProtocolSupport[] {
  const available = presentation?.contracts ?? []
  return Object.freeze(requirements.filter(requirement =>
    requirement.optional !== true
    && presentationProtocols.some(definition => sameProtocol(definition, requirement))
    && !available.some(support => sameProtocol(support, requirement)),
  ).map(requirement => Object.freeze({
    apiVersion: requirement.apiVersion,
    kind: requirement.kind,
    ...(requirement.spec === undefined ? {} : { spec: requirement.spec }),
  })))
}

function validatePresentation(value: DshPresentationDescriptor | undefined): void {
  if (value === undefined) return
  if (!record(value)) throw new TypeError('presentation must be an object')
  exact(value, ['clientId', 'contracts'], 'presentation')
  nonEmpty(value.clientId, 'presentation.clientId')
  if (!Array.isArray(value.contracts)) throw new TypeError('presentation.contracts must be an array')
  for (const row of value.contracts) {
    if (!record(row)) throw new TypeError('presentation contract must be an object')
    nonEmpty(row.apiVersion, 'presentation contract.apiVersion')
    nonEmpty(row.kind, 'presentation contract.kind')
  }
}

function profileFromBaseUrl(baseUrl: string | URL | undefined): string | undefined {
  if (baseUrl === undefined) return undefined
  try {
    const path = typeof baseUrl === 'string' ? fileURLToPath(new URL(baseUrl)) : fileURLToPath(baseUrl)
    return basename(path) || undefined
  } catch { return undefined }
}

function profileDirectoryFromBaseUrl(baseUrl: string | URL | undefined): string | undefined {
  if (baseUrl === undefined) return undefined
  try {
    const path = typeof baseUrl === 'string' ? fileURLToPath(new URL(baseUrl)) : fileURLToPath(baseUrl)
    // DSH anchors Cordis at the profile directory itself. A file URL ending in
    // `/` therefore resolves to that directory, not to a config file inside it.
    return /[/\\]$/u.test(path) ? path.replace(/[/\\]+$/u, '') : dirname(path)
  } catch { return undefined }
}

function packageDirectory(anchor: string, packageName: string): string | undefined {
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

function assertFacetModule(value: unknown, module: string): asserts value is FacetModule {
  if (!record(value) || typeof value.activate !== 'function') {
    throw new TypeError(`FacetModule ${JSON.stringify(module)} must export defineFacet(...) as default`)
  }
  if (value.deactivate !== undefined && typeof value.deactivate !== 'function') {
    throw new TypeError(`FacetModule ${JSON.stringify(module)} deactivate must be a function`)
  }
  if (value.snapshot !== undefined && typeof value.snapshot !== 'function') {
    throw new TypeError(`FacetModule ${JSON.stringify(module)} snapshot must be a function`)
  }
}

function assertHostCompatibility(manifest: PluginManifest): void {
  if (!satisfiesVersionRange(DSH_HOST_API_VERSION, manifest.apiVersion)) {
    throw new Error(`plugin ${JSON.stringify(manifest.id)} requires Host API ${manifest.apiVersion}; adapter provides ${DSH_HOST_API_VERSION}`)
  }
  for (const [id, range] of Object.entries(manifest.capabilities?.required ?? {})) {
    const provided = DSH_HOST_CAPABILITIES[id]
    if (provided === undefined) throw new Error(`plugin ${JSON.stringify(manifest.id)} requires unavailable capability ${JSON.stringify(id)}`)
    if (!satisfiesVersionRange(provided, range)) {
      throw new Error(`plugin ${JSON.stringify(manifest.id)} requires capability ${id} ${range}; adapter provides ${provided}`)
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key) && !key.startsWith('x-'))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/**
 * DSH Loader entrypoint. Component activation runs as plugin initialization,
 * not inside a Cordis effect setup: product registrations such as
 * `llm.registerAdapter()` create their own caller-owned effects and must not
 * be nested under a still-pending setup effect on the same fiber.
 */
export async function apply(ctx: Context, config: AdapterConfig = {}): Promise<void> {
  const adapter = new DshStandardAdapter(ctx, config)
  if (config.discover === false) return
  const profileBaseUrl = config.profileBaseUrl?.trim() || ctx.baseUrl
  const profileDir = profileDirectoryFromBaseUrl(profileBaseUrl)
  if (profileDir === undefined) return
  const disposers = await adapter.mountProfileComponents(profileDir)
  ctx.effect(() => async () => {
    for (const dispose of [...disposers].reverse()) await dispose()
  }, '@dsh-std/adapter-dsh component discovery')
}

apply.inject = DshStandardAdapter.inject
apply.Config = DshStandardAdapter.Config

export default apply
