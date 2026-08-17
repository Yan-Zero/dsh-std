import type { ManifestDefinitionCatalog, ManifestExtension } from '@dsh-std/manifest'

export const API_VERSION = 'session.dsh/v1alpha1'
export const EVENT_KIND = 'SessionEvent'

/** Static declaration of one durable event type understood by a component. */
export interface SessionEventSpec {
  readonly description: string
  readonly replay: 'required' | 'ignorable'
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
    exact(value, ['description', 'replay', 'payloadSchema'], 'SessionEvent spec')
    text(value.description, 'SessionEvent spec.description')
    if (value.replay !== 'required' && value.replay !== 'ignorable') {
      throw new TypeError('SessionEvent spec.replay must be required or ignorable')
    }
    if (value.payloadSchema !== undefined && !record(value.payloadSchema)) {
      throw new TypeError('SessionEvent spec.payloadSchema must be an object')
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
