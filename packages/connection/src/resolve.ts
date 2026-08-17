import type { ProtocolIssue } from '@dsh-std/core'
import {
  CONNECTION_API_VERSION,
  freezeEndpoint,
  validateEndpointOffer,
  validatePlanCoordinates,
  type CapabilityBinding,
  type CapabilityParticipant,
  type ConnectionIssue,
  type ConnectionPlan,
  type ConnectionNegotiationPolicy,
  type EndpointOffer,
  type ResolveConnectionOptions,
} from './model.js'
import { isCapabilityAgreement } from './rpc.js'

export function resolveConnection(left: EndpointOffer, right: EndpointOffer, options: ResolveConnectionOptions): ConnectionPlan {
  validateEndpointOffer(left)
  validateEndpointOffer(right)
  validatePlanCoordinates(options.connectionId, options.revision)
  if (left.endpoint.instanceId === right.endpoint.instanceId) throw new TypeError('connection endpoints must have distinct instanceId values')

  const owner = participantOwners(left, right)
  const endpointByParticipant = Object.freeze(Object.fromEntries(
    [...owner.entries()].map(([participant, row]) => [participant, row.endpoint.instanceId]),
  ))
  const policy: ConnectionNegotiationPolicy = Object.freeze({
    endpointByParticipant,
    ...(options.policy === undefined ? {} : { protocol: options.policy }),
  })
  const report = options.protocols.negotiate([...left.declarations, ...right.declarations], policy)
  const bindings: CapabilityBinding[] = []
  for (const protocol of report.protocols) {
    if (!isCapabilityAgreement(protocol.agreement)) continue
    for (const draft of protocol.agreement.bindings) {
      const consumer = owner.get(draft.consumer)
      const provider = owner.get(draft.provider)
      if (consumer === undefined || provider === undefined) continue
      bindings.push(Object.freeze({
        bindingId: '', agreementId: `${protocol.apiVersion}:${protocol.kind}`,
        planRevision: options.revision,
        consumer, provider,
        requirement: Object.freeze({ ...draft.requirement }),
        support: Object.freeze({ ...draft.support }),
      }))
    }
  }
  bindings.sort((a, b) => a.consumer.participantId.localeCompare(b.consumer.participantId)
    || a.requirement.apiVersion.localeCompare(b.requirement.apiVersion)
    || a.requirement.kind.localeCompare(b.requirement.kind)
    || a.provider.participantId.localeCompare(b.provider.participantId))
  const numbered = bindings.map((binding, index) => Object.freeze({ ...binding, bindingId: `binding-${String(index + 1)}` }))
  const issues = Object.freeze(report.issues.map(row => connectionIssue(row, owner)))
  const coordinates = Object.freeze([
    Object.freeze({ endpoint: freezeEndpoint(left.endpoint), revision: left.revision }),
    Object.freeze({ endpoint: freezeEndpoint(right.endpoint), revision: right.revision }),
  ])
  const digest = planDigest({ connectionId: options.connectionId, revision: options.revision, offers: coordinates, protocols: report.protocols })
  return Object.freeze({
    apiVersion: CONNECTION_API_VERSION,
    kind: 'ConnectionAgreement',
    connectionId: options.connectionId,
    revision: options.revision,
    digest,
    offers: coordinates,
    compatible: report.compatible,
    protocols: report.protocols,
    bindings: Object.freeze(numbered),
    issues,
  })
}

function planDigest(value: unknown): string {
  const input = canonical(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619)
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function participantOwners(left: EndpointOffer, right: EndpointOffer): Map<string, CapabilityParticipant> {
  const owners = new Map<string, CapabilityParticipant>()
  for (const offer of [left, right]) {
    for (const declaration of offer.declarations) {
      if (owners.has(declaration.participant.id)) throw new TypeError(`participant ${JSON.stringify(declaration.participant.id)} appears in both endpoint offers`)
      owners.set(declaration.participant.id, Object.freeze({
        endpoint: freezeEndpoint(offer.endpoint), participantId: declaration.participant.id,
      }))
    }
  }
  return owners
}

function connectionIssue(issue: ProtocolIssue, owners: ReadonlyMap<string, CapabilityParticipant>): ConnectionIssue {
  return Object.freeze({
    severity: issue.severity,
    code: issue.code,
    ...(issue.participant === undefined ? {} : {
      participant: owners.get(issue.participant) ?? Object.freeze({
        endpoint: Object.freeze({ id: 'unknown', instanceId: 'unknown' }), participantId: issue.participant,
      }),
    }),
    ...(issue.path === undefined ? {} : { path: issue.path }),
    message: issue.message,
  })
}
