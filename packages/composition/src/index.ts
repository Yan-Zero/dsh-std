import {
  ProtocolCatalog,
  protocolKey,
  sameProtocol,
  type ApiReference,
  type ProtocolDeclaration,
  type ProtocolRequirement,
  type ProtocolSupport,
} from '@dsh-std/core'
import {
  defineComponentManifest,
  facetIdentity,
  facetKey,
  type ComponentFacet,
  type ComponentManifest,
  type FacetIdentity,
  type ManifestExtension,
  type PermissionRequest,
} from '@dsh-std/manifest'
import { satisfiesVersionRange } from '@dsh-std/core'

export const API_VERSION = 'composition.dsh/v1alpha1'

export interface ActivationDriverDescriptor extends ApiReference {
  readonly id: string
}

export interface FacetSelector {
  readonly component: string
  readonly facet: string
  readonly required?: boolean
}

export interface SelectedFacet {
  readonly identity: FacetIdentity
  readonly manifest: ComponentManifest
  readonly facet: ComponentFacet
  readonly driver?: ActivationDriverDescriptor
  readonly participantId: string
}

export interface SkippedFacet {
  readonly identity: FacetIdentity
  readonly code: 'not-requested' | 'activation-unavailable'
  readonly message: string
}

export interface CompositionIssue {
  readonly code:
    | 'component-id-conflict'
    | 'dependency-missing'
    | 'dependency-version-mismatch'
    | 'dependency-cycle'
    | 'recommendation-missing'
    | 'recommendation-version-mismatch'
    | 'breaks-component'
    | 'component-conflict'
    | 'extension-conflict'
    | 'activation-unavailable'
    | 'protocol-definition-unavailable'
    | 'potential-support-missing'
    | 'protocol-preflight-failed'
    | 'protocol-binding-invalid'
    | 'permission-denied'
  readonly severity: 'error' | 'warning'
  readonly path?: string
  readonly components: readonly string[]
  readonly message: string
}

function normalizeManifests(input: readonly ComponentManifest[]): readonly ComponentManifest[] {
  const unique = new Map<string, ComponentManifest>()
  for (const value of input) {
    const manifest = defineComponentManifest(value)
    unique.set(canonicalJson(manifest), manifest)
  }
  return Object.freeze([...unique.entries()]
    .sort((left, right) => left[1].metadata.name.localeCompare(right[1].metadata.name)
      || left[1].metadata.version.localeCompare(right[1].metadata.version)
      || left[0].localeCompare(right[0]))
    .map(([, manifest]) => manifest))
}

function validateBindings(
  input: readonly ProtocolBinding[],
  preflight: ProtocolPreflightInput,
  output: ProtocolBinding[],
  issues: CompositionIssue[],
): void {
  const requirements = new Map(preflight.requirements.map(row => [row.id, row]))
  const supports = new Set(preflight.potentialSupports.map(row => row.id))
  const occupied = new Set(output.map(row => row.requirementId))
  for (const binding of input) {
    const requirement = requirements.get(binding.requirementId)
    const components = requirement === undefined ? [] : [requirement.facet.component]
    if (requirement === undefined) {
      issues.push(issue('protocol-binding-invalid', 'error', components, `binding references unknown requirement ${JSON.stringify(binding.requirementId)}`))
      continue
    }
    if (occupied.has(binding.requirementId)) {
      issues.push(issue('protocol-binding-invalid', 'error', components, `requirement ${JSON.stringify(binding.requirementId)} is bound more than once`))
      continue
    }
    const supportIds = [...binding.supportIds]
    const invalid = supportIds.find(id => !supports.has(id))
    if (invalid !== undefined) {
      issues.push(issue('protocol-binding-invalid', 'error', components, `binding references unknown support ${JSON.stringify(invalid)}`))
      continue
    }
    if (new Set(supportIds).size !== supportIds.length) {
      issues.push(issue('protocol-binding-invalid', 'error', components, `binding for ${JSON.stringify(binding.requirementId)} repeats a support`))
      continue
    }
    occupied.add(binding.requirementId)
    output.push(Object.freeze({
      requirementId: binding.requirementId,
      supportIds: Object.freeze(supportIds),
    }))
  }
}

export interface ProtocolPreflightInput {
  readonly requirements: readonly ProtocolRequirementCandidate[]
  readonly potentialSupports: readonly ProtocolSupportCandidate[]
}

export interface ProtocolRequirementCandidate {
  readonly id: string
  readonly facet: FacetIdentity
  readonly requirement: ProtocolRequirement
}

export interface ProtocolSupportCandidate {
  readonly id: string
  readonly facet?: FacetIdentity
  readonly participant?: string
  readonly support: ProtocolSupport
}

/** One protocol-defined binding from a consumer requirement to compatible supports. */
export interface ProtocolBinding {
  readonly requirementId: string
  readonly supportIds: readonly string[]
}

export interface ProtocolPreflightResult {
  readonly issues?: readonly Omit<CompositionIssue, 'components'>[]
  readonly bindings?: readonly ProtocolBinding[]
}

export interface ProtocolCompositionRule extends ApiReference {
  preflight(input: ProtocolPreflightInput):
    | readonly Omit<CompositionIssue, 'components'>[]
    | ProtocolPreflightResult
  composeExtensions?(input: {
    readonly extensions: readonly { readonly owner: FacetIdentity; readonly extension: ManifestExtension }[]
  }): readonly Omit<CompositionIssue, 'components'>[]
}

export interface CompositionPolicy {
  selectActivationDriver?(
    identity: FacetIdentity,
    activation: ApiReference,
    candidates: readonly ActivationDriverDescriptor[],
  ): string | undefined
  authorizePermission?(identity: FacetIdentity, permission: PermissionRequest): boolean
}

export interface CompositionInput {
  readonly manifests: readonly ComponentManifest[]
  readonly drivers: readonly ActivationDriverDescriptor[]
  readonly protocols: ProtocolCatalog
  readonly liveDeclarations?: readonly ProtocolDeclaration[]
  /** Extensions already published by active facets in the same composition scope. */
  readonly liveExtensions?: readonly { readonly owner: FacetIdentity; readonly extension: ManifestExtension }[]
  readonly select?: readonly FacetSelector[]
  readonly policy?: CompositionPolicy
}

export interface CompositionPlan {
  readonly apiVersion: typeof API_VERSION
  readonly revision: string
  readonly compatible: boolean
  readonly selected: readonly SelectedFacet[]
  readonly skipped: readonly SkippedFacet[]
  readonly activationOrder: readonly string[]
  /** Protocol-defined provision/injection bindings. Absent on legacy plans. */
  readonly bindings?: readonly ProtocolBinding[]
  readonly extensions: readonly { readonly owner: FacetIdentity; readonly extension: ManifestExtension }[]
  readonly issues: readonly CompositionIssue[]
}

export class CompositionRuleCatalog {
  private readonly rules = new Map<string, ProtocolCompositionRule>()

  register(rule: ProtocolCompositionRule): () => void {
    const key = protocolKey(rule)
    if (this.rules.has(key)) throw new Error(`composition rule ${rule.apiVersion} ${rule.kind} is already registered`)
    const stored = Object.freeze({ ...rule })
    this.rules.set(key, stored)
    return () => { if (this.rules.get(key) === stored) this.rules.delete(key) }
  }

  resolve(reference: ApiReference): ProtocolCompositionRule | undefined {
    return this.rules.get(protocolKey(reference))
  }
}

export function compose(input: CompositionInput, rules = new CompositionRuleCatalog()): CompositionPlan {
  const issues: CompositionIssue[] = []
  const manifests = normalizeManifests(input.manifests)
  const byComponent = new Map<string, ComponentManifest>()
  for (const manifest of manifests) {
    const existing = byComponent.get(manifest.metadata.name)
    if (existing !== undefined) {
      issues.push(issue('component-id-conflict', 'error', [manifest.metadata.name], `component is present more than once (${existing.metadata.version}, ${manifest.metadata.version})`))
    } else byComponent.set(manifest.metadata.name, manifest)
  }
  checkRelationships(manifests, byComponent, issues)

  const requested = new Map((input.select ?? []).map(selector => [`${selector.component}\0${selector.facet}`, selector]))
  const drivers = [...input.drivers].sort((left, right) => left.id.localeCompare(right.id))
  const selected: SelectedFacet[] = []
  const skipped: SkippedFacet[] = []
  for (const manifest of manifests) {
    for (const facet of [...manifest.spec.facets].sort((left, right) => left.name.localeCompare(right.name))) {
      const identity = facetIdentity(manifest, facet)
      const selector = requested.get(`${identity.component}\0${identity.facet}`)
      if (input.select !== undefined && selector === undefined) {
        skipped.push(Object.freeze({ identity, code: 'not-requested', message: 'facet was not selected by policy' }))
        continue
      }
      const matches = facet.activation === undefined ? [] : drivers.filter(driver => sameProtocol(driver, facet.activation as ApiReference))
      const chosenId = facet.activation === undefined || matches.length <= 1
        ? matches[0]?.id
        : input.policy?.selectActivationDriver?.(identity, facet.activation, Object.freeze(matches))
      const chosen = chosenId === undefined ? matches[0] : matches.find(row => row.id === chosenId)
      if (facet.activation !== undefined && (matches.length === 0 || chosen === undefined || (matches.length > 1 && chosenId === undefined))) {
        const message = matches.length === 0 ? 'no activation driver is available' : 'multiple activation drivers match and policy did not choose one'
        skipped.push(Object.freeze({ identity, code: 'activation-unavailable', message }))
        if (selector?.required === true) issues.push(issue('activation-unavailable', 'error', [identity.component], message, facetPath(manifest, facet)))
        continue
      }
      selected.push(Object.freeze({
        identity, manifest, facet,
        ...(chosen === undefined ? {} : { driver: chosen }),
        participantId: facetKey(identity),
      }))
    }
  }

  for (const row of selected) {
    for (const permission of row.facet.permissions ?? []) {
      if (input.policy?.authorizePermission?.(row.identity, permission) === false) {
        issues.push(issue(
          'permission-denied', permission.optional === true ? 'warning' : 'error', [row.identity.component],
          `permission ${permission.apiVersion} ${permission.kind} ${permission.action} was denied`,
          `${facetPath(row.manifest, row.facet)}/permissions/${permission.action}`,
        ))
      }
    }
  }

  const liveSupports = (input.liveDeclarations ?? []).flatMap(declaration => (declaration.supports ?? []).map((support, index) => ({
    id: `participant:${declaration.participant.id}:supports:${protocolKey(support)}:${String(index)}`,
    participant: declaration.participant.id,
    support,
  })))
  const potentialSupports = [
    ...selected.flatMap(row => (row.facet.protocols?.supports ?? []).map((support, index) => ({
      id: `${facetKey(row.identity)}:supports:${protocolKey(support)}:${String(index)}`,
      facet: row.identity,
      support,
    }))),
    ...liveSupports,
  ]
  const requirements = selected.flatMap(row => (row.facet.protocols?.requires ?? []).map((requirement, index) => ({
    id: `${facetKey(row.identity)}:requires:${protocolKey(requirement)}:${String(index)}`,
    facet: row.identity,
    requirement,
  })))
  const preflightByDefinition = new Map<object, ProtocolPreflightInput>()
  for (const row of requirements) {
    const definition = input.protocols.resolve(row.requirement)
    if (definition === undefined) {
      issues.push(issue(
        'protocol-definition-unavailable', row.requirement.optional === true ? 'warning' : 'error', [row.facet.component],
        `no protocol definition recognizes ${row.requirement.apiVersion} ${row.requirement.kind}`,
      ))
      continue
    }
    const candidates = potentialSupports.filter(candidate => input.protocols.resolve(candidate.support) === definition)
    if (candidates.length === 0) {
      issues.push(issue(
        'potential-support-missing', row.requirement.optional === true ? 'warning' : 'error', [row.facet.component],
        `no selected or live participant may support ${row.requirement.apiVersion} ${row.requirement.kind}`,
      ))
    }
    const existing = preflightByDefinition.get(definition) ?? { requirements: [], potentialSupports: [] }
    preflightByDefinition.set(definition, {
      requirements: [...existing.requirements, row],
      potentialSupports: [...new Set([...existing.potentialSupports, ...candidates])],
    })
  }
  const bindings: ProtocolBinding[] = []
  for (const [definition, preflight] of preflightByDefinition) {
    const rule = rules.resolve(definition as ApiReference)
    if (rule === undefined) continue
    const returned = rule.preflight(Object.freeze({
      requirements: Object.freeze(preflight.requirements),
      potentialSupports: Object.freeze(preflight.potentialSupports),
    }))
    const result: ProtocolPreflightResult = Array.isArray(returned)
      ? { issues: returned }
      : returned as ProtocolPreflightResult
    for (const row of result.issues ?? []) {
      issues.push(Object.freeze({ ...row, components: Object.freeze(preflight.requirements.map(item => item.facet.component)) }))
    }
    validateBindings(result.bindings ?? [], preflight, bindings, issues)
  }

  const extensions = [
    ...(input.liveExtensions ?? []).map(row => Object.freeze({ owner: Object.freeze({ ...row.owner }), extension: row.extension })),
    ...selected.flatMap(owner => (owner.facet.extensions ?? []).map(extension => Object.freeze({ owner: owner.identity, extension }))),
  ]
  const extensionGroups = new Map<string, typeof extensions>()
  for (const row of extensions) {
    const key = protocolKey(row.extension)
    extensionGroups.set(key, [...(extensionGroups.get(key) ?? []), row])
  }
  for (const rows of extensionGroups.values()) {
    const rule = rules.resolve(rows[0]!.extension)
    if (rule?.composeExtensions !== undefined) {
      for (const row of rule.composeExtensions({ extensions: Object.freeze(rows) })) {
        issues.push(Object.freeze({ ...row, components: Object.freeze([...new Set(rows.map(item => item.owner.component))]) }))
      }
      continue
    }
    const owners = new Map<string, FacetIdentity>()
    for (const row of rows) {
      const existing = owners.get(row.extension.metadata.name)
      if (existing !== undefined) {
        issues.push(issue('extension-conflict', 'error', [existing.component, row.owner.component], `extension ${row.extension.metadata.name} has multiple owners and its protocol has no composition rule`))
      } else owners.set(row.extension.metadata.name, row.owner)
    }
  }

  const activationOrder = facetActivationOrder(manifests, selected, bindings, potentialSupports, requirements, issues)
  return Object.freeze({
    apiVersion: API_VERSION,
    revision: digestInput(manifests, selected, input.liveDeclarations ?? [], bindings),
    compatible: !issues.some(row => row.severity === 'error'),
    selected: Object.freeze(selected),
    skipped: Object.freeze(skipped),
    activationOrder: Object.freeze(activationOrder),
    bindings: Object.freeze(bindings),
    extensions: Object.freeze(extensions),
    issues: Object.freeze(issues),
  })
}

function checkRelationships(
  manifests: readonly ComponentManifest[], byComponent: ReadonlyMap<string, ComponentManifest>, issues: CompositionIssue[],
): void {
  for (const manifest of manifests) {
    for (const [target, range] of Object.entries(manifest.spec.relationships?.depends ?? {})) {
      const found = byComponent.get(target)
      if (found === undefined) issues.push(issue('dependency-missing', 'error', [manifest.metadata.name, target], `required component ${target} is missing`))
      else if (!satisfiesVersionRange(found.metadata.version, range)) {
        issues.push(issue('dependency-version-mismatch', 'error', [manifest.metadata.name, target], `component ${target} does not satisfy ${String(range)}`))
      }
    }
    for (const [target, range] of Object.entries(manifest.spec.relationships?.recommends ?? {})) {
      const found = byComponent.get(target)
      if (found === undefined) issues.push(issue('recommendation-missing', 'warning', [manifest.metadata.name, target], `recommended component ${target} is missing`))
      else if (!satisfiesVersionRange(found.metadata.version, range)) {
        issues.push(issue('recommendation-version-mismatch', 'warning', [manifest.metadata.name, target], `component ${target} does not satisfy recommended range ${String(range)}`))
      }
    }
    for (const [target, range] of Object.entries(manifest.spec.relationships?.breaks ?? {})) {
      const found = byComponent.get(target)
      if (found !== undefined && satisfiesVersionRange(found.metadata.version, range)) {
        issues.push(issue('breaks-component', 'error', [manifest.metadata.name, target], `component ${manifest.metadata.name} breaks ${target}`))
      }
    }
    for (const [target, range] of Object.entries(manifest.spec.relationships?.conflicts ?? {})) {
      const found = byComponent.get(target)
      if (found !== undefined && satisfiesVersionRange(found.metadata.version, range)) {
        issues.push(issue('component-conflict', 'warning', [manifest.metadata.name, target], `component ${manifest.metadata.name} conflicts with ${target}`))
      }
    }
  }
}

function facetActivationOrder(
  manifests: readonly ComponentManifest[],
  selected: readonly SelectedFacet[],
  bindings: readonly ProtocolBinding[],
  supports: readonly ProtocolSupportCandidate[],
  requirements: readonly ProtocolRequirementCandidate[],
  issues: CompositionIssue[],
): readonly string[] {
  const nodes = new Map(selected.map(row => [facetKey(row.identity), row]))
  const outgoing = new Map([...nodes.keys()].map(id => [id, new Set<string>()]))
  const indegree = new Map([...nodes.keys()].map(id => [id, 0]))
  const addEdge = (from: string, to: string) => {
    if (from === to || !nodes.has(from) || !nodes.has(to) || outgoing.get(from)?.has(to)) return
    outgoing.get(from)?.add(to)
    indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }
  for (const manifest of manifests) {
    for (const target of Object.keys(manifest.spec.relationships?.depends ?? {})) {
      for (const provider of selected.filter(row => row.identity.component === target)) {
        for (const consumer of selected.filter(row => row.identity.component === manifest.metadata.name)) {
          addEdge(facetKey(provider.identity), facetKey(consumer.identity))
        }
      }
    }
  }
  const requirementById = new Map(requirements.map(row => [row.id, row]))
  const supportById = new Map(supports.map(row => [row.id, row]))
  for (const binding of bindings) {
    const consumer = requirementById.get(binding.requirementId)?.facet
    if (consumer === undefined) continue
    for (const supportId of binding.supportIds) {
      const provider = supportById.get(supportId)?.facet
      if (provider !== undefined) addEdge(facetKey(provider), facetKey(consumer))
    }
  }
  const ready = [...nodes.keys()].filter(id => indegree.get(id) === 0).sort()
  const result: string[] = []
  while (ready.length > 0) {
    const id = ready.shift() as string
    result.push(id)
    for (const next of [...(outgoing.get(id) ?? [])].sort()) {
      indegree.set(next, (indegree.get(next) ?? 1) - 1)
      if (indegree.get(next) === 0) { ready.push(next); ready.sort() }
    }
  }
  if (result.length !== nodes.size) {
    const blocked = [...nodes.keys()].filter(id => !result.includes(id))
    issues.push(issue(
      'dependency-cycle', 'error', [...new Set(blocked.map(id => nodes.get(id)!.identity.component))],
      'component relationships and protocol bindings contain an activation cycle',
    ))
  }
  return Object.freeze(result)
}

function facetPath(manifest: ComponentManifest, facet: ComponentFacet): string {
  return `/components/${manifest.metadata.name}/facets/${facet.name}`
}

function issue(
  code: CompositionIssue['code'], severity: CompositionIssue['severity'], components: readonly string[], message: string, path?: string,
): CompositionIssue {
  return Object.freeze({ code, severity, components: Object.freeze([...components]), message, ...(path === undefined ? {} : { path }) })
}

function digestInput(
  manifests: readonly ComponentManifest[], selected: readonly SelectedFacet[], declarations: readonly ProtocolDeclaration[],
  bindings: readonly ProtocolBinding[],
): string {
  const input = canonicalJson({
    manifests,
    facets: selected.map(row => facetKey(row.identity)),
    declarations,
    bindings,
  })
  return fnv1a(input)
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalValue(nested)]))
}

function fnv1a(input: string): string {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619)
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
