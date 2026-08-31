import type { ManifestDefinitionCatalog, ManifestExtension } from '@dsh-std/manifest'

export const API_VERSION = 'session.dsh/v1alpha1'
export const EVENT_KIND = 'SessionEvent'

/** Opaque reference to a Session owned by one provider participant. */
export interface SessionReference { readonly provider: string; readonly id: string }

export type SessionCursor = string
export type SessionPageCursor = string

export interface SessionLineage {
  readonly parent: SessionReference
  readonly through?: SessionCursor
}

export interface SessionDescriptor {
  readonly session: SessionReference
  readonly title?: string
  readonly state: 'available' | 'unavailable'
  readonly revision: number
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly lineage?: SessionLineage
}

export type SessionErrorCode =
  | 'REFERENCE_MISMATCH'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_UNAVAILABLE'
  | 'SESSION_IN_USE'
  | 'OPERATION_NOT_NEGOTIATED'
  | 'PAGE_CURSOR_INVALID'
  | 'EVENT_CURSOR_INVALID'
  | 'LINEAGE_CURSOR_INVALID'
  | 'CATALOG_INVALIDATED'
  | 'DESCRIPTOR_INVALIDATED'
  | 'HISTORY_INVALIDATED'
  | 'UNKNOWN_REQUIRED_EVENT'
  | 'INVALID_REQUEST'
  | 'REVISION_CONFLICT'
  | 'PERMISSION_NOT_GRANTED'
  | 'FLOW_CONTROL_EXCEEDED'
  | 'PROVIDER_UNAVAILABLE'
  | 'COMMIT_FAILED'

export function validateSessionReference(value: unknown): SessionReference {
  if (!record(value)) throw new TypeError('SessionReference must be an object')
  exact(value, ['provider', 'id'], 'SessionReference')
  text(value.provider, 'SessionReference.provider'); text(value.id, 'SessionReference.id')
  return Object.freeze({ provider: value.provider as string, id: value.id as string })
}

export function validateSessionDescriptor(value: unknown): SessionDescriptor {
  if (!record(value)) throw new TypeError('SessionDescriptor must be an object')
  exact(value, ['session', 'title', 'state', 'revision', 'createdAt', 'updatedAt', 'lineage'], 'SessionDescriptor')
  const session = validateSessionReference(value.session)
  if (value.title !== undefined) text(value.title, 'SessionDescriptor.title')
  if (value.state !== 'available' && value.state !== 'unavailable') throw new TypeError('SessionDescriptor.state is invalid')
  nonNegativeInteger(value.revision, 'SessionDescriptor.revision')
  if (value.createdAt !== undefined) text(value.createdAt, 'SessionDescriptor.createdAt')
  if (value.updatedAt !== undefined) text(value.updatedAt, 'SessionDescriptor.updatedAt')
  const lineage = value.lineage === undefined ? undefined : validateSessionLineage(value.lineage)
  return deepFreeze(structuredClone({
    session,
    ...(value.title === undefined ? {} : { title: value.title as string }),
    state: value.state,
    revision: value.revision as number,
    ...(value.createdAt === undefined ? {} : { createdAt: value.createdAt as string }),
    ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt as string }),
    ...(lineage === undefined ? {} : { lineage }),
  }))
}

/** Static declaration of one durable event type understood by a component. */
export interface SessionEventSpec {
  readonly description: string
  readonly replay: 'required' | 'ignorable'
  readonly schemaDialect?: string
  /** Inert JSON Schema for the event data, when the component publishes one. */
  readonly payloadSchema?: Readonly<Record<string, unknown>>
}

export type SessionEventResource = ManifestExtension<SessionEventSpec>

export const eventExtensionDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: EVENT_KIND,
  schema: Object.freeze({
    type: 'object',
    required: ['description', 'replay'],
    properties: {
      description: { type: 'string', minLength: 1 },
      replay: { enum: ['required', 'ignorable'] },
      schemaDialect: { type: 'string', minLength: 1 },
      payloadSchema: { type: 'object' },
    },
  }),
  validateMetadata(metadata: { readonly name: string }): void {
    if (!/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)+$/u.test(metadata.name)) {
      throw new TypeError('SessionEvent metadata.name must be a namespaced event type')
    }
  },
  validateSpec(value: unknown): void {
    if (!record(value)) throw new TypeError('SessionEvent spec must be an object')
    exact(value, ['description', 'replay', 'schemaDialect', 'payloadSchema'], 'SessionEvent spec')
    text(value.description, 'SessionEvent spec.description')
    if (value.replay !== 'required' && value.replay !== 'ignorable') {
      throw new TypeError('SessionEvent spec.replay must be required or ignorable')
    }
    if (value.schemaDialect !== undefined) text(value.schemaDialect, 'SessionEvent spec.schemaDialect')
    if (value.payloadSchema !== undefined) {
      if (!record(value.payloadSchema)) throw new TypeError('SessionEvent spec.payloadSchema must be an object')
    }
  },
})

export function register(catalog: ManifestDefinitionCatalog): () => void {
  return catalog.registerExtension(eventExtensionDefinition)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key) && !key.startsWith('x-'))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
}

function text(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function validateSessionLineage(value: unknown): SessionLineage {
  if (!record(value)) throw new TypeError('SessionLineage must be an object')
  exact(value, ['parent', 'through'], 'SessionLineage')
  if (value.through !== undefined) text(value.through, 'SessionLineage.through')
  return Object.freeze({
    parent: validateSessionReference(value.parent),
    ...(value.through === undefined ? {} : { through: value.through as string }),
  })
}

function nonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative safe integer`)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}
