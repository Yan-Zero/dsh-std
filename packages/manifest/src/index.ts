import {
  ProtocolCatalog,
  protocolKey,
  validateApiReference,
  type ApiReference,
  type ProtocolRequirement,
  type ProtocolSupport,
  type VersionRange,
  assertVersionRange,
  parseSemanticVersion,
} from '@dsh-std/core'
export const COMMUNITY_V015_MANIFEST_VERSION = '0.15'
export const COMPONENT_API_VERSION = 'manifest.dsh/internal/v1alpha1'
export const COMMUNITY_PERMISSION_API_VERSION = 'community.dsh/v1alpha1'
export const COMMUNITY_PERMISSION_KIND = 'Permission'

const COMPONENT_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/u
const LOCAL_NAME = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)*$/u

export interface CommunityContractReference extends ApiReference {
  readonly optional?: boolean
  readonly fallback?: string
}

export interface CommunityPermissionRequest {
  readonly name: string
  readonly scope: string
  readonly reason?: string
}

export interface CommunityCommandContribution {
  readonly id: string
  readonly title: string
  readonly description?: string
}

export type CommunitySubscription = string | (ApiReference & { readonly scope?: string })

export interface CommunityPluginManifestV015 {
  /** Draft schema identifier. It is not fetched while loading the plugin. */
  readonly $schema: string
  readonly manifestVersion: typeof COMMUNITY_V015_MANIFEST_VERSION
  readonly id: string
  readonly name: string
  readonly version: string
  readonly facets: {
    readonly host: { readonly entry: string; readonly apiVersion: string }
  }
  readonly requires: {
    readonly contracts: readonly CommunityContractReference[]
    readonly services?: readonly never[]
  }
  readonly permissions: readonly CommunityPermissionRequest[]
  readonly contributes: {
    readonly commands: readonly CommunityCommandContribution[]
    readonly panels?: readonly never[]
  } & Readonly<Record<string, readonly unknown[]>>
  readonly subscriptions: readonly CommunitySubscription[]
  readonly license?: string
  readonly source?: { readonly repository: string; readonly revision?: string }
  readonly artifact?: { readonly digest: string; readonly algorithm: 'sha256'; readonly path: string }
  readonly compat?: { readonly hosts?: readonly string[] }
  readonly overrides?: readonly {
    readonly target: string
    readonly kind: 'patch' | 'native' | 'build'
    readonly description?: string
  }[]
}

export type PluginManifest = CommunityPluginManifestV015

export interface ComponentRelationships {
  readonly depends?: Readonly<Record<string, VersionRange>>
  readonly recommends?: Readonly<Record<string, VersionRange>>
  readonly conflicts?: Readonly<Record<string, VersionRange>>
  readonly breaks?: Readonly<Record<string, VersionRange>>
}

export interface ActivationObject<Spec = unknown> extends ApiReference {
  readonly spec: Spec
}

export interface ExtensionMetadata {
  readonly name: string
  readonly labels?: Readonly<Record<string, string>>
}

export interface ManifestExtension<Spec = unknown> extends ApiReference {
  readonly metadata: ExtensionMetadata
  readonly spec: Spec
}

export interface PermissionRequest<Spec = unknown> extends ApiReference {
  readonly action: string
  readonly optional?: boolean
  readonly reason?: string
  readonly spec?: Spec
}

export interface ComponentFacet {
  readonly name: string
  readonly activation?: ActivationObject
  readonly protocols?: {
    readonly requires?: readonly ProtocolRequirement[]
    readonly supports?: readonly ProtocolSupport[]
  }
  readonly extensions?: readonly ManifestExtension[]
  readonly permissions?: readonly PermissionRequest[]
}

export interface ComponentManifest {
  /** Host-internal projection. Portable packages publish PluginManifest instead. */
  readonly apiVersion: typeof COMPONENT_API_VERSION
  readonly kind: 'Component'
  readonly metadata: {
    readonly name: string
    readonly version: string
    readonly displayName?: string
  }
  readonly spec: {
    readonly facets: readonly ComponentFacet[]
    readonly relationships?: ComponentRelationships
  }
}

export interface FacetIdentity {
  readonly component: string
  readonly version: string
  readonly facet: string
}

export interface ManifestObjectDefinition<Spec = unknown> extends ApiReference {
  validateSpec(spec: unknown): Spec
  /** Extension-owned identity validation. Activation definitions leave this undefined. */
  validateMetadata?(metadata: ExtensionMetadata): void
}

export interface ManifestValidationIssue {
  readonly code: 'unknown-protocol' | 'unknown-activation' | 'unknown-extension' | 'invalid-activation' | 'invalid-extension'
  readonly severity: 'error' | 'warning'
  readonly path: string
  readonly message: string
}

export interface ManifestValidationReport {
  readonly apiVersion: 'manifest.dsh/report/v1alpha1'
  readonly validator: { readonly name: string; readonly version: string }
  readonly source: string
  readonly digest: string
  readonly manifest: { readonly name: string; readonly version: string }
  readonly compatible: boolean
  readonly issues: readonly ManifestValidationIssue[]
}

export class ManifestDefinitionCatalog {
  private readonly activations = new Map<string, ManifestObjectDefinition>()
  private readonly extensions = new Map<string, ManifestObjectDefinition>()

  constructor(readonly validator = Object.freeze({ name: '@dsh-std/manifest', version: '0.1.0' })) {
    nonEmpty(validator.name, 'validator.name')
    nonEmpty(validator.version, 'validator.version')
  }

  registerActivation(definition: ManifestObjectDefinition): () => void {
    return registerDefinition(this.activations, definition, 'activation')
  }

  registerExtension(definition: ManifestObjectDefinition): () => void {
    return registerDefinition(this.extensions, definition, 'extension')
  }

  activation(reference: ApiReference): ManifestObjectDefinition | undefined {
    return this.activations.get(protocolKey(reference))
  }

  extension(reference: ApiReference): ManifestObjectDefinition | undefined {
    return this.extensions.get(protocolKey(reference))
  }

  validate(
    manifestValue: ComponentManifest,
    protocols?: ProtocolCatalog,
    options: { readonly source?: string; readonly digest?: string } = {},
  ): ManifestValidationReport {
    const manifest = defineComponentManifest(manifestValue)
    const issues: ManifestValidationIssue[] = []
    for (const [facetIndex, facet] of manifest.spec.facets.entries()) {
      const base = `/spec/facets/${facetIndex}`
      if (facet.activation !== undefined) {
        const definition = this.activation(facet.activation)
        if (definition === undefined) {
          issues.push(issue('unknown-activation', 'warning', `${base}/activation`, 'activation definition is not installed'))
        } else {
          try { definition.validateSpec(facet.activation.spec) } catch (error) {
            issues.push(issue('invalid-activation', 'error', `${base}/activation/spec`, errorMessage(error)))
          }
        }
      }
      for (const direction of ['requires', 'supports'] as const) {
        for (const [index, row] of (facet.protocols?.[direction] ?? []).entries()) {
          if (protocols !== undefined && !protocols.understands(row)) {
            issues.push(issue('unknown-protocol', 'warning', `${base}/protocols/${direction}/${index}`, `protocol ${row.apiVersion} ${row.kind} is unknown`))
          }
        }
      }
      for (const [index, extension] of (facet.extensions ?? []).entries()) {
        const definition = this.extension(extension)
        if (definition === undefined) {
          issues.push(issue('unknown-extension', 'warning', `${base}/extensions/${index}`, 'extension definition is not installed'))
        } else {
          try {
            definition.validateMetadata?.(extension.metadata)
            definition.validateSpec(extension.spec)
          } catch (error) {
            issues.push(issue('invalid-extension', 'error', `${base}/extensions/${index}`, errorMessage(error)))
          }
        }
      }
    }
    return Object.freeze({
      apiVersion: 'manifest.dsh/report/v1alpha1',
      validator: Object.freeze({ ...this.validator }),
      source: options.source ?? 'memory:',
      digest: options.digest ?? manifestDigest(manifest),
      manifest: Object.freeze({ name: manifest.metadata.name, version: manifest.metadata.version }),
      compatible: !issues.some(row => row.severity === 'error'),
      issues: Object.freeze(issues),
    })
  }
}

export interface ParseManifestOptions {
  readonly source?: string
}

/** Parse the package-root dsh-plugin.json without executing plugin code or fetching a schema. */
export function parseManifest(source: string, options: ParseManifestOptions = {}): PluginManifest {
  if (typeof source !== 'string') throw new TypeError('manifest source must be a string')
  let value: unknown
  try { value = JSON.parse(source) } catch (error) {
    throw new SyntaxError(`${options.source ?? 'dsh-plugin.json'}: ${errorMessage(error)}`, { cause: error })
  }
  try { return defineManifest(value as PluginManifest) } catch (error) {
    throw new TypeError(`${options.source ?? 'dsh-plugin.json'}: ${errorMessage(error)}`, { cause: error })
  }
}

export function defineManifest<const T extends PluginManifest>(manifest: T): T {
  validateManifest(manifest)
  return deepFreeze(structuredClone(manifest))
}

export function validateManifest(value: unknown): asserts value is PluginManifest {
  if (!record(value)) throw new TypeError('plugin manifest must be an object')
  if (value.manifestVersion === COMMUNITY_V015_MANIFEST_VERSION) {
    validateCommunityManifest(value)
    return
  }
  throw new TypeError(`unsupported plugin manifest $schema ${JSON.stringify(value.$schema)} and manifestVersion ${JSON.stringify(value.manifestVersion)}`)
}

function validateCommunityManifest(value: Record<string, unknown>): void {
  exact(value, [
    '$schema', 'manifestVersion', 'id', 'name', 'version', 'facets', 'requires', 'permissions',
    'contributes', 'subscriptions', 'license', 'source', 'artifact', 'compat', 'overrides',
  ], 'community v0.15 plugin manifest')
  validateSchemaIdentifier(value.$schema, 'community v0.15 manifest.$schema')
  if (value.manifestVersion !== COMMUNITY_V015_MANIFEST_VERSION) {
    throw new TypeError(`unsupported Community v0.15 manifestVersion ${JSON.stringify(value.manifestVersion)}`)
  }
  namespaced(value.id, 'community v0.15 manifest.id')
  nonEmpty(value.name, 'community v0.15 manifest.name')
  nonEmpty(value.version, 'community v0.15 manifest.version')
  parseSemanticVersion(value.version as string)
  validateCommunityFacets(value.facets)
  validateCommunityRequirements(value.requires)
  validateCommunityPermissions(value.permissions)
  validateCommunityContributions(value.contributes)
  validateCommunitySubscriptions(value.subscriptions)
  if (value.license !== undefined) nonEmpty(value.license, 'community v0.15 manifest.license')
  if (value.source !== undefined) validateCommunitySource(value.source)
  if (value.artifact !== undefined) validateCommunityArtifact(value.artifact)
  if (value.compat !== undefined) validateCommunityCompat(value.compat)
  if (value.overrides !== undefined) validateCommunityOverrides(value.overrides)
}

/** Validate a host-internal Component/Facet projection. */
export function defineComponentManifest<const T extends ComponentManifest>(manifest: T): T {
  validateComponentManifest(manifest)
  return deepFreeze(structuredClone(manifest))
}

export function validateComponentManifest(value: unknown): asserts value is ComponentManifest {
  if (!record(value)) throw new TypeError('component manifest must be an object')
  exact(value, ['apiVersion', 'kind', 'metadata', 'spec'], 'component manifest')
  if (value.apiVersion !== COMPONENT_API_VERSION) throw new TypeError(`unsupported component manifest apiVersion ${JSON.stringify(value.apiVersion)}`)
  if (value.kind !== 'Component') throw new TypeError('component manifest kind must be "Component"')
  if (!record(value.metadata)) throw new TypeError('component metadata must be an object')
  exact(value.metadata, ['name', 'version', 'displayName'], 'component metadata')
  namespaced(value.metadata.name, 'component metadata.name')
  nonEmpty(value.metadata.version, 'component metadata.version')
  parseSemanticVersion(value.metadata.version as string)
  if (value.metadata.displayName !== undefined) nonEmpty(value.metadata.displayName, 'component metadata.displayName')
  if (!record(value.spec)) throw new TypeError('component spec must be an object')
  exact(value.spec, ['facets', 'relationships'], 'component spec')
  if (!Array.isArray(value.spec.facets) || value.spec.facets.length === 0) throw new TypeError('component spec.facets must be a non-empty array')
  const names = new Set<string>()
  for (const [index, facet] of value.spec.facets.entries()) {
    validateFacet(facet, index)
    const name = (facet as ComponentFacet).name
    if (names.has(name)) throw new TypeError(`duplicate facet name ${JSON.stringify(name)}`)
    names.add(name)
  }
  if (value.spec.relationships !== undefined) validateRelationships(value.spec.relationships, value.metadata.name as string)
}

/** Project a supported package manifest version into the common host composition model. */
export function projectManifest(manifestValue: PluginManifest): ComponentManifest {
  const manifest = defineManifest(manifestValue)
  return projectCommunityManifest(manifest)
}

function projectCommunityManifest(manifest: CommunityPluginManifestV015): ComponentManifest {
  const extensions: ManifestExtension[] = manifest.contributes.commands.map(row => Object.freeze({
    apiVersion: 'commands.dsh/v1alpha1',
    kind: 'Command',
    metadata: Object.freeze({
      name: localContributionName(row.id),
      labels: Object.freeze({ 'dsh.std/contribution-id': row.id }),
    }),
    spec: Object.freeze({
      title: row.title,
      ...(row.description === undefined ? {} : { description: row.description }),
    }),
  }))
  for (const [point, contributions] of Object.entries(manifest.contributes)) {
    if (!point.startsWith('x-')) continue
    for (const contribution of contributions) {
      if (!record(contribution)
        || typeof contribution.apiVersion !== 'string'
        || typeof contribution.kind !== 'string'
        || typeof contribution.id !== 'string'
        || typeof contribution.name !== 'string'
        || !Object.hasOwn(contribution, 'spec')) continue
      extensions.push(Object.freeze({
        apiVersion: contribution.apiVersion,
        kind: contribution.kind,
        metadata: Object.freeze({
          name: contribution.name,
          labels: Object.freeze({ 'dsh.std/contribution-id': contribution.id }),
        }),
        spec: contribution.spec,
      }))
    }
  }
  const requirements = manifest.requires.contracts.map(communityRequirement)
  const permissions: PermissionRequest[] = manifest.permissions.map(permission => Object.freeze({
    apiVersion: COMMUNITY_PERMISSION_API_VERSION,
    kind: COMMUNITY_PERMISSION_KIND,
    action: permission.name,
    ...(permission.reason === undefined ? {} : { reason: permission.reason }),
    spec: Object.freeze({ scope: permission.scope }),
  }))
  return defineComponentManifest({
    apiVersion: COMPONENT_API_VERSION,
    kind: 'Component',
    metadata: { name: manifest.id, displayName: manifest.name, version: manifest.version },
    spec: {
      facets: [{
        name: 'host',
        activation: {
          apiVersion: 'lifecycle.dsh/v1alpha1',
          kind: 'FacetModule',
          spec: { module: manifest.facets.host.entry },
        },
        ...(requirements.length === 0 ? {} : { protocols: { requires: requirements } }),
        ...(extensions.length === 0 ? {} : { extensions }),
        ...(permissions.length === 0 ? {} : { permissions }),
      }],
    },
  })
}

function communityRequirement(reference: CommunityContractReference): ProtocolRequirement {
  return Object.freeze({
    apiVersion: reference.apiVersion,
    kind: reference.kind,
    ...(reference.optional === undefined ? {} : { optional: reference.optional }),
    ...(reference.fallback === undefined ? {} : { 'x-community-fallback': reference.fallback }),
  })
}

export function facetIdentity(manifest: ComponentManifest, facet: ComponentFacet): FacetIdentity {
  if (!(manifest.spec.facets as readonly ComponentFacet[]).includes(facet)) {
    const found = manifest.spec.facets.find(candidate => candidate.name === facet.name)
    if (found === undefined) throw new TypeError(`facet ${JSON.stringify(facet.name)} does not belong to component`)
  }
  return Object.freeze({ component: manifest.metadata.name, version: manifest.metadata.version, facet: facet.name })
}

export function facetKey(identity: FacetIdentity): string {
  return `${identity.component}@${identity.version}#${identity.facet}`
}

export function findFacet(manifest: ComponentManifest, name: string): ComponentFacet | undefined {
  return manifest.spec.facets.find(facet => facet.name === name)
}

function validateCommunityFacets(value: unknown): void {
  const label = 'community v0.15 manifest.facets'
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  exact(value, ['host'], label, false)
  if (!record(value.host)) throw new TypeError(`${label}.host must be an object`)
  exact(value.host, ['entry', 'apiVersion'], `${label}.host`, false)
  validatePackageRelative(value.host.entry, `${label}.host.entry`)
  if (typeof value.host.apiVersion !== 'string'
    || !/^v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/u.test(value.host.apiVersion)) {
    throw new TypeError(`${label}.host.apiVersion is invalid`)
  }
}

function validateCommunityRequirements(value: unknown): void {
  const label = 'community v0.15 manifest.requires'
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  exact(value, ['contracts', 'services'], label, false)
  if (!Array.isArray(value.contracts)) throw new TypeError(`${label}.contracts must be an array`)
  const seen = new Set<string>()
  for (const [index, referenceValue] of value.contracts.entries()) {
    const rowLabel = `${label}.contracts[${index}]`
    validateApiReference(referenceValue, rowLabel)
    const reference = referenceValue as unknown as Record<string, unknown>
    exact(reference, ['apiVersion', 'kind', 'optional', 'fallback'], rowLabel, false)
    if (reference.optional !== undefined && typeof reference.optional !== 'boolean') {
      throw new TypeError(`${rowLabel}.optional must be boolean`)
    }
    if (reference.fallback !== undefined) nonEmpty(reference.fallback, `${rowLabel}.fallback`)
    const key = protocolKey(reference as unknown as ApiReference)
    if (seen.has(key)) throw new TypeError(`${label}.contracts contains duplicate contract ${JSON.stringify(key)}`)
    seen.add(key)
  }
  if (value.services !== undefined && (!Array.isArray(value.services) || value.services.length !== 0)) {
    throw new TypeError(`${label}.services must be an empty array in v0.15`)
  }
}

function validateCommunityPermissions(value: unknown): void {
  const label = 'community v0.15 manifest.permissions'
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const seen = new Set<string>()
  for (const [index, permissionValue] of value.entries()) {
    const rowLabel = `${label}[${index}]`
    if (!record(permissionValue)) throw new TypeError(`${rowLabel} must be an object`)
    exact(permissionValue, ['name', 'scope', 'reason'], rowLabel, false)
    capabilityId(permissionValue.name, `${rowLabel}.name`)
    nonEmpty(permissionValue.scope, `${rowLabel}.scope`)
    if (permissionValue.reason !== undefined) nonEmpty(permissionValue.reason, `${rowLabel}.reason`)
    const key = `${String(permissionValue.name)}\0${String(permissionValue.scope)}`
    if (seen.has(key)) throw new TypeError(`${label} contains duplicate permission ${JSON.stringify(key)}`)
    seen.add(key)
  }
}

function validateCommunityContributions(value: unknown): void {
  const label = 'community v0.15 manifest.contributes'
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  const unknown = Object.keys(value).filter(point => point !== 'commands' && point !== 'panels' && !point.startsWith('x-'))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown contribution point ${JSON.stringify(unknown[0])}`)
  if (!Array.isArray(value.commands)) throw new TypeError(`${label}.commands must be an array`)
  const ids = new Set<string>()
  for (const [index, commandValue] of value.commands.entries()) {
    const rowLabel = `${label}.commands[${index}]`
    if (!record(commandValue)) throw new TypeError(`${rowLabel} must be an object`)
    exact(commandValue, ['id', 'title', 'description'], rowLabel, false)
    namespaced(commandValue.id, `${rowLabel}.id`)
    nonEmpty(commandValue.title, `${rowLabel}.title`)
    if (commandValue.description !== undefined) nonEmpty(commandValue.description, `${rowLabel}.description`)
    if (ids.has(commandValue.id)) throw new TypeError(`${label}.commands contains duplicate id ${JSON.stringify(commandValue.id)}`)
    ids.add(commandValue.id)
  }
  if (value.panels !== undefined && (!Array.isArray(value.panels) || value.panels.length !== 0)) {
    throw new TypeError(`${label}.panels must be an empty array in v0.15`)
  }
  for (const [point, contributions] of Object.entries(value)) {
    if (!point.startsWith('x-')) continue
    if (!Array.isArray(contributions)) throw new TypeError(`${label}.${point} must be an array`)
  }
}

function validateCommunitySubscriptions(value: unknown): void {
  const label = 'community v0.15 manifest.subscriptions'
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const seen = new Set<string>()
  for (const [index, subscriptionValue] of value.entries()) {
    const rowLabel = `${label}[${index}]`
    let key: string
    if (typeof subscriptionValue === 'string') {
      nonEmpty(subscriptionValue, rowLabel)
      key = `legacy\0${subscriptionValue}`
    } else {
      validateApiReference(subscriptionValue, rowLabel)
      const subscription = subscriptionValue as unknown as Record<string, unknown>
      exact(subscription, ['apiVersion', 'kind', 'scope'], rowLabel, false)
      if (subscription.scope !== undefined) nonEmpty(subscription.scope, `${rowLabel}.scope`)
      key = `${protocolKey(subscription as unknown as ApiReference)}\0${String(subscription.scope ?? '')}`
    }
    if (seen.has(key)) throw new TypeError(`${label} contains duplicate subscription ${JSON.stringify(key)}`)
    seen.add(key)
  }
}

function validateCommunitySource(value: unknown): void {
  const label = 'community v0.15 manifest.source'
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  exact(value, ['repository', 'revision'], label, false)
  validateSchemaIdentifier(value.repository, `${label}.repository`)
  if (value.revision !== undefined) nonEmpty(value.revision, `${label}.revision`)
}

function validateCommunityArtifact(value: unknown): void {
  const label = 'community v0.15 manifest.artifact'
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  exact(value, ['digest', 'algorithm', 'path'], label, false)
  if (value.algorithm !== 'sha256') throw new TypeError(`${label}.algorithm must be "sha256"`)
  if (typeof value.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value.digest)) {
    throw new TypeError(`${label}.digest must be a SHA-256 digest`)
  }
  validatePackageRelative(value.path, `${label}.path`)
}

function validateCommunityCompat(value: unknown): void {
  const label = 'community v0.15 manifest.compat'
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  exact(value, ['hosts'], label, false)
  if (value.hosts === undefined) return
  if (!Array.isArray(value.hosts)) throw new TypeError(`${label}.hosts must be an array`)
  const seen = new Set<string>()
  for (const [index, host] of value.hosts.entries()) {
    nonEmpty(host, `${label}.hosts[${index}]`)
    if (seen.has(host)) throw new TypeError(`${label}.hosts contains duplicate ${JSON.stringify(host)}`)
    seen.add(host)
  }
}

function validateCommunityOverrides(value: unknown): void {
  const label = 'community v0.15 manifest.overrides'
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  for (const [index, overrideValue] of value.entries()) {
    const rowLabel = `${label}[${index}]`
    if (!record(overrideValue)) throw new TypeError(`${rowLabel} must be an object`)
    exact(overrideValue, ['target', 'kind', 'description'], rowLabel, false)
    nonEmpty(overrideValue.target, `${rowLabel}.target`)
    if (overrideValue.kind !== 'patch' && overrideValue.kind !== 'native' && overrideValue.kind !== 'build') {
      throw new TypeError(`${rowLabel}.kind is invalid`)
    }
    if (overrideValue.description !== undefined) nonEmpty(overrideValue.description, `${rowLabel}.description`)
  }
}

function validatePackageRelative(value: unknown, label: string): asserts value is string {
  nonEmpty(value, label)
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:[\\/]/u.test(value)) {
    throw new TypeError(`${label} must be package-relative`)
  }
  const segments = value.replaceAll('\\', '/').split('/')
  if (segments.includes('..')) throw new TypeError(`${label} must remain inside the package`)
}

function capabilityId(value: unknown, label: string): asserts value is string {
  if (value === 'commands' || value === 'storage.local' || value === 'messages.observe') return
  if (typeof value !== 'string' || !/^(?:x-[a-z0-9][a-z0-9.-]*\.)?[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/u.test(value)) {
    throw new TypeError(`${label} must be a namespaced capability identifier`)
  }
}

function localContributionName(id: string): string {
  const name = id.split('.').at(-1) ?? id
  localName(name, 'contribution local name')
  return name
}

function validateFacet(value: unknown, index: number): void {
  const label = `component spec.facets[${index}]`
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  exact(value, ['name', 'activation', 'protocols', 'extensions', 'permissions'], label)
  localName(value.name, `${label}.name`)
  if (value.activation !== undefined) validateActivation(value.activation, `${label}.activation`)
  if (value.protocols !== undefined) validateProtocols(value.protocols, `${label}.protocols`)
  if (value.extensions !== undefined) validateExtensions(value.extensions, `${label}.extensions`)
  if (value.permissions !== undefined) validatePermissions(value.permissions, `${label}.permissions`)
  if (value.activation === undefined && value.protocols === undefined && value.extensions === undefined && value.permissions === undefined) {
    throw new TypeError(`${label} must declare activation, protocols, extensions, or permissions`)
  }
}

function validateActivation(value: unknown, label: string): void {
  validateApiReference(value, label)
  const row = value as unknown as Record<string, unknown>
  exact(row, ['apiVersion', 'kind', 'spec'], label)
  if (!Object.hasOwn(row, 'spec')) throw new TypeError(`${label}.spec is required`)
}

function validateProtocols(value: unknown, label: string): void {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  exact(value, ['requires', 'supports'], label)
  validateProtocolRows(value.requires, true, `${label}.requires`)
  validateProtocolRows(value.supports, false, `${label}.supports`)
}

function validateProtocolRows(value: unknown, requirement: boolean, label: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const seen = new Set<string>()
  for (const [index, rowValue] of value.entries()) {
    const rowLabel = `${label}[${index}]`
    validateApiReference(rowValue, rowLabel)
    const row = rowValue as unknown as Record<string, unknown>
    exact(row, requirement ? ['apiVersion', 'kind', 'optional', 'spec'] : ['apiVersion', 'kind', 'spec'], rowLabel)
    if (requirement && row.optional !== undefined && typeof row.optional !== 'boolean') throw new TypeError(`${rowLabel}.optional must be boolean`)
    const key = protocolKey(row as unknown as ApiReference)
    if (seen.has(key)) throw new TypeError(`${label} contains duplicate protocol ${JSON.stringify(key)}`)
    seen.add(key)
  }
}

function validateExtensions(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const seen = new Set<string>()
  for (const [index, extensionValue] of value.entries()) {
    const rowLabel = `${label}[${index}]`
    validateApiReference(extensionValue, rowLabel)
    const extension = extensionValue as unknown as Record<string, unknown>
    exact(extension, ['apiVersion', 'kind', 'metadata', 'spec'], rowLabel)
    if (!record(extension.metadata)) throw new TypeError(`${rowLabel}.metadata must be an object`)
    exact(extension.metadata, ['name', 'labels'], `${rowLabel}.metadata`)
    nonEmpty(extension.metadata.name, `${rowLabel}.metadata.name`)
    if (extension.metadata.labels !== undefined) validateLabels(extension.metadata.labels, `${rowLabel}.metadata.labels`)
    if (!Object.hasOwn(extension, 'spec')) throw new TypeError(`${rowLabel}.spec is required`)
    if (Object.hasOwn(extension, 'status')) throw new TypeError(`${rowLabel}.status is runtime-owned`)
    const key = `${protocolKey(extension as unknown as ApiReference)}\0${String(extension.metadata.name)}`
    if (seen.has(key)) throw new TypeError(`${label} contains duplicate extension ${JSON.stringify(key)}`)
    seen.add(key)
  }
}

function validatePermissions(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const seen = new Set<string>()
  for (const [index, permissionValue] of value.entries()) {
    const rowLabel = `${label}[${index}]`
    validateApiReference(permissionValue, rowLabel)
    const permission = permissionValue as unknown as Record<string, unknown>
    exact(permission, ['apiVersion', 'kind', 'action', 'optional', 'reason', 'spec'], rowLabel)
    localName(permission.action, `${rowLabel}.action`)
    if (permission.optional !== undefined && typeof permission.optional !== 'boolean') throw new TypeError(`${rowLabel}.optional must be boolean`)
    if (permission.reason !== undefined) nonEmpty(permission.reason, `${rowLabel}.reason`)
    const key = `${protocolKey(permission as unknown as ApiReference)}\0${String(permission.action)}`
    if (seen.has(key)) throw new TypeError(`${label} contains duplicate permission ${JSON.stringify(key)}`)
    seen.add(key)
  }
}

function validateRelationships(value: unknown, component: string): void {
  if (!record(value)) throw new TypeError('component relationships must be an object')
  exact(value, ['depends', 'recommends', 'conflicts', 'breaks'], 'component relationships', false)
  for (const kind of ['depends', 'recommends', 'conflicts', 'breaks'] as const) {
    const rows = value[kind]
    if (rows === undefined) continue
    if (!record(rows)) throw new TypeError(`component relationships.${kind} must be an object`)
    for (const [target, range] of Object.entries(rows)) {
      namespaced(target, `component relationships.${kind} target`)
      if (target === component) throw new TypeError(`component cannot declare ${kind} on itself`)
      assertVersionRange(range as VersionRange)
    }
  }
}

function registerDefinition(
  target: Map<string, ManifestObjectDefinition>,
  definition: ManifestObjectDefinition,
  label: string,
): () => void {
  validateApiReference(definition, `${label} definition`)
  if (typeof definition.validateSpec !== 'function') throw new TypeError(`${label} definition.validateSpec must be a function`)
  const key = protocolKey(definition)
  if (target.has(key)) throw new Error(`${label} definition ${definition.apiVersion} ${definition.kind} is already registered`)
  const stored = Object.freeze({ ...definition })
  target.set(key, stored)
  return () => { if (target.get(key) === stored) target.delete(key) }
}

function issue(
  code: ManifestValidationIssue['code'], severity: ManifestValidationIssue['severity'], path: string, message: string,
): ManifestValidationIssue {
  return Object.freeze({ code, severity, path, message })
}

function validateLabels(value: unknown, label: string): void {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  for (const [key, item] of Object.entries(value)) {
    nonEmpty(key, `${label} key`)
    if (typeof item !== 'string') throw new TypeError(`${label}.${key} must be a string`)
  }
}

function namespaced(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !COMPONENT_ID.test(value)) throw new TypeError(`${label} must be namespaced`)
}

function localName(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !LOCAL_NAME.test(value)) throw new TypeError(`${label} is invalid`)
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function validateSchemaIdentifier(value: unknown, label: string): asserts value is string {
  nonEmpty(value, label)
  try { new URL(value) } catch (error) {
    throw new TypeError(`${label} must be an absolute URI`, { cause: error })
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string, extensions = true): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key) && !(extensions && key.startsWith('x-')))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function manifestDigest(manifest: ComponentManifest): string {
  const input = canonical(manifest)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619)
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (record(value)) {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
