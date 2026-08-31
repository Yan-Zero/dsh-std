export function exactRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`)
  const unknown = Object.keys(value).filter(key => !allowed.includes(key) && !key.startsWith('x-'))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
  return value
}

export function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

export function nonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative safe integer`)
}

export function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError(`${label} must be a positive safe integer`)
}

export function optionalNonNegativeInteger(value: unknown, label: string): void {
  if (value !== undefined) nonNegativeInteger(value, label)
}

export function optionalPositiveInteger(value: unknown, label: string): void {
  if (value !== undefined) positiveInteger(value, label)
}

export function stringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array`)
  for (const row of value) nonEmpty(row, label)
  if (new Set(value).size !== value.length) throw new TypeError(`${label} contains duplicates`)
  return Object.freeze([...value] as string[])
}

export function freezeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

export function empty(value: unknown, label: string): void {
  exactRecord(value, [], [], label)
}

export function requiredHandler<T extends Function>(value: T | undefined, owner: string, operation: string): T {
  if (value === undefined) throw new TypeError(`${owner} handler.${operation} is missing`)
  return value
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}
