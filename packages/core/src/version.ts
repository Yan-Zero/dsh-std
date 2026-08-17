export interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly (string | number)[]
  readonly build: readonly string[]
}

export type VersionRange = string | readonly string[]

export function parseSemanticVersion(value: string): SemanticVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(value)
  if (match === null) throw new TypeError(`invalid semantic version ${JSON.stringify(value)}`)
  const prerelease = match[4] === undefined ? [] : match[4].split('.').map(identifier => {
    if (!/^\d+$/u.test(identifier)) return identifier
    if (identifier.length > 1 && identifier.startsWith('0')) throw new TypeError(`invalid semantic version ${JSON.stringify(value)}`)
    return Number(identifier)
  })
  return Object.freeze({
    major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
    prerelease: Object.freeze(prerelease),
    build: Object.freeze(match[5] === undefined ? [] : match[5].split('.')),
  })
}

export function compareSemanticVersions(leftValue: string | SemanticVersion, rightValue: string | SemanticVersion): number {
  const left = typeof leftValue === 'string' ? parseSemanticVersion(leftValue) : leftValue
  const right = typeof rightValue === 'string' ? parseSemanticVersion(rightValue) : rightValue
  return left.major - right.major
    || left.minor - right.minor
    || left.patch - right.patch
    || comparePrerelease(left.prerelease, right.prerelease)
}

export function assertVersionRange(range: VersionRange): void {
  compileRange(range)
}

export function satisfiesVersionRange(versionValue: string, range: VersionRange): boolean {
  const version = parseSemanticVersion(versionValue)
  return compileRange(range).some(group => {
    if (version.prerelease.length > 0 && !group.explicitPrereleases.has(coreKey(version))) return false
    return group.predicates.every(predicate => predicate(version))
  })
}

interface ComparatorGroup {
  readonly predicates: readonly ((version: SemanticVersion) => boolean)[]
  readonly explicitPrereleases: ReadonlySet<string>
}

function compileRange(range: VersionRange): readonly ComparatorGroup[] {
  const values = typeof range === 'string' ? [range] : range
  if (!Array.isArray(values) || values.length === 0) throw new TypeError('version range must be a string or non-empty array')
  return Object.freeze(values.flatMap(value => {
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError('version range must not be empty')
    return value.split('||').map(part => compileGroup(part.trim()))
  }))
}

function compileGroup(value: string): ComparatorGroup {
  if (value === '') throw new TypeError('version range contains an empty alternative')
  if (value === '*' || /^x$/iu.test(value)) return { predicates: [], explicitPrereleases: new Set() }
  const predicates: Array<(version: SemanticVersion) => boolean> = []
  const explicitPrereleases = new Set<string>()
  for (const token of value.split(/\s+/u)) {
    const parsed = compileComparator(token)
    predicates.push(...parsed.predicates)
    if (parsed.explicitPrerelease !== undefined) explicitPrereleases.add(parsed.explicitPrerelease)
  }
  return Object.freeze({ predicates: Object.freeze(predicates), explicitPrereleases })
}

function compileComparator(token: string): {
  readonly predicates: readonly ((version: SemanticVersion) => boolean)[]
  readonly explicitPrerelease?: string
} {
  const match = /^(<=|>=|<|>|=|\^|~)?(.+)$/u.exec(token)
  if (match === null) throw new TypeError(`invalid version comparator ${JSON.stringify(token)}`)
  const operator = match[1] ?? '='
  const body = match[2] as string
  const partial = /^(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*]))?(?:\.(0|[1-9]\d*|[xX*]))?$/u.exec(body)
  if (partial !== null && (partial[2] === undefined || partial[3] === undefined || [partial[1], partial[2], partial[3]].some(wild))) {
    if (operator !== '=') {
      if ((operator === '~' || operator === '^') && ![partial[1], partial[2]].some(wild)) {
        const lower = version(Number(partial[1]), Number(partial[2]), partial[3] === undefined || wild(partial[3]) ? 0 : Number(partial[3]))
        return bounded(lower, operator === '~' ? version(lower.major, lower.minor + 1, 0) : caretUpper(lower))
      }
      throw new TypeError(`partial version cannot use ${JSON.stringify(operator)}`)
    }
    return wildcardRange(partial)
  }

  const target = parseSemanticVersion(body)
  const explicitPrerelease = target.prerelease.length === 0 ? undefined : coreKey(target)
  if (operator === '^') return { ...bounded(target, caretUpper(target)), ...(explicitPrerelease === undefined ? {} : { explicitPrerelease }) }
  if (operator === '~') return { ...bounded(target, version(target.major, target.minor + 1, 0)), ...(explicitPrerelease === undefined ? {} : { explicitPrerelease }) }
  const comparison = (candidate: SemanticVersion) => compareSemanticVersions(candidate, target)
  const predicate = operator === '=' ? (candidate: SemanticVersion) => comparison(candidate) === 0
    : operator === '<' ? (candidate: SemanticVersion) => comparison(candidate) < 0
      : operator === '<=' ? (candidate: SemanticVersion) => comparison(candidate) <= 0
        : operator === '>' ? (candidate: SemanticVersion) => comparison(candidate) > 0
          : (candidate: SemanticVersion) => comparison(candidate) >= 0
  return { predicates: [predicate], ...(explicitPrerelease === undefined ? {} : { explicitPrerelease }) }
}

function wildcardRange(match: RegExpExecArray): { readonly predicates: readonly ((version: SemanticVersion) => boolean)[] } {
  if (wild(match[1])) return { predicates: [] }
  const major = Number(match[1])
  if (match[2] === undefined || wild(match[2])) return bounded(version(major, 0, 0), version(major + 1, 0, 0))
  const minor = Number(match[2])
  if (match[3] === undefined || wild(match[3])) return bounded(version(major, minor, 0), version(major, minor + 1, 0))
  throw new TypeError('unreachable complete version range')
}

function bounded(lower: SemanticVersion, upper: SemanticVersion): { readonly predicates: readonly ((version: SemanticVersion) => boolean)[] } {
  return { predicates: [
    candidate => compareSemanticVersions(candidate, lower) >= 0,
    candidate => compareSemanticVersions(candidate, upper) < 0,
  ] }
}

function caretUpper(lower: SemanticVersion): SemanticVersion {
  if (lower.major > 0) return version(lower.major + 1, 0, 0)
  if (lower.minor > 0) return version(0, lower.minor + 1, 0)
  return version(0, 0, lower.patch + 1)
}

function version(major: number, minor: number, patch: number): SemanticVersion {
  return { major, minor, patch, prerelease: [], build: [] }
}

function wild(value: string | undefined): boolean {
  return value === '*' || /^x$/iu.test(value ?? '')
}

function coreKey(value: SemanticVersion): string {
  return `${value.major}.${value.minor}.${value.patch}`
}

function comparePrerelease(left: readonly (string | number)[], right: readonly (string | number)[]): number {
  if (left.length === 0) return right.length === 0 ? 0 : 1
  if (right.length === 0) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    if (typeof leftPart === 'number' && typeof rightPart === 'string') return -1
    if (typeof leftPart === 'string' && typeof rightPart === 'number') return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}
