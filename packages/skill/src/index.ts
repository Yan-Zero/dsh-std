import type {
  ProtocolCatalog,
  ProtocolDefinition,
  ProtocolIssue,
  ProtocolSupport,
} from '@dsh-std/core'
import type { ManifestDefinitionCatalog, ManifestExtension } from '@dsh-std/manifest'

export const API_VERSION = 'skills.dsh/v1alpha1'
export const KIND = 'Skill'

export interface SkillInvocationPolicy {
  /** Whether model-facing discovery may expose this Skill. Defaults to true. */
  readonly model?: boolean
  /** Whether explicit human invocation may expose this Skill. Defaults to true. */
  readonly user?: boolean
}

export interface SkillSpec {
  /** Short routing description suitable for a catalog. */
  readonly description: string
  /** UTF-8 Markdown asset resolved relative to the package containing the manifest. */
  readonly entry: string
  /** Optional invocation visibility. Omitted members default to true. */
  readonly invocation?: SkillInvocationPolicy
}

export type SkillResource = ManifestExtension<SkillSpec>

/** Inert activation-time marker used to publish a declared Skill resource. */
export type SkillPublication = null
export const publication: SkillPublication = null

export interface ResolvedSkillInvocationPolicy {
  readonly model: boolean
  readonly user: boolean
}

export const extensionDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
  validateMetadata(metadata: { readonly name: string }): void {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(metadata.name)) {
      throw new TypeError('Skill metadata.name must be a kebab-case name')
    }
  },
  validateSpec: validateSkillSpec,
})

/** Host support for accepting and owning Skill resource publications. */
export const resourceProtocol: ProtocolDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
  validateRequirement: emptyProtocolSpec,
  validateSupport: emptyProtocolSpec,
  negotiate(input) {
    const issues: ProtocolIssue[] = []
    for (const row of input.requirements) {
      if (input.supports.some(candidate => candidate.participant !== row.participant)) continue
      issues.push(Object.freeze({
        code: row.requirement.optional === true ? 'optional-support-missing' : 'required-support-missing',
        severity: row.requirement.optional === true ? 'warning' : 'error',
        participant: row.participant,
        message: `no participant accepts ${row.requirement.apiVersion} ${row.requirement.kind} resources`,
      }))
    }
    return {
      agreement: Object.freeze({ kind: 'ResourcePublication' as const }),
      issues: Object.freeze(issues),
    }
  },
} satisfies ProtocolDefinition)

export const resourceSupport: ProtocolSupport = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
})

export function register(protocols: ProtocolCatalog, manifest?: ManifestDefinitionCatalog): () => void {
  const disposeExtension = manifest?.registerExtension(extensionDefinition) ?? (() => undefined)
  const disposeProtocol = protocols.register(resourceProtocol)
  return () => {
    disposeProtocol()
    disposeExtension()
  }
}

export function validateSkillSpec(value: unknown): SkillSpec {
  if (!record(value)) throw new TypeError('Skill spec must be an object')
  exact(value, ['description', 'entry', 'invocation'], 'Skill spec')
  nonEmpty(value.description, 'Skill spec.description')
  validateEntry(value.entry)
  const invocation = value.invocation === undefined ? undefined : validateInvocation(value.invocation)
  return Object.freeze({
    description: value.description as string,
    entry: value.entry as string,
    ...(invocation === undefined ? {} : { invocation }),
  })
}

export function resolveSkillInvocation(value?: SkillInvocationPolicy): ResolvedSkillInvocationPolicy {
  const invocation = value === undefined ? undefined : validateInvocation(value)
  return Object.freeze({
    model: invocation?.model ?? true,
    user: invocation?.user ?? true,
  })
}

export function assertSkillPublication(value: unknown): asserts value is SkillPublication {
  if (value !== null) throw new TypeError('Skill publication marker must be null')
}

function validateInvocation(value: unknown): SkillInvocationPolicy {
  if (!record(value)) throw new TypeError('Skill spec.invocation must be an object')
  exact(value, ['model', 'user'], 'Skill spec.invocation')
  if (value.model !== undefined && typeof value.model !== 'boolean') {
    throw new TypeError('Skill spec.invocation.model must be a boolean')
  }
  if (value.user !== undefined && typeof value.user !== 'boolean') {
    throw new TypeError('Skill spec.invocation.user must be a boolean')
  }
  const model = value.model as boolean | undefined
  const user = value.user as boolean | undefined
  if (model === false && user === false) {
    throw new TypeError('Skill spec.invocation must enable model or user invocation')
  }
  return Object.freeze({
    ...(model === undefined ? {} : { model }),
    ...(user === undefined ? {} : { user }),
  })
}

function validateEntry(value: unknown): asserts value is string {
  nonEmpty(value, 'Skill spec.entry')
  const entry = value as string
  if (entry.startsWith('/') || entry.includes('\\') || entry.includes('\0')) {
    throw new TypeError('Skill spec.entry must be a portable package-relative path')
  }
  const segments = entry.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError('Skill spec.entry must not contain empty, dot, or parent segments')
  }
  if (segments.some(segment => !/^[A-Za-z0-9._-]+$/u.test(segment))) {
    throw new TypeError('Skill spec.entry contains a non-portable path segment')
  }
}

function emptyProtocolSpec(value: unknown): undefined {
  if (value !== undefined) throw new TypeError('Skill resource protocol does not accept spec')
  return undefined
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key) && !key.startsWith('x-'))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}
