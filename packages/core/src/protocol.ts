/** Domain-neutral protocol identities and live participant declarations. */

export interface ApiReference {
  readonly apiVersion: string
  readonly kind: string
}

export type ProtocolJsonPrimitive = null | boolean | number | string
export type ProtocolJsonValue =
  | ProtocolJsonPrimitive
  | readonly ProtocolJsonValue[]
  | { readonly [key: string]: ProtocolJsonValue }

/** Validate data that may cross a manifest, agreement, or protocol wire boundary. */
export function validateProtocolJsonValue(value: unknown, label = 'protocol JSON value'): asserts value is ProtocolJsonValue {
  jsonValue(value, label, new Set<object>())
}

/** Snapshot and deeply freeze lossless JSON data before publication or async work. */
export function freezeProtocolJsonValue(value: unknown, label = 'protocol JSON value'): ProtocolJsonValue {
  validateProtocolJsonValue(value, label)
  return deepFreeze(structuredClone(value)) as ProtocolJsonValue
}

export interface ParticipantIdentity {
  /** Unique within the negotiation scope that carries this declaration. */
  readonly id: string
}

export interface ProtocolRequirement<Spec = unknown> extends ApiReference {
  readonly optional?: boolean
  readonly spec?: Spec
}

export interface ProtocolSupport<Spec = unknown> extends ApiReference {
  readonly spec?: Spec
}

export interface ProtocolDeclaration {
  readonly participant: ParticipantIdentity
  readonly requires?: readonly ProtocolRequirement[]
  readonly supports?: readonly ProtocolSupport[]
}

export interface ParsedApiVersion {
  readonly group: string
  readonly major: number
  readonly stability: 'alpha' | 'beta' | 'stable'
  readonly revision: number
}

export function protocolKey(reference: ApiReference): string {
  return `${reference.apiVersion}\0${reference.kind}`
}

/** A grouping key only. It does not claim that versions in the family interoperate. */
export function protocolFamilyKey(reference: ApiReference): string {
  const version = parseApiVersion(reference.apiVersion)
  return `${version.group}/v${version.major}\0${reference.kind}`
}

export function sameProtocol(left: ApiReference, right: ApiReference): boolean {
  return left.apiVersion === right.apiVersion && left.kind === right.kind
}

export function parseApiVersion(value: string): ParsedApiVersion {
  const match = /^([a-z][a-z0-9.-]*)\/v([1-9][0-9]*)(?:(alpha|beta)([1-9][0-9]*))?$/u.exec(value)
  if (match === null) throw new TypeError(`invalid apiVersion ${JSON.stringify(value)}`)
  return Object.freeze({
    group: match[1] as string,
    major: Number(match[2]),
    stability: (match[3] ?? 'stable') as ParsedApiVersion['stability'],
    revision: match[4] === undefined ? 0 : Number(match[4]),
  })
}

export function validateApiReference(value: unknown, label = 'protocol reference'): asserts value is ApiReference {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  if (typeof value.apiVersion !== 'string') throw new TypeError(`${label}.apiVersion must be a string`)
  parseApiVersion(value.apiVersion)
  if (typeof value.kind !== 'string' || !/^[A-Z][A-Za-z0-9]*$/u.test(value.kind)) {
    throw new TypeError(`${label}.kind is invalid`)
  }
}

export function validateProtocolDeclaration(value: unknown): asserts value is ProtocolDeclaration {
  if (!record(value)) throw new TypeError('protocol declaration must be an object')
  exact(value, ['participant', 'requires', 'supports'], 'protocol declaration')
  if (!record(value.participant)) throw new TypeError('protocol declaration participant must be an object')
  exact(value.participant, ['id'], 'participant identity')
  nonEmpty(value.participant.id, 'participant identity.id')
  validateRows(value.requires, true)
  validateRows(value.supports, false)
}

export function defineProtocolDeclaration<const T extends ProtocolDeclaration>(declaration: T): T {
  validateProtocolDeclaration(declaration)
  return deepFreeze(structuredClone(declaration))
}

function validateRows(value: unknown, requirement: boolean): void {
  if (value === undefined) return
  const label = requirement ? 'protocol requirements' : 'protocol supports'
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const seen = new Set<string>()
  for (const [index, rowValue] of value.entries()) {
    const rowLabel = `${label}[${index}]`
    validateApiReference(rowValue, rowLabel)
    const row = rowValue as unknown as Record<string, unknown>
    exact(row, requirement ? ['apiVersion', 'kind', 'optional', 'spec'] : ['apiVersion', 'kind', 'spec'], rowLabel)
    if (requirement && row.optional !== undefined && typeof row.optional !== 'boolean') {
      throw new TypeError(`${rowLabel}.optional must be boolean`)
    }
    // Explicit undefined was accepted by the original v1alpha1 TypeScript API
    // and remains equivalent to omission. Every material spec is wire data.
    if (Object.hasOwn(row, 'spec') && row.spec !== undefined) {
      validateProtocolJsonValue(row.spec, `${rowLabel}.spec`)
    }
    const key = protocolKey(row as unknown as ApiReference)
    if (seen.has(key)) throw new TypeError(`${label} contains duplicate ${JSON.stringify(key)}`)
    seen.add(key)
  }
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key) && !key.startsWith('x-'))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

function jsonValue(value: unknown, label: string, ancestors: Set<object>): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${label} must contain only lossless JSON numbers`)
    return
  }
  if (typeof value !== 'object') throw new TypeError(`${label} must be lossless JSON data`)
  if (ancestors.has(value)) throw new TypeError(`${label} must not contain cycles`)
  ancestors.add(value)
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${label} must be a dense JSON array without extra properties`)
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`${label} must not contain sparse array slots`)
    }
    for (const [index, child] of value.entries()) jsonValue(child, `${label}[${index}]`, ancestors)
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must contain only plain objects`)
    }
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key))) {
      throw new TypeError(`${label} must contain only enumerable string keys`)
    }
    for (const [key, child] of Object.entries(value)) jsonValue(child, `${label}.${key}`, ancestors)
  }
  ancestors.delete(value)
}
