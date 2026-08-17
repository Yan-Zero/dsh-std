import type {
  ProtocolCatalog,
  ProtocolDefinition,
  ProtocolIssue,
  ProtocolSupport,
} from '@dsh-std/core'

export const API_VERSION = 'storage.dsh/v1alpha1'
export const KIND = 'LocalStorage'

export const READ_PERMISSION = 'storage.local.read'
export const WRITE_PERMISSION = 'storage.local.write'

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

export interface LocalStorage {
  get(input: LocalStorageGetInput): LocalStorageGetOutput | Promise<LocalStorageGetOutput>
  set(input: LocalStorageSetInput): LocalStorageSetOutput | Promise<LocalStorageSetOutput>
  delete(input: LocalStorageDeleteInput): LocalStorageDeleteOutput | Promise<LocalStorageDeleteOutput>
}

export type LocalStorageErrorCode =
  | 'PERMISSION_NOT_GRANTED'
  | 'INVALID_KEY'
  | 'INVALID_VALUE'
  | 'QUOTA_EXCEEDED'
  | 'STORAGE_UNAVAILABLE'

export const protocol: ProtocolDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
  validateRequirement: emptySpec,
  validateSupport: emptySpec,
  negotiate: negotiateProvider,
})

export const support: ProtocolSupport = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
})

export function register(catalog: ProtocolCatalog): () => void {
  return catalog.register(protocol)
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

export function validateJsonValue(value: unknown, label = 'JSON value'): asserts value is JsonValue {
  jsonValue(value, label, new Set<object>())
}

function negotiateProvider(input: Parameters<NonNullable<ProtocolDefinition['negotiate']>>[0]) {
  const issues: ProtocolIssue[] = []
  const providers = new Map<string, string>()
  for (const row of input.requirements) {
    const candidates = input.supports.filter(candidate => candidate.participant !== row.participant)
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
      providers.set(row.participant, candidates[0]!.participant)
    }
  }
  return {
    agreement: Object.freeze({
      kind: 'LocalStorageBindings',
      providers: Object.freeze(Object.fromEntries([...providers].sort(([left], [right]) => left.localeCompare(right)))),
    }),
    issues: Object.freeze(issues),
  }
}

function emptySpec(value: unknown): undefined {
  if (value !== undefined) throw new TypeError(`${KIND} does not accept spec in v1alpha1`)
  return undefined
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

function exactRecord(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  const record = value as Record<string, unknown>
  const unknown = Object.keys(record).filter(name => !allowed.includes(name))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
  for (const name of allowed) {
    if (!Object.hasOwn(record, name)) throw new TypeError(`${label}.${name} is required`)
  }
  return record
}

function key(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
}
