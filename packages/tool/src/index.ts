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
  /** Human-readable reason for the override. */
  readonly description: string
}

export type ToolOverrideResource = ManifestExtension<ToolOverrideSpec>

/**
 * Runtime implementation of a ToolOverride. `undefined` leaves the original
 * definition visible, which permits a live policy to disable an override.
 */
export interface ToolOverrideHandler<Definition = unknown> {
  resolve(original: Definition): Definition | undefined
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
      description: { type: 'string', minLength: 1 },
    },
  }),
  validateMetadata(metadata: { readonly name: string }): void {
    toolName(metadata.name, 'ToolOverride metadata.name')
  },
  validateSpec(value: unknown): void {
    if (!record(value)) throw new TypeError('ToolOverride spec must be an object')
    exact(value, ['target', 'description'], 'ToolOverride spec')
    text(value.target, 'ToolOverride spec.target')
    text(value.description, 'ToolOverride spec.description')
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
