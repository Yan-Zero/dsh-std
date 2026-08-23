import type {
  ProtocolCatalog,
  ProtocolDefinition,
  ProtocolIssue,
  ProtocolNegotiationInput,
  ProtocolRequirement,
  ProtocolSupport,
} from '@dsh-std/core'

export const API_VERSION = 'storage.dsh/v1alpha1'
export const KIND = 'LocalStorage'

export const READ_PERMISSION = 'storage.local.read'
export const WRITE_PERMISSION = 'storage.local.write'
export const PRESENCE_FEATURE = 'presence'
export const LIST_FEATURE = 'list'

export type LocalStorageFeature = typeof PRESENCE_FEATURE | typeof LIST_FEATURE

export interface LocalStorageRequirementSpec {
  readonly features?: readonly LocalStorageFeature[]
}

export interface LocalStorageSupportSpec {
  readonly features?: readonly LocalStorageFeature[]
  /** Required when `list` is advertised. */
  readonly maxListPageSize?: number
}

export interface LocalStorageAgreement {
  readonly kind: 'LocalStorageBindings'
  readonly providers: Readonly<Record<string, string>>
  /** Present only for consumers that requested optional features. */
  readonly features?: Readonly<Record<string, readonly LocalStorageFeature[]>>
  /** Present only for consumers that negotiated `list`. */
  readonly maxListPageSizes?: Readonly<Record<string, number>>
}

export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface LocalStorageGetInput {
  readonly key: string
}

export interface LocalStorageGetOutput {
  readonly value: JsonValue | null
}

export interface LocalStorageSetInput {
  readonly key: string
  readonly value: JsonValue
}

export interface LocalStorageSetOutput {
  readonly stored: true
}

export interface LocalStorageDeleteInput {
  readonly key: string
}

export interface LocalStorageDeleteOutput {
  readonly deleted: boolean
}

export interface LocalStorageHasInput {
  readonly key: string
}

export interface LocalStorageHasOutput {
  readonly exists: boolean
}

export interface LocalStorageListInput {
  readonly limit: number
  readonly prefix?: string
  readonly cursor?: string
}

export interface LocalStorageListOutput {
  readonly keys: readonly string[]
  readonly nextCursor?: string
}

export interface LocalStorage {
  get(input: LocalStorageGetInput): LocalStorageGetOutput | Promise<LocalStorageGetOutput>
  set(input: LocalStorageSetInput): LocalStorageSetOutput | Promise<LocalStorageSetOutput>
  delete(input: LocalStorageDeleteInput): LocalStorageDeleteOutput | Promise<LocalStorageDeleteOutput>
}

export interface LocalStorageWithPresence extends LocalStorage {
  has(input: LocalStorageHasInput): LocalStorageHasOutput | Promise<LocalStorageHasOutput>
}

export interface LocalStorageWithList extends LocalStorage {
  list(input: LocalStorageListInput): LocalStorageListOutput | Promise<LocalStorageListOutput>
}

export type LocalStorageErrorCode =
  | 'PERMISSION_NOT_GRANTED'
  | 'INVALID_KEY'
  | 'INVALID_CURSOR'
  | 'INVALID_VALUE'
  | 'FEATURE_NOT_NEGOTIATED'
  | 'QUOTA_EXCEEDED'
  | 'STORAGE_UNAVAILABLE'

export const protocol: ProtocolDefinition<
  LocalStorageRequirementSpec | undefined,
  LocalStorageSupportSpec | undefined,
  LocalStorageAgreement
> = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
  validateRequirement: validateRequirementSpec,
  validateSupport: validateSupportSpec,
  negotiate: negotiateProvider,
})

export const support: ProtocolSupport = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
})

export function register(catalog: ProtocolCatalog): () => void {
  return catalog.register(protocol)
}

export function localStorageRequirement(
  features: readonly LocalStorageFeature[] = [],
  optional = false,
): ProtocolRequirement<LocalStorageRequirementSpec> {
  const normalized = validateFeatures(features, 'LocalStorage requirement.spec.features')
  return Object.freeze({
    apiVersion: API_VERSION,
    kind: KIND,
    ...(optional ? { optional: true } : {}),
    ...(normalized.length === 0 ? {} : { spec: Object.freeze({ features: normalized }) }),
  })
}

export function localStorageSupport(spec: LocalStorageSupportSpec): ProtocolSupport<LocalStorageSupportSpec> {
  return Object.freeze({ apiVersion: API_VERSION, kind: KIND, spec: validateSupportSpec(spec) as LocalStorageSupportSpec })
}

export function validateGetInput(value: unknown): asserts value is LocalStorageGetInput {
  const input = exactRecord(value, ['key'], 'LocalStorage.get input')
  key(input.key, 'LocalStorage.get input.key')
}

export function validateSetInput(value: unknown): asserts value is LocalStorageSetInput {
  const input = exactRecord(value, ['key', 'value'], 'LocalStorage.set input')
  key(input.key, 'LocalStorage.set input.key')
  validateJsonValue(input.value, 'LocalStorage.set input.value')
}

export function validateDeleteInput(value: unknown): asserts value is LocalStorageDeleteInput {
  const input = exactRecord(value, ['key'], 'LocalStorage.delete input')
  key(input.key, 'LocalStorage.delete input.key')
}

export function validateGetOutput(value: unknown): asserts value is LocalStorageGetOutput {
  const output = exactRecord(value, ['value'], 'LocalStorage.get output')
  validateJsonValue(output.value, 'LocalStorage.get output.value')
}

export function validateSetOutput(value: unknown): asserts value is LocalStorageSetOutput {
  const output = exactRecord(value, ['stored'], 'LocalStorage.set output')
  if (output.stored !== true) throw new TypeError('LocalStorage.set output.stored must be true')
}

export function validateDeleteOutput(value: unknown): asserts value is LocalStorageDeleteOutput {
  const output = exactRecord(value, ['deleted'], 'LocalStorage.delete output')
  if (typeof output.deleted !== 'boolean') throw new TypeError('LocalStorage.delete output.deleted must be boolean')
}

export function validateHasInput(value: unknown): asserts value is LocalStorageHasInput {
  const input = exactRecord(value, ['key'], 'LocalStorage.has input')
  key(input.key, 'LocalStorage.has input.key')
}

export function validateHasOutput(value: unknown): asserts value is LocalStorageHasOutput {
  const output = exactRecord(value, ['exists'], 'LocalStorage.has output')
  if (typeof output.exists !== 'boolean') throw new TypeError('LocalStorage.has output.exists must be boolean')
}

export function validateListInput(value: unknown): asserts value is LocalStorageListInput {
  const input = exactRecord(value, ['limit', 'prefix', 'cursor'], 'LocalStorage.list input', ['limit'])
  positiveInteger(input.limit, 'LocalStorage.list input.limit')
  if (input.prefix !== undefined && typeof input.prefix !== 'string') {
    throw new TypeError('LocalStorage.list input.prefix must be a string')
  }
  if (input.cursor !== undefined) key(input.cursor, 'LocalStorage.list input.cursor')
}

export function validateListOutput(value: unknown): asserts value is LocalStorageListOutput {
  const output = exactRecord(value, ['keys', 'nextCursor'], 'LocalStorage.list output', ['keys'])
  if (!Array.isArray(output.keys)) throw new TypeError('LocalStorage.list output.keys must be an array')
  const seen = new Set<string>()
  for (const [index, item] of output.keys.entries()) {
    key(item, `LocalStorage.list output.keys[${index}]`)
    if (seen.has(item)) throw new TypeError(`LocalStorage.list output.keys contains duplicate ${JSON.stringify(item)}`)
    seen.add(item)
  }
  if (output.nextCursor !== undefined) key(output.nextCursor, 'LocalStorage.list output.nextCursor')
}

export function validateJsonValue(value: unknown, label = 'JSON value'): asserts value is JsonValue {
  jsonValue(value, label, new Set<object>())
}

function negotiateProvider(input: ProtocolNegotiationInput<LocalStorageRequirementSpec | undefined, LocalStorageSupportSpec | undefined>) {
  const issues: ProtocolIssue[] = []
  const providers = new Map<string, string>()
  const featureBindings = new Map<string, readonly LocalStorageFeature[]>()
  const listPageSizes = new Map<string, number>()
  for (const row of input.requirements) {
    const requested = row.requirement.spec?.features ?? []
    const candidates = input.supports.filter(candidate => candidate.participant !== row.participant
      && requested.every(feature => candidate.support.spec?.features?.includes(feature) === true))
    if (candidates.length === 0) {
      issues.push(Object.freeze({
        code: row.requirement.optional === true ? 'optional-support-missing' : 'required-support-missing',
        severity: row.requirement.optional === true ? 'warning' : 'error',
        participant: row.participant,
        message: `no participant supports ${API_VERSION} ${KIND}`,
      }))
    } else if (candidates.length > 1) {
      issues.push(Object.freeze({
        code: 'support-ambiguous',
        severity: 'error',
        participant: row.participant,
        message: `multiple participants support ${API_VERSION} ${KIND}`,
      }))
    } else {
      const candidate = candidates[0]!
      providers.set(row.participant, candidate.participant)
      if (requested.length > 0) featureBindings.set(row.participant, requested)
      if (requested.includes(LIST_FEATURE)) {
        listPageSizes.set(row.participant, candidate.support.spec!.maxListPageSize as number)
      }
    }
  }
  return {
    agreement: Object.freeze({
      kind: 'LocalStorageBindings',
      providers: Object.freeze(Object.fromEntries([...providers].sort(([left], [right]) => left.localeCompare(right)))),
      ...(featureBindings.size === 0 ? {} : {
        features: Object.freeze(Object.fromEntries([...featureBindings].sort(([left], [right]) => left.localeCompare(right)))),
      }),
      ...(listPageSizes.size === 0 ? {} : {
        maxListPageSizes: Object.freeze(Object.fromEntries([...listPageSizes].sort(([left], [right]) => left.localeCompare(right)))),
      }),
    }),
    issues: Object.freeze(issues),
  }
}

function validateRequirementSpec(value: unknown): LocalStorageRequirementSpec | undefined {
  if (value === undefined) return undefined
  const spec = exactRecord(value, ['features'], 'LocalStorage requirement.spec', [])
  const features = spec.features === undefined ? [] : validateFeatures(spec.features, 'LocalStorage requirement.spec.features')
  return Object.freeze(features.length === 0 ? {} : { features })
}

function validateSupportSpec(value: unknown): LocalStorageSupportSpec | undefined {
  if (value === undefined) return undefined
  const spec = exactRecord(value, ['features', 'maxListPageSize'], 'LocalStorage support.spec', [])
  const features = spec.features === undefined ? [] : validateFeatures(spec.features, 'LocalStorage support.spec.features')
  if (spec.maxListPageSize !== undefined) positiveInteger(spec.maxListPageSize, 'LocalStorage support.spec.maxListPageSize')
  if (features.includes(LIST_FEATURE) && spec.maxListPageSize === undefined) {
    throw new TypeError('LocalStorage support.spec.maxListPageSize is required when list is advertised')
  }
  if (!features.includes(LIST_FEATURE) && spec.maxListPageSize !== undefined) {
    throw new TypeError('LocalStorage support.spec.maxListPageSize requires the list feature')
  }
  return Object.freeze({
    ...(features.length === 0 ? {} : { features }),
    ...(spec.maxListPageSize === undefined ? {} : { maxListPageSize: spec.maxListPageSize as number }),
  })
}

function validateFeatures(value: unknown, label: string): readonly LocalStorageFeature[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const features: LocalStorageFeature[] = []
  for (const [index, feature] of value.entries()) {
    if (feature !== PRESENCE_FEATURE && feature !== LIST_FEATURE) {
      throw new TypeError(`${label}[${index}] is unknown`)
    }
    if (features.includes(feature)) throw new TypeError(`${label} contains duplicate ${JSON.stringify(feature)}`)
    features.push(feature)
  }
  return Object.freeze(features.sort())
}

function jsonValue(value: unknown, label: string, ancestors: Set<object>): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must contain only finite numbers`)
    return
  }
  if (typeof value !== 'object') throw new TypeError(`${label} must be a JSON value`)
  if (ancestors.has(value)) throw new TypeError(`${label} must not contain cycles`)
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) jsonValue(item, `${label}[${index}]`, ancestors)
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must contain only plain objects`)
    for (const [name, item] of Object.entries(value)) jsonValue(item, `${label}.${name}`, ancestors)
  }
  ancestors.delete(value)
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  label: string,
  required: readonly string[] = allowed,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  const record = value as Record<string, unknown>
  const unknown = Object.keys(record).filter(name => !allowed.includes(name))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
  for (const name of required) {
    if (!Object.hasOwn(record, name)) throw new TypeError(`${label}.${name} is required`)
  }
  return record
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError(`${label} must be a positive safe integer`)
}

function key(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
}
