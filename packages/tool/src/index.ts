import type { ManifestDefinitionCatalog, ManifestExtension } from '@dsh-std/manifest'
import type { CompositionRuleCatalog, ProtocolCompositionRule } from '@dsh-std/composition'

export const API_VERSION = 'tools.dsh/v1alpha1'
export const KIND = 'Tool'
export const OVERRIDE_KIND = 'ToolOverride'

export interface ToolSpec {
  readonly title: string
  readonly titles?: Readonly<Record<string, string>>
  readonly description: string
}

export interface ToolStatus {
  readonly state: 'available' | 'unavailable'
  /** Runtime-resolved model description when it differs from the static catalog copy. */
  readonly description?: string
  /** Runtime-resolved, inert JSON Schema. Omit when the tool is intentionally deferred. */
  readonly parameters?: Readonly<Record<string, unknown>>
  readonly reason?: string
}

export interface ToolResource extends ManifestExtension<ToolSpec> {
  readonly status?: ToolStatus
}

/** Static declaration that one facet owns the effective definition of an existing tool. */
export interface ToolOverrideSpec {
  /** Stable name of the tool being replaced in each tool view. */
  readonly target: string
  /** Model providers whose agent-scoped tool views receive the replacement. */
  readonly providers?: readonly string[]
  /** Keep the inherited schema/presentation and replace only its execution body. */
  readonly executionOnly?: boolean
  /** Human-readable reason for the override. */
  readonly description: string
}

export type ToolOverrideResource = ManifestExtension<ToolOverrideSpec>

export type ToolJsonValue = null | boolean | number | string | readonly ToolJsonValue[] | { readonly [key: string]: ToolJsonValue }

export type ToolContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly reference: unknown }

export interface ToolImageData {
  readonly data: Uint8Array
  readonly mediaType: string
  readonly name?: string
}

export interface StoredToolImage {
  readonly reference: unknown
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** Deployment-resolved image admission policy supplied by the host runtime. */
export interface ToolImageLimits {
  readonly maxImageBytes: number
  readonly maxImagesPerMessage: number
  readonly maxMessageImageBytes: number
  readonly maxImagePixels: number
  readonly mediaTypes: readonly string[]
}

export interface WorkspaceFileData {
  readonly path: string
  readonly data: Uint8Array
  readonly name?: string
}
export interface WorkspaceWriteResult { readonly path: string; readonly operation: 'create' | 'update'; readonly bytes: number }

/** Host-owned facilities scoped to one accepted local tool execution. */
export interface ToolExecutionContext {
  readonly signal: AbortSignal
  readonly model?: { readonly provider: string; readonly model: string; readonly inputModalities?: readonly ('text' | 'image')[] }
  /** Session-bound writer restricted by the Host to this component's declared event types. */
  readonly session?: {
    readonly id: string
    appendEvent(type: string, data: ToolJsonValue): void
  }
  /** Host image policy. Omitted when the runtime has no image attachment service. */
  readonly imageLimits?: ToolImageLimits
  /** Decode and validate an image without storing it. */
  validateImage(image: ToolImageData): Promise<void>
  saveImage(image: ToolImageData): Promise<StoredToolImage>
  recentImages(count: number): Promise<readonly ToolImageData[]>
  readWorkspaceFile(path: string, maxBytes: number): Promise<WorkspaceFileData>
  writeWorkspaceFile(path: string, data: Uint8Array): Promise<WorkspaceWriteResult>
  /** Available for nested executions; defers model-facing content to the parent result. */
  deferContent?(content: readonly ToolContentBlock[]): void
  /** Available only to ToolOverride handlers; invokes the replaced definition. */
  delegate?(input: Readonly<Record<string, ToolJsonValue>>): Promise<ToolExecutionResult>
}

/** Canonical JSON data plus the model-facing content rendered from it. */
export interface ToolExecutionResult {
  readonly data: ToolJsonValue
  readonly content: readonly ToolContentBlock[]
  /** Replayable product presentation metadata, when the replaced tool understands it. */
  readonly presentation?: ToolJsonValue
}

/** Portable, executable definition published with a Tool or ToolOverride resource. */
export interface ExecutableToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly output: Readonly<Record<string, unknown>>
  execute(input: Readonly<Record<string, ToolJsonValue>>, context: ToolExecutionContext): Promise<ToolExecutionResult>
  isConcurrencySafe?(input: Readonly<Record<string, ToolJsonValue>>): boolean
}

export interface ToolHandler {
  resolve(): ExecutableToolDefinition | undefined
  subscribe?(invalidate: () => void): () => void
}

/**
 * Runtime implementation of a ToolOverride. `undefined` leaves the original
 * definition visible, which permits a live policy to disable an override.
 */
export interface ToolOverrideHandler {
  resolve(original: ExecutableToolDefinition): ExecutableToolDefinition | undefined
  /** Notify the adapter when a dynamic policy may change resolve(). */
  subscribe?(invalidate: () => void): () => void
}

export const extensionDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
  schema: Object.freeze({
    type: 'object',
    required: ['title', 'description'],
    properties: {
      title: { type: 'string', minLength: 1 },
      titles: { type: 'object' },
      description: { type: 'string', minLength: 1 },
    },
  }),
  validateMetadata(metadata: { readonly name: string }): void {
    toolName(metadata.name, 'Tool metadata.name')
  },
  validateSpec(value: unknown): void {
    validateSpec(value)
  },
})

export const overrideExtensionDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: OVERRIDE_KIND,
  schema: Object.freeze({
    type: 'object',
    required: ['target', 'description'],
    properties: {
      target: { type: 'string', minLength: 1 },
      providers: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, uniqueItems: true },
      executionOnly: { type: 'boolean' },
      description: { type: 'string', minLength: 1 },
    },
  }),
  validateMetadata(metadata: { readonly name: string }): void {
    toolName(metadata.name, 'ToolOverride metadata.name')
  },
  validateSpec(value: unknown): void {
    if (!record(value)) throw new TypeError('ToolOverride spec must be an object')
    exact(value, ['target', 'providers', 'executionOnly', 'description'], 'ToolOverride spec')
    text(value.target, 'ToolOverride spec.target')
    text(value.description, 'ToolOverride spec.description')
    if (value.providers !== undefined) {
      if (!Array.isArray(value.providers) || value.providers.length === 0) {
        throw new TypeError('ToolOverride spec.providers must be a non-empty array')
      }
      for (const provider of value.providers) text(provider, 'ToolOverride spec.providers item')
      if (new Set(value.providers).size !== value.providers.length) {
        throw new TypeError('ToolOverride spec.providers must not contain duplicates')
      }
    }
    if (value.executionOnly !== undefined && typeof value.executionOnly !== 'boolean') {
      throw new TypeError('ToolOverride spec.executionOnly must be boolean')
    }
  },
})

/** A tool view has one effective owner for a target; competing overrides are invalid. */
export const overrideCompositionRule: ProtocolCompositionRule = Object.freeze({
  apiVersion: API_VERSION,
  kind: OVERRIDE_KIND,
  preflight: () => Object.freeze([]),
  composeExtensions(input: Parameters<NonNullable<ProtocolCompositionRule['composeExtensions']>>[0]) {
    const byTarget = new Map<string, typeof input.extensions>()
    for (const row of input.extensions) {
      const target = (row.extension as ToolOverrideResource).spec.target
      byTarget.set(target, [...(byTarget.get(target) ?? []), row])
    }
    return Object.freeze([...byTarget].flatMap(([target, rows]) => rows.length < 2 ? [] : [Object.freeze({
      code: 'extension-conflict' as const,
      severity: 'error' as const,
      message: `tool ${JSON.stringify(target)} has multiple ToolOverride owners`,
    })]))
  },
})

export function register(catalog: ManifestDefinitionCatalog): () => void {
  const disposeTool = catalog.registerExtension(extensionDefinition)
  const disposeOverride = catalog.registerExtension(overrideExtensionDefinition)
  return () => { disposeOverride(); disposeTool() }
}

export function registerComposition(catalog: CompositionRuleCatalog): () => void {
  return catalog.register(overrideCompositionRule)
}

export function assertToolOverrideHandler(value: unknown): asserts value is ToolOverrideHandler {
  if (!record(value) || typeof value.resolve !== 'function') {
    throw new TypeError('ToolOverride handler must provide resolve(original)')
  }
  if (value.subscribe !== undefined && typeof value.subscribe !== 'function') {
    throw new TypeError('ToolOverride handler.subscribe must be a function')
  }
}

export function assertToolHandler(value: unknown): asserts value is ToolHandler {
  if (!record(value) || typeof value.resolve !== 'function') {
    throw new TypeError('Tool handler must provide resolve()')
  }
  if (value.subscribe !== undefined && typeof value.subscribe !== 'function') {
    throw new TypeError('Tool handler.subscribe must be a function')
  }
}

export function assertExecutableToolDefinition(value: unknown): asserts value is ExecutableToolDefinition {
  if (!record(value)) throw new TypeError('executable Tool definition must be an object')
  toolName(value.name, 'executable Tool definition.name')
  text(value.description, 'executable Tool definition.description')
  if (!record(value.parameters)) throw new TypeError('executable Tool definition.parameters must be an object')
  if (!record(value.output)) throw new TypeError('executable Tool definition.output must be an object')
  if (typeof value.execute !== 'function') throw new TypeError('executable Tool definition.execute must be a function')
  if (value.isConcurrencySafe !== undefined && typeof value.isConcurrencySafe !== 'function') {
    throw new TypeError('executable Tool definition.isConcurrencySafe must be a function')
  }
}

export function validateToolStatus(value: unknown): void { validateStatus(value) }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateSpec(value: unknown): void {
  if (!record(value)) throw new TypeError('Tool spec must be an object')
  exact(value, ['title', 'titles', 'description'], 'Tool spec')
  text(value.title, 'Tool spec.title')
  text(value.description, 'Tool spec.description')
  if (value.titles !== undefined) localized(value.titles, 'Tool spec.titles')
}

function validateStatus(value: unknown): void {
  if (!record(value)) throw new TypeError('Tool status must be an object')
  exact(value, ['state', 'description', 'parameters', 'reason'], 'Tool status')
  if (value.state !== 'available' && value.state !== 'unavailable') throw new TypeError('Tool status.state is invalid')
  if (value.description !== undefined) text(value.description, 'Tool status.description')
  if (value.parameters !== undefined && !record(value.parameters)) throw new TypeError('Tool status.parameters must be an object')
  if (value.reason !== undefined) text(value.reason, 'Tool status.reason')
  if (value.state === 'available' && value.reason !== undefined) throw new TypeError('available Tool status cannot contain reason')
}

function localized(value: unknown, label: string): void {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  for (const [locale, translation] of Object.entries(value)) {
    text(locale, `${label} locale`)
    text(translation, `${label}.${locale}`)
  }
}

function text(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function toolName(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]*$/u.test(value)) {
    throw new TypeError(`${label} is invalid`)
  }
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key) && !key.startsWith('x-'))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
}
