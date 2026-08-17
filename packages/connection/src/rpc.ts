import type {
  ProtocolDefinition,
  ProtocolIssue,
  ProtocolRequirement,
  ProtocolSupport,
} from '@dsh-std/core'
import type { ConnectionNegotiationPolicy } from './model.js'

export interface CapabilityBindingDraft {
  readonly consumer: string
  readonly provider: string
  readonly requirement: ProtocolRequirement
  readonly support: ProtocolSupport
}

export interface CapabilityAgreement {
  readonly kind: 'CapabilityBindings'
  readonly bindings: readonly CapabilityBindingDraft[]
}

export interface CapabilityProtocolOptions {
  readonly apiVersion: string
  readonly kind: string
  readonly accepts?: readonly string[]
  readonly multipleProviders?: boolean
  validateRequirement?(spec: unknown): unknown
  validateSupport?(spec: unknown): unknown
}

/** Reusable RPC-shaped protocol definition. Domain packages opt into these semantics explicitly. */
export function defineCapabilityProtocol(options: CapabilityProtocolOptions): ProtocolDefinition {
  const definition: ProtocolDefinition = {
    apiVersion: options.apiVersion,
    kind: options.kind,
    ...(options.accepts === undefined ? {} : { accepts: Object.freeze([...options.accepts]) }),
    validateRequirement: options.validateRequirement ?? ((value: unknown) => value),
    validateSupport: options.validateSupport ?? ((value: unknown) => value),
    negotiate(input) {
      const issues: ProtocolIssue[] = []
      const bindings: CapabilityBindingDraft[] = []
      const connectionPolicy = isConnectionPolicy(input.policy) ? input.policy : undefined
      for (const row of input.requirements) {
        const consumerEndpoint = connectionPolicy?.endpointByParticipant[row.participant]
        const providers = input.supports.filter(candidate =>
          candidate.participant !== row.participant
          && (consumerEndpoint === undefined
            || connectionPolicy?.endpointByParticipant[candidate.participant] !== consumerEndpoint),
        )
        if (providers.length === 0) {
          issues.push(Object.freeze({
            code: row.requirement.optional === true ? 'optional-support-missing' : 'required-support-missing',
            severity: row.requirement.optional === true ? 'warning' : 'error',
            participant: row.participant,
            message: `no participant supports ${row.requirement.apiVersion} ${row.requirement.kind}`,
          }))
          continue
        }
        if (providers.length > 1 && options.multipleProviders !== true) {
          issues.push(Object.freeze({
            code: 'support-ambiguous', severity: 'error', participant: row.participant,
            message: `multiple participants support ${row.requirement.apiVersion} ${row.requirement.kind}`,
          }))
          continue
        }
        for (const provider of options.multipleProviders === true ? providers : providers.slice(0, 1)) {
          bindings.push(Object.freeze({
            consumer: row.participant,
            provider: provider.participant,
            requirement: row.requirement,
            support: provider.support,
          }))
        }
      }
      return {
        agreement: Object.freeze({ kind: 'CapabilityBindings' as const, bindings: Object.freeze(bindings) }),
        issues: Object.freeze(issues),
      }
    },
  }
  return Object.freeze(definition)
}

function isConnectionPolicy(value: unknown): value is ConnectionNegotiationPolicy {
  return typeof value === 'object' && value !== null
    && typeof (value as { endpointByParticipant?: unknown }).endpointByParticipant === 'object'
    && (value as { endpointByParticipant?: unknown }).endpointByParticipant !== null
}

export function isCapabilityAgreement(value: unknown): value is CapabilityAgreement {
  return typeof value === 'object' && value !== null
    && (value as { kind?: unknown }).kind === 'CapabilityBindings'
    && Array.isArray((value as { bindings?: unknown }).bindings)
}
