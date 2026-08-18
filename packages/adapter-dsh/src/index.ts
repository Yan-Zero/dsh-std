import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  ToolDefinition,
  ToolExecutionResult as DshToolExecutionResult,
  ToolRunContext,
  ToolRuntime,
} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import {
  ProtocolCatalog,
  defineProtocolDeclaration,
  sameProtocol,
  validateApiReference,
  type ApiReference,
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
  type CapabilityClient,
  type CapabilityImplementation,
} from '@dsh-std/connection'
import { createMemoryConnectionPair } from '@dsh-std/connection/memory'
import {
  API_VERSION as COMMAND_API_VERSION,
  KIND as COMMAND_KIND,
  RUNTIME_KIND as COMMAND_RUNTIME_KIND,
  commandRuntimeImplementation,
  assertCommandHandler,
  extensionDefinition as commandExtensionDefinition,
  register as registerCommand,
  resourceSupport as commandResourceSupport,
  runtimeSupport as commandRuntimeSupport,
  type CommandCatalog,
  type CommandDescriptor,
  type CommandExecution,
  type CommandHandler,
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
  KIND as TOOL_KIND,
  OVERRIDE_KIND as TOOL_OVERRIDE_KIND,
  assertExecutableToolDefinition,
  assertToolHandler,
  assertToolOverrideHandler,
  extensionDefinition as toolExtensionDefinition,
  overrideExtensionDefinition as toolOverrideExtensionDefinition,
  registerComposition as registerToolComposition,
  validateToolStatus,
  type ExecutableToolDefinition,
  type ToolExecutionContext as StandardToolExecutionContext,
  type ToolExecutionResult as StandardToolExecutionResult,
  type ToolHandler,
  type ToolContentBlock,
  type ToolImageData,
  type ToolJsonValue,
  type ToolOverrideHandler,
  type ToolResource,
  type ToolOverrideResource,
} from '@dsh-std/tool'
import {
  API_VERSION as SESSION_API_VERSION,
  EVENT_KIND as SESSION_EVENT_KIND,
  eventExtensionDefinition as sessionEventExtensionDefinition,
} from '@dsh-std/session'
import {
  API_VERSION as PRESENTATION_API_VERSION,
  presentationClients,
  protocols as presentationProtocols,
  register as registerPresentation,
  type PresentationClients,
  type PresentationDescriptor,
} from '@dsh-std/presentation'
import { register as registerMessages } from '@dsh-std/messages'
import { register as registerStorage } from '@dsh-std/storage'
import {
  register as registerWorkspace,
  workspaceProviderExtensionDefinition,
} from '@dsh-std/workspace'
import {
  API_VERSION as UI_API_VERSION,
  CONTRIBUTION_HOST_KIND as UI_CONTRIBUTION_HOST_KIND,
  bindContributionHosts,
  contributionHostSupport,
  register as registerUi,
  registerManifest as registerUiManifest,
  validateContributionHostAgreement,
  validateContributionHostSupport,
  type BoundContributionHost,
  type UiContributionProvider,
} from '@dsh-std/ui'
import type { FacetModule } from '@dsh-std/sdk'
import {
  writeWorkspaceBytes,
  type WorkspaceFileSystem,
  type WorkspaceTarget,
  type WorkspaceWriteIntent,
} from './binary-fs.js'

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
export const DSH_UI_API_VERSION = UI_API_VERSION
export const DSH_UI_CONTRIBUTION_HOST_KIND = UI_CONTRIBUTION_HOST_KIND
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

export type DshPresentationDescriptor = PresentationDescriptor
export type DshCommandCatalog = CommandCatalog
export type DshCommandExecution = CommandExecution

interface MountedFacet {
  readonly publication: DshFacetPublication
  readonly manifest: ComponentManifest
  readonly facet: NonNullable<ReturnType<typeof findFacet>>
  readonly handle: ActivationHandle
  readonly unregisterEndpoint: () => void
  readonly disposeProductExtensions: () => void
}

interface ActiveEntrypoint {
  readonly publication: DshFacetPublication
  readonly protocols: ActivationContext['protocols']
}

interface DshAgentLike {
  readonly id: string
  readonly ctx: {
    readonly tools: ToolRuntime
    on(
      name: 'tools/execute',
      listener: (exec: ToolRunContext, next: () => Promise<DshToolExecutionResult>) => Promise<DshToolExecutionResult>,
    ): () => void
  }
  readonly options?: { readonly provider?: string; readonly model?: string }
  readonly session: {
    readonly id: unknown
    requestHeader(): { readonly config?: { readonly provider?: string; readonly model?: string } } | undefined
    append(type: string, data: unknown): void
  }
}

interface InstalledToolOverride {
  readonly original: ToolDefinition
  readonly dispose: () => void
}

interface LiveToolOverride {
  readonly resource: ToolOverrideResource
  readonly owner: string
  readonly handler: ToolOverrideHandler
  readonly installed: Map<DshAgentLike, InstalledToolOverride>
  readonly unsubscribe: () => void
}

interface WorkspaceHostEvents {
  waterfall(
    name: 'fs/write-intent',
    target: WorkspaceTarget,
    exec: ToolRunContext,
    next: () => undefined,
  ): Promise<WorkspaceWriteIntent | undefined>
  emit(
    name: 'fs/observed',
    target: WorkspaceTarget,
    state: { readonly kind: 'present'; readonly version: unknown },
    exec: ToolRunContext,
  ): void
}

function standardContent(content: readonly ContentBlock[]): StandardToolExecutionResult['content'] {
  const result: Array<{ type: 'text'; text: string } | { type: 'image'; reference: unknown }> = []
  for (const block of content) {
    if (block.type === 'text') result.push({ type: 'text', text: block.text })
    else if (block.type === 'image') result.push({ type: 'image', reference: block.attachment })
  }
  return result
}

function dshContent(content: StandardToolExecutionResult['content']): ContentBlock[] {
  return content.map(block => block.type === 'text'
    ? { type: 'text', text: block.text }
    : { type: 'image', attachment: block.reference as never })
}

function collectImageReferences(value: unknown, output: unknown[]): void {
  if (!record(value)) return
  if (value.type === 'image' && value.attachment !== undefined) output.push(value.attachment)
  if (Array.isArray(value.content)) for (const block of value.content) collectImageReferences(block, output)
}

async function modelForTool(ctx: Context, exec: ToolRunContext): Promise<StandardToolExecutionContext['model']> {
  const configured = exec.agent?.session.requestHeader()?.config
  const provider = configured?.provider ?? exec.agent?.options.provider
  const model = configured?.model ?? exec.agent?.options.model
  if (provider === undefined || model === undefined) return undefined
  const llm = ctx.get('llm') as { resolveModelInfo(provider: string, model: string, signal: AbortSignal): Promise<{ inputModalities?: readonly ('text' | 'image')[] }> } | undefined
  const info = await llm?.resolveModelInfo(provider, model, exec.signal)
  return { provider, model, ...(info?.inputModalities === undefined ? {} : { inputModalities: info.inputModalities }) }
}

async function standardToolContext(
  ctx: Context,
  exec: ToolRunContext,
  owner: string,
  sessionEvents: DshSessionEventRegistry,
  original?: ToolDefinition,
): Promise<StandardToolExecutionContext> {
  const attachments = ctx.get('attachments') as AttachmentStore | undefined
  const fs = ctx.get('fs') as unknown as WorkspaceFileSystem | undefined
  const hostEvents = ctx as unknown as WorkspaceHostEvents
  const cwd = exec.agent?.session.header.cwd
  return Object.freeze({
    signal: exec.signal,
    ...await modelForTool(ctx, exec).then(model => model === undefined ? {} : { model }),
    ...(exec.agent === undefined ? {} : {
      session: Object.freeze({
        id: String(exec.agent.session.id),
        appendEvent(type: string, data: ToolJsonValue) {
          sessionEvents.append(owner, exec.agent!.session, type, data)
        },
      }),
    }),
    ...(attachments === undefined ? {} : { imageLimits: attachments.imageLimits }),
    async validateImage(image: ToolImageData) {
      if (attachments === undefined) throw new Error('the Runtime does not provide image attachment validation')
      await attachments.validateImage({
        data: image.data, mediaType: image.mediaType as never,
        ...(image.name === undefined ? {} : { name: image.name }),
      })
    },
    async saveImage(image: ToolImageData) {
      if (attachments === undefined) throw new Error('the Runtime does not provide image attachment storage')
      const reference = await attachments.saveImage({
        data: image.data, mediaType: image.mediaType as never,
        ...(image.name === undefined ? {} : { name: image.name }),
      })
      return {
        reference, mediaType: reference.mediaType, bytes: reference.bytes,
        width: reference.width, height: reference.height,
        ...(reference.name === undefined ? {} : { name: reference.name }),
      }
    },
    async recentImages(count: number) {
      if (attachments === undefined) throw new Error('the Runtime does not provide image attachment storage')
      const messages = exec.agent?.session.deriveMessages() ?? []
      const references: unknown[] = []
      for (const message of messages) collectImageReferences(message, references)
      const selected = references.slice(-count)
      if (selected.length !== count) throw new Error(`requested ${count} recent images, but only ${selected.length} are available`)
      return await Promise.all(selected.map(async reference => {
        const stored = await attachments.readImage(reference as never, exec.signal)
        return {
          data: stored.data, mediaType: stored.ref.mediaType,
          ...(stored.ref.name === undefined ? {} : { name: stored.ref.name }),
        }
      }))
    },
    async readWorkspaceFile(path: string, maxBytes: number) {
      if (fs === undefined) throw new Error('the Runtime does not provide workspace file access')
      const target = await fs.resolve(path, { ...(cwd === undefined ? {} : { cwd }), signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (info === undefined) throw new Error(`workspace file does not exist: ${path}`)
      if (info.type !== 'file') throw new Error(`workspace path is not a regular file: ${path}`)
      const data = await fs.readBytes(target, exec.signal, maxBytes)
      hostEvents.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return { path: target.displayPath, data, name: basename(target.displayPath) }
    },
    async writeWorkspaceFile(path: string, data: Uint8Array) {
      if (fs === undefined) throw new Error('the Runtime does not provide workspace file access')
      const target = await fs.resolve(path, { ...(cwd === undefined ? {} : { cwd }), signal: exec.signal })
      const expected = await hostEvents.waterfall('fs/write-intent', target, exec, () => undefined)
      const outcome = await writeWorkspaceBytes(ctx, exec, fs, target, data, expected)
      hostEvents.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return { path: target.displayPath, operation: outcome.operation, bytes: outcome.bytes }
    },
    ...(exec.parent === undefined ? {} : {
      deferContent(content: readonly ToolContentBlock[]) {
        exec.deferContext(createUserMessage({
          content: dshContent(content),
          source: { kind: 'plugin', plugin: owner },
        }))
      },
    }),
    ...(original === undefined ? {} : {
      async delegate(input: Readonly<Record<string, ToolJsonValue>>) {
        const data = await original.execute(input, exec) as ToolJsonValue
        return { data, content: standardContent(original.output.render(input, data as never)) }
      },
    }),
  })
}

function portableDefinition(original: ToolDefinition): ExecutableToolDefinition {
  return {
    name: original.name,
    description: original.description,
    parameters: original.parameters as Readonly<Record<string, unknown>>,
    output: original.output.schema as Readonly<Record<string, unknown>>,
    execute: async (_input, context) => {
      if (context.delegate === undefined) throw new Error('the original Tool definition cannot execute outside an override')
      return context.delegate(_input)
    },
    ...(original.isConcurrencySafe === undefined ? {} : { isConcurrencySafe: input => original.isConcurrencySafe!(input) }),
  }
}

function dshToolDefinition(
  ctx: Context,
  definition: ExecutableToolDefinition,
  owner: string,
  sessionEvents: DshSessionEventRegistry,
  original?: ToolDefinition,
): ToolDefinition {
  assertExecutableToolDefinition(definition)
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters as never,
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['data', 'content'],
        properties: { data: definition.output, content: { type: 'array' }, presentation: {} },
      } as never,
      render: (_input, value) => dshContent((value as unknown as StandardToolExecutionResult).content),
      ...(original?.output.presentationMeta === undefined ? {} : {
        presentationMeta: (_input: unknown, value: unknown) =>
          ((value as StandardToolExecutionResult).presentation ?? null) as never,
      }),
    },
    async execute(input, exec) {
      return await definition.execute(
        input as Readonly<Record<string, ToolJsonValue>>,
        await standardToolContext(ctx, exec, owner, sessionEvents, original),
      )
    },
    ...(original?.presentCall === undefined ? {} : { presentCall: original.presentCall }),
    ...(original?.presentResult === undefined ? {} : { presentResult: original.presentResult }),
    ...(original?.timeoutMs === undefined ? {} : { timeoutMs: original.timeoutMs }),
    ...(definition.isConcurrencySafe === undefined ? {} : { isConcurrencySafe: input => definition.isConcurrencySafe!(input as Readonly<Record<string, ToolJsonValue>>) }),
  }
}

/** Product binding for standard ToolOverride declarations. */
class DshToolOverrideRegistry {
  private readonly overrides = new Map<string, LiveToolOverride>()
  private syncing = false

  constructor(
    private readonly ctx: Context,
    private readonly sessionEvents: DshSessionEventRegistry,
  ) {
    ctx.on('agent/created', ({ agent }) => { this.syncAgent(agent as DshAgentLike) })
    ctx.on('agent/disposed', ({ agent }) => { this.forgetAgent(agent as DshAgentLike) })
    ctx.on('tools/change', () => { this.syncAll() })
  }

  register(resource: ToolOverrideResource, candidate: unknown, owner: string): () => void {
    assertToolOverrideHandler(candidate)
    const handler = candidate as ToolOverrideHandler
    const target = resource.spec.target
    if (this.overrides.has(target)) throw new Error(`tool ${JSON.stringify(target)} already has a live ToolOverride`)
    const live: LiveToolOverride = {
      resource,
      owner,
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
      const providers = override.resource.spec.providers
      const provider = agent.session.requestHeader()?.config?.provider ?? agent.options?.provider
      if (providers !== undefined && (provider === undefined || !providers.includes(provider))) {
        if (current !== undefined) this.remove(override, agent)
        continue
      }
      const original = override.resource.spec.executionOnly === true
        ? tools.get(target, agent as never)
        : tools.get(target)
      if (original === undefined) {
        if (current !== undefined) this.remove(override, agent)
        continue
      }
      if (current?.original === original) continue
      if (current !== undefined) this.remove(override, agent)
      if (override.resource.spec.executionOnly !== true && tools.get(target, agent as never) !== original) continue
      const portable = portableDefinition(original)
      const replacement = override.handler.resolve(portable)
      if (replacement === undefined) continue
      if (replacement.name !== target) {
        throw new TypeError(`ToolOverride for ${JSON.stringify(target)} returned tool ${JSON.stringify(replacement.name)}`)
      }
      let dispose: () => void
      if (override.resource.spec.executionOnly === true) {
        if (replacement.parameters !== portable.parameters || replacement.output !== portable.output) {
          throw new TypeError(`execution-only ToolOverride for ${JSON.stringify(target)} changed its schema`)
        }
        dispose = agent.ctx.on('tools/execute', async (exec, next) => {
          if (exec.name !== target) return await next()
          const result = await replacement.execute(
            exec.arguments as Readonly<Record<string, ToolJsonValue>>,
            await standardToolContext(this.ctx, exec, override.owner, this.sessionEvents, original),
          )
          return {
            isError: false,
            value: result.data as never,
            content: dshContent(result.content),
            ...(result.presentation === undefined ? {} : { meta: result.presentation as never }),
          }
        })
      } else {
        dispose = agent.ctx.tools.register(dshToolDefinition(
          this.ctx, replacement, override.owner, this.sessionEvents, original,
        ))
      }
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
  private readonly owned = new Map<string, number>()
  private readonly writers = new Map<string, Map<string, number>>()
  private readonly vocabulary: Set<string>

  constructor() {
    if (!(KNOWN_SESSION_EVENT_TYPES instanceof Set)) {
      throw new Error('this DSH build does not expose an extensible session event vocabulary')
    }
    this.vocabulary = KNOWN_SESSION_EVENT_TYPES as Set<string>
  }

  register(type: string, owner: string): () => void {
    const count = this.owned.get(type) ?? 0
    this.owned.set(type, count + 1)
    const types = this.writers.get(owner) ?? new Map<string, number>()
    types.set(type, (types.get(type) ?? 0) + 1)
    this.writers.set(owner, types)
    this.vocabulary.add(type)
    let active = true
    return () => {
      if (!active) return
      active = false
      const next = (this.owned.get(type) ?? 1) - 1
      if (next > 0) this.owned.set(type, next)
      else this.owned.delete(type)
      const writerTypes = this.writers.get(owner)
      const writerNext = (writerTypes?.get(type) ?? 1) - 1
      if (writerNext > 0) writerTypes?.set(type, writerNext)
      else {
        writerTypes?.delete(type)
        if (writerTypes?.size === 0) this.writers.delete(owner)
      }
      // Durable history can outlive the facet activation that wrote it. Keep
      // every observed event type recognizable for the rest of this process,
      // including across hot reload and activation rollback.
    }
  }

  append(
    owner: string,
    session: unknown,
    type: string,
    data: ToolJsonValue,
  ): void {
    if (!this.writers.get(owner)?.has(type)) {
      throw new Error(`component ${JSON.stringify(owner)} did not declare session event ${JSON.stringify(type)}`)
    }
    ;(session as { append(type: string, data: never): unknown }).append(type, data as never)
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

export interface DshCommandSurfaceInvocation {
  readonly commandId: string
  readonly rawInput: string
  readonly signal: AbortSignal
}

/** Product-owned human command surface. CommandRuntime execution does not require one. */
export interface DshCommandSurfaceProvider {
  readonly participantId: string
  readonly placement: ApiReference
  register(
    resource: CommandResource,
    execute: (invocation: DshCommandSurfaceInvocation) => CommandExecution['result'] | Promise<CommandExecution['result']>,
  ): () => void
}

interface LiveStandardCommand {
  readonly resource: CommandResource
  readonly handler: CommandHandler
  readonly owner: {
    readonly participantId: string
    readonly requirements: readonly ProtocolRequirement[]
    capability(reference: ProtocolRequirement): CapabilityClient | undefined
  }
  readonly installations: Map<string, () => void>
}

/** Product binding for executable standard Command extensions. */
class DshCommandExtensionRegistry {
  private readonly entries = new Map<string, LiveStandardCommand>()
  private readonly providers = new Map<string, DshCommandSurfaceProvider>()

  register(
    resource: CommandResource,
    candidate: unknown,
    owner: {
      readonly participantId: string
      readonly requirements: readonly ProtocolRequirement[]
      capability(reference: ProtocolRequirement): CapabilityClient | undefined
    },
  ): () => void {
    assertCommandHandler(candidate)
    const handler = candidate as CommandHandler
    const name = resource.metadata.name
    if (this.entries.has(name)) throw new Error(`standard command ${JSON.stringify(name)} already has a live handler`)
    const entry = {
      resource,
      handler,
      owner,
      installations: new Map<string, () => void>(),
    }
    this.entries.set(name, entry)
    try {
      for (const [key, provider] of this.providers) this.install(key, provider, entry)
    } catch (error) {
      this.entries.delete(name)
      for (const dispose of [...entry.installations.values()].reverse()) dispose()
      throw error
    }
    return () => {
      if (this.entries.get(name) !== entry) return
      this.entries.delete(name)
      for (const dispose of [...entry.installations.values()].reverse()) dispose()
    }
  }

  registerProvider(provider: DshCommandSurfaceProvider): () => void {
    nonEmpty(provider.participantId, 'command surface participantId')
    validateApiReference(provider.placement, 'command surface placement')
    if (typeof provider.register !== 'function') throw new TypeError('command surface provider.register must be a function')
    const key = protocolKey(provider.placement)
    if (this.providers.has(key)) throw new Error(`command surface ${provider.placement.apiVersion} ${provider.placement.kind} already has a provider`)
    this.providers.set(key, provider)
    try {
      for (const entry of this.entries.values()) this.install(key, provider, entry)
    } catch (error) {
      this.providers.delete(key)
      for (const entry of this.entries.values()) {
        entry.installations.get(key)?.()
        entry.installations.delete(key)
      }
      throw error
    }
    return () => {
      if (this.providers.get(key) !== provider) return
      this.providers.delete(key)
      for (const entry of this.entries.values()) {
        entry.installations.get(key)?.()
        entry.installations.delete(key)
      }
    }
  }

  descriptor(name: string): { readonly name: string; readonly description: string; readonly input: { readonly hint: string } } | undefined {
    const entry = this.entries.get(name)
    if (entry === undefined) return undefined
    return Object.freeze({
      name,
      description: entry.resource.spec.description ?? entry.resource.spec.title,
      input: Object.freeze({ hint: 'subcommand' }),
    })
  }

  async invoke(name: string, rawInput: string, commandId: string, signal: AbortSignal): Promise<CommandExecution['result']> {
    const entry = this.entries.get(name)
    if (entry === undefined) throw new Error(`standard command ${JSON.stringify(name)} is unavailable`)
    const client = entry.owner.requirements.filter(isPresentationProtocol)
      .map(reference => entry.owner.capability(reference))
      .find(candidate => candidate !== undefined)
    const descriptor = client === undefined
      ? undefined
      : boundPresentationDescriptor(entry.owner.requirements, client)
    let requestSequence = 0
    const presentation: PresentationClients | undefined = descriptor === undefined || client === undefined
      ? undefined
      : presentationClients(descriptor, invocationClient(client, signal), {
        invocationId: commandId,
        origin: entry.owner.participantId,
        nextRequestId: () => `${commandId}:${String(++requestSequence)}`,
      })
    return await entry.handler.execute(
      { rawInput },
      { signal, ...(presentation === undefined ? {} : { presentation }) },
    )
  }

  private install(key: string, provider: DshCommandSurfaceProvider, entry: LiveStandardCommand): void {
    if (entry.resource.spec.placements !== undefined
      && !entry.resource.spec.placements.some(placement => sameProtocol(placement, provider.placement))) return
    const name = entry.resource.metadata.name
    const dispose = provider.register(
      entry.resource,
      invocation => this.invoke(name, invocation.rawInput, invocation.commandId, invocation.signal),
    )
    if (typeof dispose !== 'function') throw new TypeError('command surface provider.register must return a disposer')
    entry.installations.set(key, dispose)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { dshStd: DshStandardAdapter }
}

export class DshStandardAdapter extends TypertRemoteService {
  static inject = ['agents', 'llm']
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
  private readonly activeEntrypoints = new Map<string, ActiveEntrypoint>()
  private readonly toolOverrides: DshToolOverrideRegistry
  private readonly sessionEvents = new DshSessionEventRegistry()
  private readonly commandExtensions: DshCommandExtensionRegistry
  private readonly commandProviderDisposers = new Set<() => void>()
  private readonly uiProviders = new Map<string, UiContributionProvider>()
  private readonly uiBindings = new Map<string, Set<BoundContributionHost>>()
  private readonly uiProviderDisposers = new Set<() => Promise<void>>()

  constructor(ctx: Context, config: AdapterConfig) {
    super(ctx, 'dshStd', { namespace: DSH_STD_NAMESPACE })
    this.selfCtx = ctx
    this.toolOverrides = new DshToolOverrideRegistry(ctx, this.sessionEvents)
    registerToolComposition(this.compositionRules)
    const instanceId = randomUUID()
    // A Loader entry's scoped context is anchored at the package that owns the
    // entry. The active profile is therefore passed while the bundle patch is
    // still evaluated in the root Loader context; guessing it from this
    // plugin's ctx.baseUrl discovers the adapter package instead.
    const profileBaseUrl = config.profileBaseUrl?.trim() || ctx.baseUrl
    const profile = config.profile?.trim() || profileFromBaseUrl(profileBaseUrl)
    this.commandExtensions = new DshCommandExtensionRegistry()
    const declaration = defineProtocolDeclaration({
      participant: { id: ADAPTER_PARTICIPANT },
      supports: [commandResourceSupport, commandRuntimeSupport, modelCatalogSupport],
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
    this.lifecycle = new LifecycleCoordinator(this.protocols, this.drivers, this.publications, {
      open: ({ identity, declaration: consumerDeclaration, agreements }) => {
        const consumerEndpoint = new StandardEndpointRuntime({
          id: `${this.runtime.id}.activation`,
          instanceId: `${this.runtime.instanceId}:activation:${identity.instanceId}`,
        })
        consumerEndpoint.register({ declaration: consumerDeclaration })
        const pair = createMemoryConnectionPair(consumerEndpoint, this.connectionEndpoint, {
          connectionId: randomUUID(),
          revision: 1,
          protocols: this.protocols,
        })
        if (!pair.plan.compatible) {
          pair.close('activation capability negotiation failed')
          throw new Error(pair.plan.issues
            .filter(issue => issue.severity === 'error')
            .map(issue => issue.message)
            .join('; '))
        }
        const capability = pair.left.client(identity.participantId)
        const uiProviders = this.uiProviders
        const uiBindings = this.uiBindings
        let ui: BoundContributionHost | undefined
        return Object.freeze({
          client<T = unknown>(reference: ApiReference): T | undefined {
            if (sameProtocol(reference, { apiVersion: UI_API_VERSION, kind: UI_CONTRIBUTION_HOST_KIND })) {
              if (ui !== undefined) return ui.client as unknown as T
              const negotiated = agreements.find(row => sameProtocol(row, reference))
              if (negotiated?.agreement === undefined) return undefined
              const agreement = validateContributionHostAgreement(negotiated.agreement)
              const selected = agreement.surfaces.filter(row => row.consumer === identity.participantId)
              if (selected.length === 0) return undefined
              const providers = [...new Set(selected.map(row => row.provider))].map(participantId => {
                const provider = uiProviders.get(participantId)
                if (provider === undefined) throw new Error(`negotiated UI provider ${JSON.stringify(participantId)} is unavailable`)
                return provider
              })
              ui = bindContributionHosts(agreement, identity, providers)
              for (const provider of providers) {
                const bindings = uiBindings.get(provider.participantId) ?? new Set<BoundContributionHost>()
                bindings.add(ui)
                uiBindings.set(provider.participantId, bindings)
              }
              return ui.client as unknown as T
            }
            return capability.binding(reference) === undefined ? undefined : capability as unknown as T
          },
          close: async (reason?: string) => {
            let failure: unknown
            try { await ui?.close(reason) } catch (error) { failure = error }
            if (ui !== undefined) {
              for (const bindings of uiBindings.values()) bindings.delete(ui)
            }
            pair.close(reason)
            if (failure !== undefined) throw failure
          },
        })
      },
    })
    this.drivers.register({
      id: DSH_ACTIVATION_DRIVER_ID,
      apiVersion: DSH_ACTIVATION_API_VERSION,
      kind: DSH_ACTIVATION_KIND,
      activate: async ({ selected, context }) => {
        const publication = this.pending.get(facetKey(selected.identity))
        if (publication === undefined) throw new Error(`no entrypoint was supplied for ${facetKey(selected.identity)}`)
        this.activeEntrypoints.set(context.identity.instanceId, Object.freeze({ publication, protocols: context.protocols }))
        try {
          await publication.activate(context)
        } catch (error) {
          this.activeEntrypoints.delete(context.identity.instanceId)
          throw error
        }
      },
      deactivate: async (identity, reason) => {
        const active = this.activeEntrypoints.get(identity.instanceId)
        this.activeEntrypoints.delete(identity.instanceId)
        await active?.publication.deactivate?.(reason)
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
      for (const dispose of [...this.commandProviderDisposers].reverse()) dispose()
      for (const dispose of [...this.uiProviderDisposers].reverse()) await dispose()
    }, '@dsh-std/adapter-dsh lifecycle')
    for (const initialize of REMOTE_INITIALIZERS) initialize.call(this)
  }

  /** Publish one product-owned human command surface. */
  registerCommandSurfaceProvider(provider: DshCommandSurfaceProvider): () => void {
    const unregister = this.commandExtensions.registerProvider(provider)
    let active = true
    const dispose = (): void => {
      if (!active) return
      active = false
      this.commandProviderDisposers.delete(dispose)
      unregister()
    }
    this.commandProviderDisposers.add(dispose)
    return dispose
  }

  /** Publish a product-owned, same-process UI surface host to later facet activations. */
  registerUiContributionProvider(provider: UiContributionProvider): () => Promise<void> {
    nonEmpty(provider.participantId, 'UI contribution provider participantId')
    if (this.uiProviders.has(provider.participantId)) {
      throw new Error(`UI contribution provider ${JSON.stringify(provider.participantId)} is already registered`)
    }
    const support = contributionHostSupport(validateContributionHostSupport(provider.support))
    const declaration = defineProtocolDeclaration({
      participant: { id: provider.participantId },
      supports: [support],
    })
    const instanceId = `${this.runtime.instanceId}:ui:${randomUUID()}`
    const unregisterEndpoint = this.connectionEndpoint.register({ declaration })
    let unpublish: () => void
    try {
      unpublish = this.publications.publish({
        identity: Object.freeze({
          component: ADAPTER_COMPONENT,
          version: '0.1.0',
          facet: 'ui-surface-host',
          instanceId,
          participantId: provider.participantId,
        }),
        declaration,
        protocols: Object.freeze([]),
        extensions: Object.freeze([]),
      })
    } catch (error) {
      unregisterEndpoint()
      throw error
    }
    this.uiProviders.set(provider.participantId, provider)
    let active = true
    const dispose = async (): Promise<void> => {
      if (!active) return
      active = false
      this.uiProviderDisposers.delete(dispose)
      if (this.uiProviders.get(provider.participantId) === provider) this.uiProviders.delete(provider.participantId)
      unpublish()
      unregisterEndpoint()
      const bindings = [...(this.uiBindings.get(provider.participantId) ?? [])]
      this.uiBindings.delete(provider.participantId)
      const errors: unknown[] = []
      for (const binding of bindings.reverse()) {
        try { await binding.close('UI contribution provider unregistered') } catch (error) { errors.push(error) }
      }
      if (errors.length > 0) throw new AggregateError(errors, 'one or more UI bindings failed to close')
    }
    this.uiProviderDisposers.add(dispose)
    return dispose
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
          const resolved = resolveFacetModule(packageDir, spec.module)
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
        const disposeClient = await mountDshBrowserClient(this.selfCtx, packageName, packageDir)
        if (disposeClient !== undefined) disposers.push(disposeClient)
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

  catalog(
    sessionId: string,
    presentation: DshPresentationDescriptor | undefined,
    placement?: ApiReference,
  ): DshCommandCatalog {
    validatePresentation(presentation)
    this.agent(sessionId)
    const descriptors: CommandDescriptor[] = []
    for (const mounted of this.facets.values()) {
      const publication = this.publications.get(mounted.handle.identity.instanceId)
      if (publication === undefined) continue
      for (const row of publication.extensions) {
        if (!sameProtocol(row.extension, { apiVersion: COMMAND_API_VERSION, kind: COMMAND_KIND })) continue
        const resource = row.extension as CommandResource
        if (placement !== undefined && resource.spec.placements !== undefined
          && !resource.spec.placements.some(candidate => sameProtocol(candidate, placement))) continue
        const command = this.commandExtensions.descriptor(resource.metadata.name)
        if (command === undefined) continue
        const unavailablePresentation = missingPresentation(mounted.facet.protocols?.requires ?? [], presentation)
        descriptors.push(Object.freeze({
          name: command.name,
          description: command.description,
          ...(command.input === undefined ? {} : { input: Object.freeze({ hint: command.input.hint }) }),
          owner: ownerOf(mounted), resource,
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
    const agent = this.agent(sessionId)
    const commandId = randomUUID()
    const rawInput = line.slice(root.length + 1)
    const session = (agent as DshAgentLike).session
    session.append('command/run', { commandId, name: root, args: rawInput, source: { kind: 'user' } })
    let result: CommandExecution['result']
    try {
      result = await this.commandExtensions.invoke(root, rawInput, commandId, signal)
    } catch (error) {
      session.append('command/done', { commandId, kind: 'error', text: errorMessage(error) })
      throw error
    }
    session.append('command/done', { commandId, ...result })
    return Object.freeze({
      apiVersion: COMMAND_API_VERSION,
      commandId,
      result,
    })
  }

  /** Browser-safe command entry: no product-specific route and no implicit Presentation claim. */
  async command(sessionId: string, line: string): Promise<DshCommandExecution | undefined> {
    return await this.execute(sessionId, line, undefined, new AbortController().signal)
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
            const active = this.activeEntrypoints.get(publication.identity.instanceId)
            if (active === undefined) throw new Error('command owner activation context is unavailable')
            disposers.push(this.commandExtensions.register(extension as CommandResource, published.handler, {
              participantId: publication.identity.participantId,
              requirements: facet.protocols?.requires ?? [],
              capability: reference => active.protocols.client<CapabilityClient>(reference),
            }))
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
        if (sameProtocol(extension, { apiVersion: TOOL_API_VERSION, kind: TOOL_KIND })) {
          const published = publication.extensions.find(row => row.extension === extension
            || (sameProtocol(row.extension, extension) && row.extension.metadata.name === extension.metadata.name))
          if (published === undefined) throw new Error(`Tool ${JSON.stringify(extension.metadata.name)} did not publish a runtime handler`)
          assertToolHandler(published.handler)
          const handler = published.handler as ToolHandler
          const tools = this.selfCtx.get('tools') as ToolRuntime | undefined
          if (tools === undefined) throw new Error('Tool resource requires the DSH tools service')
          let unregister = (): void => undefined
          const sync = (): void => {
            const definition = handler.resolve()
            if (definition !== undefined) {
              assertExecutableToolDefinition(definition)
              if (definition.name !== extension.metadata.name) {
                throw new TypeError(`Tool handler for ${JSON.stringify(extension.metadata.name)} returned ${JSON.stringify(definition.name)}`)
              }
            }
            unregister()
            unregister = definition === undefined
              ? () => undefined
              : tools.register(dshToolDefinition(
                  this.selfCtx, definition, publication.identity.component, this.sessionEvents,
                ))
          }
          sync()
          const unsubscribe = handler.subscribe?.(sync) ?? (() => undefined)
          disposers.push(() => { unsubscribe(); unregister() })
        }
        if (sameProtocol(extension, { apiVersion: TOOL_API_VERSION, kind: TOOL_OVERRIDE_KIND })) {
          const published = publication.extensions.find(row => row.extension === extension
            || (sameProtocol(row.extension, extension) && row.extension.metadata.name === extension.metadata.name))
          if (published === undefined) {
            throw new Error(`ToolOverride ${JSON.stringify(extension.metadata.name)} did not publish a runtime handler`)
          }
          disposers.push(this.toolOverrides.register(
            extension as ToolOverrideResource, published.handler, publication.identity.component,
          ))
        }
        if (sameProtocol(extension, { apiVersion: SESSION_API_VERSION, kind: SESSION_EVENT_KIND })) {
          disposers.push(this.sessionEvents.register(extension.metadata.name, publication.identity.component))
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
        catalog: input => this.catalog(input.contextId, input.presentation, input.placement),
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

}

export function createDshProtocolCatalog(): ProtocolCatalog {
  const catalog = new ProtocolCatalog({ name: '@dsh-std/adapter-dsh', version: '0.1.0' })
  registerCommand(catalog)
  registerMessages(catalog)
  registerModel(catalog)
  registerPresentation(catalog)
  registerStorage(catalog)
  registerWorkspace(catalog)
  registerUi(catalog)
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
  catalog.registerExtension(workspaceProviderExtensionDefinition)
  registerUiManifest(catalog)
  return catalog
}

const REMOTE_INITIALIZERS: Array<(this: DshStandardAdapter) => void> = []
for (const method of ['describe', 'snapshot', 'catalog', 'execute', 'command'] as const) {
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

function isPresentationProtocol(reference: ApiReference): reference is ProtocolRequirement {
  return presentationProtocols.some(definition => sameProtocol(definition, reference))
}

function boundPresentationDescriptor(
  requirements: readonly ProtocolRequirement[],
  client: CapabilityClient,
): PresentationDescriptor | undefined {
  const bindings = requirements.filter(isPresentationProtocol)
    .map(requirement => ({ requirement, binding: client.binding(requirement) }))
    .filter(row => row.binding !== undefined)
  const clientId = bindings[0]?.binding?.provider.endpoint.instanceId
  if (clientId === undefined) return undefined
  if (bindings.some(row => row.binding?.provider.endpoint.instanceId !== clientId)) {
    throw new Error('one command invocation cannot span multiple Presentation endpoints')
  }
  return Object.freeze({
    clientId,
    contracts: Object.freeze(bindings.map(({ requirement }) => Object.freeze({
      apiVersion: requirement.apiVersion,
      kind: requirement.kind,
      ...(requirement.spec === undefined ? {} : { spec: requirement.spec }),
    }))),
  })
}

function invocationClient(client: CapabilityClient, invocationSignal: AbortSignal): CapabilityClient {
  return Object.freeze({
    participantId: client.participantId,
    binding(reference: ApiReference) {
      return invocationSignal.aborted ? undefined : client.binding(reference)
    },
    invoke<TInput = unknown, TOutput = unknown, TProgress = unknown>(
      reference: ApiReference,
      operation: string,
      input: TInput,
      options?: { readonly signal?: AbortSignal },
    ) {
      invocationSignal.throwIfAborted()
      const signal = options?.signal === undefined
        ? invocationSignal
        : AbortSignal.any([invocationSignal, options.signal])
      return client.invoke<TInput, TOutput, TProgress>(reference, operation, input, { signal })
    },
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

interface ProductLoaderEntry {
  readonly options: { readonly name?: string }
}

interface ProductLoader {
  entries(): readonly ProductLoaderEntry[]
  create(options: { readonly name: string }): Promise<string>
  remove(id: string): Promise<void>
}

/**
 * Seat a standard component's ordinary DSH browser half only when this Host is
 * the Web profile. `clientModules` is the positive product capability check;
 * TUI and headless profiles return before inspecting client metadata or loader.
 */
async function mountDshBrowserClient(
  ctx: Context,
  packageName: string,
  packageDir: string,
): Promise<(() => Promise<void>) | undefined> {
  const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>
  const dsh = record(packageJson.dsh) ? packageJson.dsh : undefined
  const client = dsh !== undefined && record(dsh.client) ? dsh.client : undefined
  if (client === undefined || client.platform !== 'web') return undefined

  const mount = async (activeCtx: Context): Promise<(() => Promise<void>) | undefined> => {
    const get = activeCtx.get.bind(activeCtx) as (name: string) => unknown
    const loader = get('loader') as Partial<ProductLoader> | undefined
    if (loader === undefined || typeof loader.entries !== 'function'
      || typeof loader.create !== 'function' || typeof loader.remove !== 'function') {
      throw new Error('DSH Web client module host is active without a compatible Cordis loader')
    }
    if (loader.entries().some(entry => entry.options.name === packageName)) return undefined
    const id = await loader.create({ name: packageName })
    let active = true
    return async () => {
      if (!active) return
      active = false
      await loader.remove!(id)
    }
  }

  const get = ctx.get.bind(ctx) as (name: string) => unknown
  if (get('clientModules') !== undefined) return await mount(ctx)

  // The adapter can activate before the Web client-module registry. Keep the
  // browser half pending on that positive product capability instead of
  // permanently deciding that the current profile is headless.
  const fiber = ctx.inject(['clientModules'], childCtx => {
    childCtx.effect(async () => await mount(childCtx) ?? (() => undefined), `standard Web client ${packageName}`)
  })
  return async () => {
    await fiber.dispose()
  }
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
  if (manifest.facets.host.apiVersion !== 'v1alpha1') {
    throw new Error(`plugin ${JSON.stringify(manifest.id)} requires Host facet API ${manifest.facets.host.apiVersion}; adapter provides v1alpha1`)
  }
}

function resolveFacetModule(packageDir: string, module: string): string {
  const resolved = resolvePath(packageDir, module)
  const inside = relative(packageDir, resolved)
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new TypeError(`FacetModule ${JSON.stringify(module)} must resolve to a file inside the plugin package`)
  }
  return resolved
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function protocolKey(reference: ApiReference): string {
  return `${reference.apiVersion}\0${reference.kind}`
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
