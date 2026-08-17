import type {
  CapabilityAgreement,
  CapabilityBindingDraft,
  ConnectionNegotiationPolicy,
} from '@dsh-std/connection'
import type {
  ProtocolIssue,
  ProtocolNegotiationInput,
  ProtocolNegotiationOutcome,
} from '@dsh-std/core'

interface OperationRequirementSpec {
  readonly operations: readonly string[]
  readonly optionalOperations?: readonly string[]
}

interface OperationSupportSpec {
  readonly operations: readonly string[]
}

export function negotiateWorkspaceCapability<
  Requirement extends OperationRequirementSpec,
  Support extends OperationSupportSpec,
>(
  input: ProtocolNegotiationInput<Requirement, Support>,
  options: {
    readonly kind: string
    compatible(requirement: Requirement, support: Support): boolean
  },
): ProtocolNegotiationOutcome<CapabilityAgreement> {
  const issues: ProtocolIssue[] = []
  const bindings: CapabilityBindingDraft[] = []
  const policy = connectionPolicy(input.policy)

  for (const row of input.requirements) {
    const consumerEndpoint = policy?.endpointByParticipant[row.participant]
    const candidates = input.supports.filter(candidate => {
      if (candidate.participant === row.participant) return false
      if (consumerEndpoint !== undefined && policy?.endpointByParticipant[candidate.participant] === consumerEndpoint) return false
      return options.compatible(row.requirement.spec!, candidate.support.spec!)
    })

    if (candidates.length === 0) {
      issues.push(Object.freeze({
        code: row.requirement.optional === true ? 'optional-support-missing' : 'required-support-missing',
        severity: row.requirement.optional === true ? 'warning' : 'error',
        participant: row.participant,
        message: `no participant supports the required ${options.kind} agreement`,
      }))
      continue
    }
    if (candidates.length > 1) {
      issues.push(Object.freeze({
        code: 'support-ambiguous', severity: 'error', participant: row.participant,
        message: `multiple participants support the required ${options.kind} agreement`,
      }))
      continue
    }

    const provider = candidates[0]!
    bindings.push(Object.freeze({
      consumer: row.participant,
      provider: provider.participant,
      requirement: row.requirement,
      support: provider.support,
    }))
    for (const operation of row.requirement.spec!.optionalOperations ?? []) {
      if (provider.support.spec!.operations.includes(operation)) continue
      issues.push(Object.freeze({
        code: 'optional-operation-missing', severity: 'warning', participant: row.participant,
        message: `${options.kind} provider does not support optional operation ${JSON.stringify(operation)}`,
      }))
    }
  }

  return Object.freeze({
    agreement: Object.freeze({ kind: 'CapabilityBindings', bindings: Object.freeze(bindings) }),
    issues: Object.freeze(issues),
  })
}

function connectionPolicy(value: unknown): ConnectionNegotiationPolicy | undefined {
  return typeof value === 'object' && value !== null
    && typeof (value as { endpointByParticipant?: unknown }).endpointByParticipant === 'object'
    && (value as { endpointByParticipant?: unknown }).endpointByParticipant !== null
    ? value as ConnectionNegotiationPolicy
    : undefined
}
