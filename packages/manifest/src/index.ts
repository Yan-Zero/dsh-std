import {
  ProtocolCatalog,
  parseApiVersion,
  protocolKey,
  validateApiReference,
  type ApiReference,
  type ProtocolRequirement,
  type ProtocolSupport,
  type VersionRange,
  assertVersionRange,
  parseSemanticVersion,
} from '@dsh-std/core'
import { parseDocument } from 'yaml'

export const API_VERSION = 'manifest.dsh/v1alpha1'

const COMPONENT_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/u
const LOCAL_NAME = /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)*$/u

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
  readonly apiVersion: typeof API_VERSION
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
    const manifest = defineManifest(manifestValue)
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
  /** Resource guard only; aliases remain valid YAML 1.2 syntax. */
  readonly maxAliasCount?: number
}

/** Parse one YAML 1.2 document without installing executable custom tag constructors. */
export function parseManifest(source: string, options: ParseManifestOptions = {}): ComponentManifest {
  if (typeof source !== 'string') throw new TypeError('manifest source must be a string')
  const document = parseDocument(source, { version: '1.2', schema: 'core', prettyErrors: true })
  if (document.errors.length > 0) throw new SyntaxError(document.errors.map(error => error.message).join('; '))
  if (document.contents === null) throw new TypeError('manifest.yaml must contain one document')
  const value = document.toJS({ maxAliasCount: options.maxAliasCount ?? 100 })
  try { return defineManifest(value as ComponentManifest) } catch (error) {
    throw new TypeError(`${options.source ?? 'manifest.yaml'}: ${errorMessage(error)}`, { cause: error })
  }
}

export function defineManifest<const T extends ComponentManifest>(manifest: T): T {
  validateManifest(manifest)
  return deepFreeze(structuredClone(manifest))
}

export function validateManifest(value: unknown): asserts value is ComponentManifest {
  if (!record(value)) throw new TypeError('component manifest must be an object')
  exact(value, ['apiVersion', 'kind', 'metadata', 'spec'], 'component manifest')
  if (value.apiVersion !== API_VERSION) throw new TypeError(`unsupported component manifest apiVersion ${JSON.stringify(value.apiVersion)}`)
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
