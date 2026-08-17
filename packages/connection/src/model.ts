import type {
  NegotiatedProtocol,
  ProtocolDeclaration,
  ProtocolRequirement,
  ProtocolSupport,
} from '@dsh-std/core'
import type { ProtocolCatalog } from '@dsh-std/core'
import { defineProtocolDeclaration, validateProtocolDeclaration } from '@dsh-std/core'

export const CONNECTION_API_VERSION = 'connection.dsh/v1alpha1'

export interface EndpointIdentity {
  readonly id: string
  readonly instanceId: string
}

export interface EndpointOffer {
  readonly apiVersion: typeof CONNECTION_API_VERSION
  readonly kind: 'ConnectionOffer'
  readonly endpoint: EndpointIdentity
  readonly revision: number
  readonly declarations: readonly ProtocolDeclaration[]
}

export interface ConnectionEndpointReference extends EndpointIdentity {}

export interface CapabilityParticipant {
  readonly endpoint: ConnectionEndpointReference
  readonly participantId: string
}

export interface CapabilityBinding {
  readonly bindingId: string
  readonly agreementId: string
  readonly planRevision: number
  readonly consumer: CapabilityParticipant
  readonly provider: CapabilityParticipant
  readonly requirement: ProtocolRequirement
  readonly support: ProtocolSupport
}

export interface ConnectionIssue {
  readonly severity: 'error' | 'warning'
  readonly code: string
  readonly participant?: CapabilityParticipant
  readonly path?: string
  readonly message: string
}

export interface ConnectionPlan {
  readonly apiVersion: typeof CONNECTION_API_VERSION
  readonly kind: 'ConnectionAgreement'
  readonly connectionId: string
  readonly revision: number
  readonly digest: string
  readonly offers: readonly {
    readonly endpoint: ConnectionEndpointReference
    readonly revision: number
  }[]
  readonly compatible: boolean
  readonly protocols: readonly NegotiatedProtocol[]
  readonly bindings: readonly CapabilityBinding[]
  readonly issues: readonly ConnectionIssue[]
}

export interface ResolveConnectionOptions {
  readonly connectionId: string
  readonly revision: number
  readonly protocols: ProtocolCatalog
  readonly policy?: unknown
}

/** Policy envelope supplied to definitions while evaluating a pair of endpoint offers. */
export interface ConnectionNegotiationPolicy {
  readonly endpointByParticipant: Readonly<Record<string, string>>
  readonly protocol?: unknown
}

export function createEndpointOffer(
  endpoint: EndpointIdentity,
  revision: number,
  declarations: readonly ProtocolDeclaration[],
): EndpointOffer {
  validateEndpoint(endpoint)
  validateOfferRevision(revision)
  const seen = new Set<string>()
  const normalized = declarations.map(declaration => defineProtocolDeclaration(declaration))
  for (const declaration of normalized) {
    if (seen.has(declaration.participant.id)) throw new TypeError(`duplicate endpoint participant ${JSON.stringify(declaration.participant.id)}`)
    seen.add(declaration.participant.id)
  }
  return Object.freeze({
    apiVersion: CONNECTION_API_VERSION,
    kind: 'ConnectionOffer',
    endpoint: freezeEndpoint(endpoint),
    revision,
    declarations: Object.freeze(normalized),
  })
}

export function validateEndpointOffer(offer: EndpointOffer): void {
  if (offer.apiVersion !== CONNECTION_API_VERSION || offer.kind !== 'ConnectionOffer') throw new TypeError('endpoint offer version or kind is unsupported')
  validateEndpoint(offer.endpoint)
  validateOfferRevision(offer.revision)
  if (!Array.isArray(offer.declarations)) throw new TypeError('endpoint offer declarations must be an array')
  const seen = new Set<string>()
  for (const declaration of offer.declarations) {
    validateProtocolDeclaration(declaration)
    if (seen.has(declaration.participant.id)) throw new TypeError(`duplicate endpoint participant ${JSON.stringify(declaration.participant.id)}`)
    seen.add(declaration.participant.id)
  }
}

export function freezeEndpoint(endpoint: EndpointIdentity): ConnectionEndpointReference {
  return Object.freeze({ id: endpoint.id, instanceId: endpoint.instanceId })
}

export function validatePlanCoordinates(connectionId: string, revision: number): void {
  nonEmpty(connectionId, 'connectionId')
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('connection revision must be a positive safe integer')
}

function validateEndpoint(endpoint: EndpointIdentity): void {
  nonEmpty(endpoint.id, 'endpoint.id')
  nonEmpty(endpoint.instanceId, 'endpoint.instanceId')
}

function validateOfferRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('offer revision must be a non-negative safe integer')
}

function nonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}
