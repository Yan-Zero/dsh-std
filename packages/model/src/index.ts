import type { CommandReference } from '@dsh-std/command'
import type {
  CapabilityCall,
  CapabilityClient,
  CapabilityHandlerContext,
  CapabilityImplementation,
} from '@dsh-std/connection'
import type { ProtocolCatalog, ProtocolSupport } from '@dsh-std/core'
import type { ManifestDefinitionCatalog, ManifestExtension } from '@dsh-std/manifest'
import { defineCapabilityProtocol } from '@dsh-std/connection'

export const API_VERSION = 'models.dsh/v1alpha1'
export const PROVIDER_KIND = 'ModelProvider'
export const CATALOG_KIND = 'ModelCatalog'

export interface ModelProviderSpec {
  readonly title: string
  readonly titles?: Readonly<Record<string, string>>
  readonly actions?: Readonly<Partial<Record<'authenticate' | 'signout' | 'configure', CommandReference>>>
}

export interface ModelDescriptor {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly inputModalities?: readonly ('text' | 'image')[]
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly reasoning?: boolean
  readonly selectable: boolean
  readonly reason?: string
}

export interface ModelProviderStatus {
  readonly state: 'ready' | 'authentication-required' | 'unavailable'
  readonly message?: string
  readonly models: readonly ModelDescriptor[]
}

export interface ModelProviderResource extends ManifestExtension<ModelProviderSpec> {
  readonly status?: ModelProviderStatus
}

export interface ModelTextBlock { readonly type: 'text'; readonly text: string }
export interface ModelReasoningBlock { readonly type: 'reasoning'; readonly text: string }
export interface ModelImageBlock { readonly type: 'image'; readonly reference: unknown }
export interface ModelToolCallBlock {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  readonly arguments: string
}
export interface ModelToolResultBlock {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly name?: string
  readonly content: readonly ModelContentBlock[]
  readonly isError?: boolean
}
export type ModelContentBlock = ModelTextBlock | ModelReasoningBlock | ModelImageBlock | ModelToolCallBlock | ModelToolResultBlock

/** Provider-neutral model message transported from a host loop to a provider handler. */
export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: readonly ModelContentBlock[]
  readonly source?: Readonly<Record<string, unknown>>
}

export interface ModelToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
}

export interface ModelGenerateRequest {
  readonly provider: string
  readonly model: string
  readonly messages: readonly ModelMessage[]
  readonly system?: string
  readonly tools?: readonly ModelToolSchema[]
  readonly reasoningEffort?: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
  readonly sessionId?: string
  readonly purpose?: 'compaction' | 'session-title'
}

export type ModelStreamChunk =
  | { readonly type: 'block-start'; readonly index: number; readonly blockType: ModelContentBlock['type'] }
  | { readonly type: 'text-delta' | 'reasoning-delta'; readonly index: number; readonly text: string }
  | { readonly type: 'tool-call-delta'; readonly index: number; readonly id: string; readonly name?: string; readonly argumentsDelta: string }
  | { readonly type: 'block-end'; readonly index: number; readonly block: ModelContentBlock }
  | { readonly type: 'usage'; readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number; readonly reasoningTokens?: number } }
  | { readonly type: 'finish'; readonly reason: ModelFinishReason; readonly replayState?: unknown }

export interface ModelFailure {
  readonly code: string
  readonly message: string
  readonly status?: number
  readonly providerRetryAfterMs?: number
  readonly requestId?: string
}

export type ModelFinishReason =
  | { readonly kind: 'stop' | 'tool-calls' | 'max-tokens' }
  | { readonly kind: 'aborted' | 'error'; readonly failure: ModelFailure }

/** Host-owned request facilities that remain valid only for one stream call. */
export interface ModelExecutionContext {
  readonly signal: AbortSignal
  readImage(reference: unknown): Promise<{ readonly data: Uint8Array; readonly mediaType: string }>
}

/** Executable implementation published with one ModelProvider resource. */
export interface ModelProviderHandler {
  listModels(): readonly ModelDescriptor[] | Promise<readonly ModelDescriptor[]>
  stream(request: ModelGenerateRequest, context: ModelExecutionContext): AsyncIterable<ModelStreamChunk>
}

export function assertModelProviderHandler(value: unknown): asserts value is ModelProviderHandler {
  if (!record(value) || typeof value.listModels !== 'function' || typeof value.stream !== 'function') {
    throw new TypeError('ModelProvider handler must provide listModels() and stream(request, context)')
  }
}

export interface ModelProviderCatalogEntry {
  readonly owner: { readonly component: string; readonly facet: string; readonly participantId?: string }
  readonly state: 'active' | 'degraded'
  readonly message?: string
  readonly resource: ModelProviderResource
}

export interface ModelCatalog {
  readonly apiVersion: typeof API_VERSION
  readonly providers: readonly ModelProviderCatalogEntry[]
}

export interface ModelCatalogGetInput {
  readonly name: string
}

export type ModelCatalogCall =
  | { readonly operation: 'list'; readonly input: Record<string, never>; readonly output: ModelCatalog }
  | { readonly operation: 'get'; readonly input: ModelCatalogGetInput; readonly output: ModelProviderCatalogEntry | undefined }

export interface ModelCatalogClient {
  list(options?: { readonly signal?: AbortSignal }): CapabilityCall<ModelCatalog>
  get(input: ModelCatalogGetInput, options?: { readonly signal?: AbortSignal }): CapabilityCall<ModelProviderCatalogEntry | undefined>
}

export interface ModelCatalogHandler {
  list(context: CapabilityHandlerContext): ModelCatalog | Promise<ModelCatalog>
  get(
    input: ModelCatalogGetInput,
    context: CapabilityHandlerContext,
  ): ModelProviderCatalogEntry | undefined | Promise<ModelProviderCatalogEntry | undefined>
}

export const providerExtensionDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: PROVIDER_KIND,
  validateMetadata(metadata: { readonly name: string }): void {
    if (!/^[a-z][a-z0-9-]*$/u.test(metadata.name)) throw new TypeError('ModelProvider metadata.name is invalid')
  },
  validateSpec(value: unknown): void {
    validateSpec(value)
  },
})

/** Callable catalog implemented once by a Runtime adapter for all ModelProvider resources. */
export const catalogProtocol = defineCapabilityProtocol({
  apiVersion: API_VERSION,
  kind: CATALOG_KIND,
})

export const catalogSupport: ProtocolSupport = Object.freeze({
  apiVersion: API_VERSION,
  kind: CATALOG_KIND,
})

/** Bind typed ModelCatalog operations to a consumer-scoped connection client. */
export function modelCatalog(client: CapabilityClient): ModelCatalogClient {
  return Object.freeze({
    list(options?: { readonly signal?: AbortSignal }) {
      return client.invoke<Record<string, never>, ModelCatalog>(catalogSupport, 'list', {}, options)
    },
    get(input: ModelCatalogGetInput, options?: { readonly signal?: AbortSignal }) {
      return client.invoke<ModelCatalogGetInput, ModelProviderCatalogEntry | undefined>(
        catalogSupport, 'get', validateGetInput(input), options,
      )
    },
  })
}

/** Create the sole Runtime-side catalog implementation for every ModelProvider resource. */
export function modelCatalogImplementation(
  participantId: string,
  handler: ModelCatalogHandler,
): CapabilityImplementation {
  return Object.freeze({
    participantId,
    protocol: catalogSupport,
    handle(operation: string, input: unknown, context: CapabilityHandlerContext) {
      if (operation === 'list') {
        if (!record(input) || Object.keys(input).length > 0) throw new TypeError('ModelCatalog.list input must be an empty object')
        return handler.list(context)
      }
      if (operation === 'get') return handler.get(validateGetInput(input), context)
      throw new TypeError(`unsupported ModelCatalog operation ${JSON.stringify(operation)}`)
    },
  })
}

export function register(protocols: ProtocolCatalog, manifest?: ManifestDefinitionCatalog): () => void {
  const disposeProvider = manifest?.registerExtension(providerExtensionDefinition) ?? (() => undefined)
  const disposeCatalog = protocols.register(catalogProtocol)
  return () => {
    disposeCatalog()
    disposeProvider()
  }
}

export function validateProviderStatus(value: unknown): void { validateStatus(value) }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateSpec(value: unknown): void {
  if (!record(value)) throw new TypeError('ModelProvider spec must be an object')
  exact(value, ['title', 'titles', 'actions'], 'ModelProvider spec')
  text(value.title, 'ModelProvider spec.title')
  if (value.titles !== undefined) localized(value.titles, 'ModelProvider spec.titles')
  if (value.actions !== undefined) {
    if (!record(value.actions)) throw new TypeError('ModelProvider spec.actions must be an object')
    exact(value.actions, ['authenticate', 'signout', 'configure'], 'ModelProvider spec.actions', false)
    for (const [name, reference] of Object.entries(value.actions)) commandReference(reference, `ModelProvider spec.actions.${name}`)
  }
}

function validateGetInput(value: unknown): ModelCatalogGetInput {
  if (!record(value)) throw new TypeError('ModelCatalog.get input must be an object')
  exact(value, ['name'], 'ModelCatalog.get input', false)
  text(value.name, 'ModelCatalog.get input.name')
  return Object.freeze({ name: value.name as string })
}

function validateStatus(value: unknown): void {
  if (!record(value)) throw new TypeError('ModelProvider status must be an object')
  exact(value, ['state', 'message', 'models'], 'ModelProvider status')
  if (!['ready', 'authentication-required', 'unavailable'].includes(value.state as string)) {
    throw new TypeError('ModelProvider status.state is invalid')
  }
  if (value.message !== undefined) text(value.message, 'ModelProvider status.message')
  if (!Array.isArray(value.models)) throw new TypeError('ModelProvider status.models must be an array')
  const ids = new Set<string>()
  for (const [index, model] of value.models.entries()) {
    const label = `ModelProvider status.models[${index}]`
    if (!record(model)) throw new TypeError(`${label} must be an object`)
    exact(model, ['id', 'name', 'description', 'inputModalities', 'contextWindow', 'maxTokens', 'reasoning', 'selectable', 'reason'], label)
    text(model.id, `${label}.id`)
    if (ids.has(model.id as string)) throw new TypeError('ModelProvider status.models contains a duplicate id')
    ids.add(model.id as string)
    text(model.name, `${label}.name`)
    if (model.description !== undefined) text(model.description, `${label}.description`)
    if (model.inputModalities !== undefined) {
      if (!Array.isArray(model.inputModalities) || model.inputModalities.some(value => value !== 'text' && value !== 'image')) {
        throw new TypeError(`${label}.inputModalities must contain only text or image`)
      }
    }
    for (const key of ['contextWindow', 'maxTokens'] as const) {
      if (model[key] !== undefined && (!Number.isInteger(model[key]) || (model[key] as number) <= 0)) {
        throw new TypeError(`${label}.${key} must be a positive integer`)
      }
    }
    if (model.reasoning !== undefined && typeof model.reasoning !== 'boolean') throw new TypeError(`${label}.reasoning must be boolean`)
    if (typeof model.selectable !== 'boolean') throw new TypeError(`${label}.selectable must be boolean`)
    if (model.reason !== undefined) text(model.reason, `${label}.reason`)
  }
}

function commandReference(value: unknown, label: string): void {
  if (!record(value)) throw new TypeError(`${label} must be a CommandReference object`)
  exact(value, ['name', 'path'], label, false)
  token(value.name, `${label}.name`)
  if (value.path === undefined) return
  if (!Array.isArray(value.path)) throw new TypeError(`${label}.path must be an array`)
  for (const [index, segment] of value.path.entries()) token(segment, `${label}.path[${index}]`)
}

function localized(value: unknown, label: string): void {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  for (const [locale, translation] of Object.entries(value)) {
    text(locale, `${label} locale`)
    text(translation, `${label}.${locale}`)
  }
}

function token(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^[^\s/]+$/u.test(value)) throw new TypeError(`${label} must be one token`)
}

function text(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string, extensions = true): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key) && !(extensions && key.startsWith('x-')))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
}
