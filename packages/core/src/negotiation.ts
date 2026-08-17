import {
  protocolKey,
  validateApiReference,
  validateProtocolDeclaration,
  type ApiReference,
  type ProtocolDeclaration,
  type ProtocolRequirement,
  type ProtocolSupport,
} from './protocol.js'

export interface EvaluatorIdentity {
  readonly name: string
  readonly version: string
}

export interface ProtocolRequirementEntry<Spec = unknown> {
  readonly participant: string
  readonly requirement: ProtocolRequirement<Spec>
}

export interface ProtocolSupportEntry<Spec = unknown> {
  readonly participant: string
  readonly support: ProtocolSupport<Spec>
}

export interface ProtocolIssue {
  readonly code: string
  readonly severity: 'error' | 'warning'
  readonly participant?: string
  readonly path?: string
  readonly message: string
}

export interface ProtocolNegotiationInput<RequirementSpec = unknown, SupportSpec = unknown, Policy = unknown> {
  readonly requirements: readonly ProtocolRequirementEntry<RequirementSpec>[]
  readonly supports: readonly ProtocolSupportEntry<SupportSpec>[]
  readonly policy?: Policy
}

export interface ProtocolNegotiationOutcome<Agreement = unknown> {
  readonly agreement?: Agreement
  readonly issues?: readonly ProtocolIssue[]
}

export interface ProtocolDefinition<RequirementSpec = unknown, SupportSpec = unknown, Agreement = unknown, Policy = unknown>
  extends ApiReference {
  /** Every accepted wire/static API version. No compatibility is inferred by core. */
  readonly accepts?: readonly string[]
  validateRequirement(spec: unknown): RequirementSpec
  validateSupport(spec: unknown): SupportSpec
  negotiate(
    input: ProtocolNegotiationInput<RequirementSpec, SupportSpec, Policy>,
  ): ProtocolNegotiationOutcome<Agreement>
}

export interface NegotiatedProtocol<Agreement = unknown> extends ApiReference {
  readonly participants: readonly string[]
  readonly agreement?: Agreement
  readonly issues: readonly ProtocolIssue[]
}

export interface NegotiationReport {
  readonly apiVersion: 'core.dsh/report/v1alpha1'
  readonly evaluator: EvaluatorIdentity
  readonly compatible: boolean
  readonly protocols: readonly NegotiatedProtocol[]
  readonly issues: readonly ProtocolIssue[]
}

interface StoredDefinition {
  readonly definition: ProtocolDefinition
  readonly accepted: ReadonlySet<string>
}

export class ProtocolCatalog {
  private readonly definitions = new Map<string, StoredDefinition>()

  constructor(readonly evaluator: EvaluatorIdentity) {
    nonEmpty(evaluator.name, 'evaluator.name')
    nonEmpty(evaluator.version, 'evaluator.version')
  }

  register(definition: ProtocolDefinition): () => void {
    validateDefinition(definition)
    const accepted = new Set([definition.apiVersion, ...(definition.accepts ?? [])])
    for (const version of accepted) {
      const key = protocolKey({ apiVersion: version, kind: definition.kind })
      if (this.definitions.has(key)) {
        throw new Error(`protocol definition for ${version} ${definition.kind} is already registered`)
      }
    }
    const stored = Object.freeze({ definition: freezeDefinition(definition), accepted: new Set(accepted) })
    for (const version of accepted) this.definitions.set(protocolKey({ apiVersion: version, kind: definition.kind }), stored)
    return () => {
      for (const version of accepted) {
        const key = protocolKey({ apiVersion: version, kind: definition.kind })
        if (this.definitions.get(key) === stored) this.definitions.delete(key)
      }
    }
  }

  list(): readonly ProtocolDefinition[] {
    return Object.freeze([...new Set([...this.definitions.values()].map(row => row.definition))])
  }

  resolve(reference: ApiReference): ProtocolDefinition | undefined {
    validateApiReference(reference)
    return this.definitions.get(protocolKey(reference))?.definition
  }

  understands(reference: ApiReference): boolean {
    return this.resolve(reference) !== undefined
  }

  negotiate(declarations: readonly ProtocolDeclaration[], policy?: unknown): NegotiationReport {
    const participantIds = new Set<string>()
    for (const declaration of declarations) {
      validateProtocolDeclaration(declaration)
      if (participantIds.has(declaration.participant.id)) {
        throw new TypeError(`duplicate participant identity ${JSON.stringify(declaration.participant.id)}`)
      }
      participantIds.add(declaration.participant.id)
    }

    const groups = new Map<StoredDefinition, {
      requirements: ProtocolRequirementEntry[]
      supports: ProtocolSupportEntry[]
    }>()
    const issues: ProtocolIssue[] = []
    for (const [declarationIndex, declaration] of declarations.entries()) {
      for (const [index, requirement] of (declaration.requires ?? []).entries()) {
        const stored = this.definitions.get(protocolKey(requirement))
        if (stored === undefined) {
          issues.push(freezeIssue({
            code: 'definition-unavailable',
            severity: requirement.optional === true ? 'warning' : 'error',
            participant: declaration.participant.id,
            path: `/declarations/${declarationIndex}/requires/${index}`,
            message: `no definition recognizes ${requirement.apiVersion} ${requirement.kind}`,
          }))
          continue
        }
        const group = groups.get(stored) ?? { requirements: [], supports: [] }
        try {
          group.requirements.push(Object.freeze({
            participant: declaration.participant.id,
            requirement: Object.freeze({
              ...requirement,
              ...(Object.hasOwn(requirement, 'spec')
                ? { spec: stored.definition.validateRequirement(requirement.spec) }
                : { spec: stored.definition.validateRequirement(undefined) }),
            }),
          }))
        } catch (error) {
          issues.push(freezeIssue({
            code: 'invalid-requirement', severity: 'error', participant: declaration.participant.id,
            path: `/declarations/${declarationIndex}/requires/${index}/spec`, message: errorMessage(error),
          }))
        }
        groups.set(stored, group)
      }
      for (const [index, support] of (declaration.supports ?? []).entries()) {
        const stored = this.definitions.get(protocolKey(support))
        if (stored === undefined) {
          issues.push(freezeIssue({
            code: 'definition-unavailable', severity: 'warning', participant: declaration.participant.id,
            path: `/declarations/${declarationIndex}/supports/${index}`,
            message: `no definition recognizes ${support.apiVersion} ${support.kind}`,
          }))
          continue
        }
        const group = groups.get(stored) ?? { requirements: [], supports: [] }
        try {
          group.supports.push(Object.freeze({
            participant: declaration.participant.id,
            support: Object.freeze({
              ...support,
              ...(Object.hasOwn(support, 'spec')
                ? { spec: stored.definition.validateSupport(support.spec) }
                : { spec: stored.definition.validateSupport(undefined) }),
            }),
          }))
        } catch (error) {
          issues.push(freezeIssue({
            code: 'invalid-support', severity: 'error', participant: declaration.participant.id,
            path: `/declarations/${declarationIndex}/supports/${index}/spec`, message: errorMessage(error),
          }))
        }
        groups.set(stored, group)
      }
    }

    const protocols: NegotiatedProtocol[] = []
    for (const stored of [...groups.keys()].sort((left, right) => protocolKey(left.definition).localeCompare(protocolKey(right.definition)))) {
      const group = groups.get(stored) as NonNullable<ReturnType<typeof groups.get>>
      let outcome: ProtocolNegotiationOutcome
      try {
        outcome = stored.definition.negotiate(Object.freeze({
          requirements: Object.freeze([...group.requirements]),
          supports: Object.freeze([...group.supports]),
          ...(policy === undefined ? {} : { policy }),
        }))
      } catch (error) {
        outcome = { issues: [{ code: 'definition-failed', severity: 'error', message: errorMessage(error) }] }
      }
      const protocolIssues = Object.freeze((outcome.issues ?? []).map(freezeIssue))
      issues.push(...protocolIssues)
      protocols.push(Object.freeze({
        apiVersion: stored.definition.apiVersion,
        kind: stored.definition.kind,
        participants: Object.freeze([...new Set([
          ...group.requirements.map(row => row.participant),
          ...group.supports.map(row => row.participant),
        ])].sort()),
        ...(Object.hasOwn(outcome, 'agreement') ? { agreement: outcome.agreement } : {}),
        issues: protocolIssues,
      }))
    }

    return Object.freeze({
      apiVersion: 'core.dsh/report/v1alpha1',
      evaluator: Object.freeze({ ...this.evaluator }),
      compatible: !issues.some(issue => issue.severity === 'error'),
      protocols: Object.freeze(protocols),
      issues: Object.freeze(issues),
    })
  }
}

function validateDefinition(definition: ProtocolDefinition): void {
  validateApiReference(definition, 'protocol definition')
  if (typeof definition.validateRequirement !== 'function'
    || typeof definition.validateSupport !== 'function'
    || typeof definition.negotiate !== 'function') {
    throw new TypeError('protocol definition must provide validators and negotiate')
  }
  const versions = [definition.apiVersion, ...(definition.accepts ?? [])]
  if (new Set(versions).size !== versions.length) throw new TypeError('protocol definition accepts duplicate versions')
  for (const version of versions) validateApiReference({ apiVersion: version, kind: definition.kind })
}

function freezeDefinition(definition: ProtocolDefinition): ProtocolDefinition {
  return Object.freeze({ ...definition, ...(definition.accepts === undefined ? {} : { accepts: Object.freeze([...definition.accepts]) }) })
}

function freezeIssue(issue: ProtocolIssue): ProtocolIssue {
  if (issue.severity !== 'error' && issue.severity !== 'warning') throw new TypeError('protocol issue severity is invalid')
  nonEmpty(issue.code, 'protocol issue.code')
  nonEmpty(issue.message, 'protocol issue.message')
  return Object.freeze({ ...issue })
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
