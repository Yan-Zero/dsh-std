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
import { planDigest } from './digest.js'
import { isCapabilityAgreement } from './rpc.js'

/**
 * Resolves two endpoint offers into a connection plan whose digest both parties recompute and
 * compare before accepting the plan.
 *
 * Offer order is part of the plan identity: `left` MUST be the coordinator (initiator) offer and
 * `right` the responder offer, and both parties MUST resolve with the offers in that same order.
 * Declaration order feeds negotiation issue paths and the digest input, so swapped offers produce
 * a plan whose digest does not compare equal.
 */
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
  const agreement: Omit<ConnectionPlan, 'digest'> = {
    apiVersion: CONNECTION_API_VERSION,
    kind: 'ConnectionAgreement',
    connectionId: options.connectionId,
    revision: options.revision,
    offers: coordinates,
    compatible: report.compatible,
    protocols: report.protocols,
    bindings: Object.freeze(numbered),
    issues,
  }
  return Object.freeze({ ...agreement, digest: planDigest(agreement) })
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
