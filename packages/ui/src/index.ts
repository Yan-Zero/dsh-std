import {
  validateApiReference,
  type ApiReference,
  type ProtocolCatalog,
  type ProtocolDefinition,
  type ProtocolIssue,
  type ProtocolNegotiationInput,
  type ProtocolRequirement,
  type ProtocolSupport,
} from '@dsh-std/core'
import type { ManifestDefinitionCatalog, ManifestExtension } from '@dsh-std/manifest'

export const API_VERSION = 'ui.dsh/v1alpha1'
export const CONTRIBUTION_HOST_KIND = 'ContributionHost'
export const CONTRIBUTION_KIND = 'UiContribution'

export type UiContentMode = 'host-rendered' | 'local-module'
export type UiJsonValue = null | boolean | number | string | readonly UiJsonValue[] | { readonly [key: string]: UiJsonValue }

export interface UiSurfaceRequirement extends ApiReference {
  readonly mode: UiContentMode
  readonly spec?: unknown
}

export interface ContributionHostRequirementSpec {
  readonly surfaces: readonly UiSurfaceRequirement[]
}

export interface UiSurfaceSupport extends ApiReference {
  readonly modes: readonly UiContentMode[]
  readonly spec?: unknown
}

export interface ContributionHostSupportSpec {
  readonly surfaces: readonly UiSurfaceSupport[]
}

export interface UiSurfaceAgreement extends ApiReference {
  readonly consumer: string
  readonly provider: string
  readonly mode: UiContentMode
  readonly requirementSpec?: unknown
  readonly supportSpec?: unknown
}

export interface ContributionHostAgreement {
  readonly surfaces: readonly UiSurfaceAgreement[]
}

export interface UiContributionDescriptor extends Readonly<Record<string, unknown>> {
  readonly id: string
  readonly surface: ApiReference
  readonly placement?: string
  readonly content: UiJsonValue
}

export interface UiContributionRegistration {
  readonly descriptor: UiContributionDescriptor
  readonly localModule?: unknown
}

export interface StaticUiContributionSpec extends UiContributionDescriptor {
  readonly mode: UiContentMode
}

export type UiContributionResource = ManifestExtension<StaticUiContributionSpec>

export interface UiContributionOwner {
  readonly component: string
  readonly version: string
  readonly facet: string
  readonly instanceId: string
  readonly participantId: string
}

export interface UiContributionRegistrationContext {
  readonly agreement: UiSurfaceAgreement
  readonly signal: AbortSignal
}

/** Product-owned renderer/registry behind one negotiated ContributionHost support. */
export interface UiContributionProvider {
  readonly participantId: string
  readonly support: ContributionHostSupportSpec
  register(
    owner: UiContributionOwner,
    contribution: UiContributionRegistration,
    context: UiContributionRegistrationContext,
  ): () => void | Promise<void>
}

export interface UiContributionLease {
  readonly descriptor: UiContributionDescriptor
  dispose(): Promise<void>
}

export interface ContributionHostClient {
  readonly surfaces: readonly UiSurfaceAgreement[]
  register(contribution: UiContributionRegistration): UiContributionLease
}

export interface BoundContributionHost {
  readonly client: ContributionHostClient
  close(reason?: string): Promise<void>
}

export const contributionHostProtocol: ProtocolDefinition<
  ContributionHostRequirementSpec,
  ContributionHostSupportSpec,
  ContributionHostAgreement
> = Object.freeze({
  apiVersion: API_VERSION,
  kind: CONTRIBUTION_HOST_KIND,
  validateRequirement: validateContributionHostRequirement,
  validateSupport: validateContributionHostSupport,
  negotiate: negotiateContributionHost,
})

export const contributionExtensionDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: CONTRIBUTION_KIND,
  validateMetadata(metadata: { readonly name: string }): void {
    localId(metadata.name, 'UiContribution metadata.name')
  },
  validateSpec(value: unknown): StaticUiContributionSpec {
    const row = contributionRecord(value, true, 'UiContribution spec')
    return freezeClone(row as unknown as StaticUiContributionSpec)
  },
})

export function contributionHostRequirement(
  spec: ContributionHostRequirementSpec,
  optional = false,
): ProtocolRequirement<ContributionHostRequirementSpec> {
  return Object.freeze({
    apiVersion: API_VERSION,
    kind: CONTRIBUTION_HOST_KIND,
    spec: validateContributionHostRequirement(spec),
    ...(optional ? { optional: true } : {}),
  })
}

export function contributionHostSupport(
  spec: ContributionHostSupportSpec,
): ProtocolSupport<ContributionHostSupportSpec> {
  return Object.freeze({
    apiVersion: API_VERSION,
    kind: CONTRIBUTION_HOST_KIND,
    spec: validateContributionHostSupport(spec),
  })
}

export function register(catalog: ProtocolCatalog): () => void {
  return catalog.register(contributionHostProtocol)
}

export function registerManifest(catalog: ManifestDefinitionCatalog): () => void {
  return catalog.registerExtension(contributionExtensionDefinition)
}

/** Bind one activation to a same-process product provider and own every returned lease. */
export function bindContributionHost(
  agreementValue: ContributionHostAgreement,
  ownerValue: UiContributionOwner,
  provider: UiContributionProvider,
): BoundContributionHost {
  return bindContributionHosts(agreementValue, ownerValue, [provider])
}

/** Bind one activation to every product provider selected by its surface agreements. */
export function bindContributionHosts(
  agreementValue: ContributionHostAgreement,
  ownerValue: UiContributionOwner,
  providers: readonly UiContributionProvider[],
): BoundContributionHost {
  const agreement = validateContributionHostAgreement(agreementValue)
  const owner = validateOwner(ownerValue)
  const providerMap = new Map<string, { readonly provider: UiContributionProvider; readonly support: ContributionHostSupportSpec }>()
  for (const provider of providers) {
    nonEmpty(provider.participantId, 'UI contribution provider participantId')
    if (providerMap.has(provider.participantId)) throw new TypeError(`duplicate UI provider participant ${JSON.stringify(provider.participantId)}`)
    providerMap.set(provider.participantId, { provider, support: validateContributionHostSupport(provider.support) })
  }
  const surfaces = Object.freeze(agreement.surfaces.filter(row => row.consumer === owner.participantId))
  for (const row of surfaces) {
    const selected = providerMap.get(row.provider)
    if (selected === undefined) throw new Error(`negotiated UI provider ${JSON.stringify(row.provider)} is unavailable`)
    const supported = selected.support.surfaces.find(candidate => sameSurface(candidate, row))
    if (supported === undefined || !supported.modes.includes(row.mode)) {
      throw new Error(`UI provider no longer supports ${row.apiVersion} ${row.kind} in ${row.mode} mode`)
    }
  }
  const controller = new AbortController()
  const leases: Lease[] = []
  const keys = new Set<string>()
  let closed = false

  const client: ContributionHostClient = Object.freeze({
    surfaces,
    register(contributionValue: UiContributionRegistration): UiContributionLease {
      if (closed) throw new Error('UI ContributionHost activation scope is closed')
      const contribution = validateRegistration(contributionValue)
      const surface = surfaces.find(row => sameSurface(row, contribution.descriptor.surface))
      if (surface === undefined) {
        throw new Error(`UI surface ${contribution.descriptor.surface.apiVersion} ${contribution.descriptor.surface.kind} was not negotiated for this activation`)
      }
      if (surface.mode === 'local-module' && contribution.localModule === undefined) {
        throw new TypeError('local-module UI contribution must provide localModule')
      }
      if (surface.mode === 'host-rendered' && contribution.localModule !== undefined) {
        throw new TypeError('host-rendered UI contribution cannot provide localModule')
      }
      const key = `${surface.apiVersion}\0${surface.kind}\0${contribution.descriptor.id}`
      if (keys.has(key)) throw new Error(`duplicate UI contribution id ${JSON.stringify(contribution.descriptor.id)} for ${surface.apiVersion} ${surface.kind}`)
      const selected = providerMap.get(surface.provider)
      if (selected === undefined) throw new Error(`negotiated UI provider ${JSON.stringify(surface.provider)} is unavailable`)
      const dispose = selected.provider.register(owner, contribution, Object.freeze({ agreement: surface, signal: controller.signal }))
      if (typeof dispose !== 'function') throw new TypeError('UI contribution provider.register must return a disposer')
      keys.add(key)
      const lease = new Lease(contribution.descriptor, async () => {
        keys.delete(key)
        const index = leases.indexOf(lease)
        if (index >= 0) leases.splice(index, 1)
        await dispose()
      })
      leases.push(lease)
      return lease
    },
  })

  return Object.freeze({
    client,
    async close(reason?: string) {
      if (closed) return
      closed = true
      controller.abort(reason)
      const errors: unknown[] = []
      for (const lease of [...leases].reverse()) {
        try { await lease.dispose() } catch (error) { errors.push(error) }
      }
      if (errors.length > 0) throw new AggregateError(errors, 'one or more UI contributions failed to dispose')
    },
  })
}

export function validateContributionHostRequirement(value: unknown): ContributionHostRequirementSpec {
  const row = exactRecord(value, ['surfaces'], ['surfaces'], 'ContributionHost requirement spec')
  if (!Array.isArray(row.surfaces) || row.surfaces.length === 0) {
    throw new TypeError('ContributionHost requirement spec.surfaces must be a non-empty array')
  }
  const surfaces = row.surfaces.map((surface, index) => requirementSurface(surface, `ContributionHost requirement spec.surfaces[${index}]`))
  assertDistinctSurfaces(surfaces, 'ContributionHost requirement spec.surfaces')
  return deepFreeze({ surfaces })
}

export function validateContributionHostSupport(value: unknown): ContributionHostSupportSpec {
  const row = exactRecord(value, ['surfaces'], ['surfaces'], 'ContributionHost support spec')
  if (!Array.isArray(row.surfaces) || row.surfaces.length === 0) {
    throw new TypeError('ContributionHost support spec.surfaces must be a non-empty array')
  }
  const surfaces = row.surfaces.map((surface, index) => supportSurface(surface, `ContributionHost support spec.surfaces[${index}]`))
  assertDistinctSurfaces(surfaces, 'ContributionHost support spec.surfaces')
  return deepFreeze({ surfaces })
}

export function validateContributionHostAgreement(value: unknown): ContributionHostAgreement {
  const row = exactRecord(value, ['surfaces'], ['surfaces'], 'ContributionHost agreement')
  if (!Array.isArray(row.surfaces)) throw new TypeError('ContributionHost agreement.surfaces must be an array')
  const surfaces = row.surfaces.map((surfaceValue, index) => {
    const label = `ContributionHost agreement.surfaces[${index}]`
    const surface = exactRecord(
      surfaceValue,
      ['apiVersion', 'kind', 'consumer', 'provider', 'mode', 'requirementSpec', 'supportSpec'],
      ['apiVersion', 'kind', 'consumer', 'provider', 'mode'],
      label,
    )
    validateApiReference(surface, label)
    nonEmpty(surface.consumer, `${label}.consumer`)
    nonEmpty(surface.provider, `${label}.provider`)
    contentMode(surface.mode, `${label}.mode`)
    return freezeClone(surface as unknown as UiSurfaceAgreement)
  })
  const keys = new Set<string>()
  for (const surface of surfaces) {
    const key = `${surface.consumer}\0${surface.apiVersion}\0${surface.kind}`
    if (keys.has(key)) throw new TypeError('ContributionHost agreement contains a duplicate consumer surface')
    keys.add(key)
  }
  return deepFreeze({ surfaces })
}

function negotiateContributionHost(
  input: ProtocolNegotiationInput<ContributionHostRequirementSpec, ContributionHostSupportSpec>,
): { readonly agreement: ContributionHostAgreement; readonly issues: readonly ProtocolIssue[] } {
  const surfaces: UiSurfaceAgreement[] = []
  const issues: ProtocolIssue[] = []
  for (const requirementEntry of input.requirements) {
    const optional = requirementEntry.requirement.optional === true
    for (const requested of requirementEntry.requirement.spec?.surfaces ?? []) {
      const candidates = input.supports.flatMap(entry =>
        (entry.support.spec?.surfaces ?? [])
          .filter(supported => sameSurface(supported, requested) && supported.modes.includes(requested.mode))
          .map(supported => ({ entry, supported })))
      if (candidates.length === 0) {
        issues.push(Object.freeze({
          code: 'ui-surface-unavailable',
          severity: optional ? 'warning' : 'error',
          participant: requirementEntry.participant,
          message: `no provider supports UI surface ${requested.apiVersion} ${requested.kind} in ${requested.mode} mode`,
        }))
        continue
      }
      if (candidates.length > 1) {
        issues.push(Object.freeze({
          code: 'ui-placement-conflict', severity: 'error', participant: requirementEntry.participant,
          message: `multiple providers support UI surface ${requested.apiVersion} ${requested.kind} in ${requested.mode} mode`,
        }))
        continue
      }
      const candidate = candidates[0]!
      surfaces.push(deepFreeze({
        apiVersion: requested.apiVersion,
        kind: requested.kind,
        consumer: requirementEntry.participant,
        provider: candidate.entry.participant,
        mode: requested.mode,
        ...(requested.spec === undefined ? {} : { requirementSpec: requested.spec }),
        ...(candidate.supported.spec === undefined ? {} : { supportSpec: candidate.supported.spec }),
      }))
    }
  }
  return Object.freeze({ agreement: deepFreeze({ surfaces }), issues: Object.freeze(issues) })
}

function requirementSurface(value: unknown, label: string): UiSurfaceRequirement {
  const row = exactRecord(value, ['apiVersion', 'kind', 'mode', 'spec'], ['apiVersion', 'kind', 'mode'], label)
  validateApiReference(row, label)
  contentMode(row.mode, `${label}.mode`)
  return freezeClone(row as unknown as UiSurfaceRequirement)
}

function supportSurface(value: unknown, label: string): UiSurfaceSupport {
  const row = exactRecord(value, ['apiVersion', 'kind', 'modes', 'spec'], ['apiVersion', 'kind', 'modes'], label)
  validateApiReference(row, label)
  if (!Array.isArray(row.modes) || row.modes.length === 0) throw new TypeError(`${label}.modes must be a non-empty array`)
  for (const mode of row.modes) contentMode(mode, `${label}.modes item`)
  if (new Set(row.modes).size !== row.modes.length) throw new TypeError(`${label}.modes contains a duplicate`)
  return freezeClone(row as unknown as UiSurfaceSupport)
}

function validateRegistration(value: unknown): UiContributionRegistration {
  const row = exactRecord(value, ['descriptor', 'localModule'], ['descriptor'], 'UI contribution registration')
  const descriptor = contributionRecord(row.descriptor, false, 'UI contribution descriptor') as unknown as UiContributionDescriptor
  return Object.freeze({ descriptor: freezeClone(descriptor), ...(Object.hasOwn(row, 'localModule') ? { localModule: row.localModule } : {}) })
}

function contributionRecord(value: unknown, withMode: boolean, label: string): Record<string, unknown> {
  const allowed = ['id', 'surface', 'placement', 'content', ...(withMode ? ['mode'] : [])]
  const required = ['id', 'surface', 'content', ...(withMode ? ['mode'] : [])]
  const row = exactRecord(value, allowed, required, label)
  localId(row.id, `${label}.id`)
  validateApiReference(row.surface, `${label}.surface`)
  if (row.placement !== undefined) nonEmpty(row.placement, `${label}.placement`)
  assertJson(row.content, `${label}.content`)
  if (withMode) contentMode(row.mode, `${label}.mode`)
  return row
}

function validateOwner(value: unknown): UiContributionOwner {
  const row = exactRecord(
    value,
    ['component', 'version', 'facet', 'instanceId', 'participantId'],
    ['component', 'version', 'facet', 'instanceId', 'participantId'],
    'UI contribution owner',
  )
  for (const field of ['component', 'version', 'facet', 'instanceId', 'participantId'] as const) nonEmpty(row[field], `UI contribution owner.${field}`)
  return Object.freeze({ ...row }) as unknown as UiContributionOwner
}

class Lease implements UiContributionLease {
  private active = true
  constructor(readonly descriptor: UiContributionDescriptor, private readonly cleanup: () => Promise<void>) {}
  async dispose(): Promise<void> {
    if (!this.active) return
    this.active = false
    await this.cleanup()
  }
}

function assertDistinctSurfaces(surfaces: readonly ApiReference[], label: string): void {
  const keys = new Set<string>()
  for (const surface of surfaces) {
    const key = `${surface.apiVersion}\0${surface.kind}`
    if (keys.has(key)) throw new TypeError(`${label} contains a duplicate surface`)
    keys.add(key)
  }
}

function sameSurface(left: ApiReference, right: ApiReference): boolean {
  return left.apiVersion === right.apiVersion && left.kind === right.kind
}

function contentMode(value: unknown, label: string): asserts value is UiContentMode {
  if (value !== 'host-rendered' && value !== 'local-module') throw new TypeError(`${label} is invalid`)
}

function assertJson(value: unknown, label: string, seen = new Set<object>()): asserts value is UiJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must contain finite numbers`)
    return
  }
  if (typeof value !== 'object') throw new TypeError(`${label} must be JSON-serializable`)
  if (seen.has(value)) throw new TypeError(`${label} must not contain cycles`)
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJson(item, `${label}[${index}]`, seen))
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must contain plain objects`)
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new TypeError(`${label}.${key} must not be undefined`)
      assertJson(item, `${label}.${key}`, seen)
    }
  }
  seen.delete(value)
}

function exactRecord(value: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  const row = value as Record<string, unknown>
  const unknown = Object.keys(row).filter(key => !allowed.includes(key) && !key.startsWith('x-'))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
  for (const key of required) if (!Object.hasOwn(row, key)) throw new TypeError(`${label}.${key} is required`)
  return row
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function localId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(value)) throw new TypeError(`${label} is invalid`)
}

function freezeClone<T>(value: T): T { return deepFreeze(structuredClone(value)) }

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}
