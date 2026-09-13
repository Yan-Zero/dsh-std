import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

export function parseVersion(value) {
  const match = SEMVER.exec(value)
  if (match === null) throw new TypeError(`invalid semantic version ${JSON.stringify(value)}`)
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => /^0\d+$/u.test(identifier))) {
    throw new TypeError(`invalid semantic version ${JSON.stringify(value)}`)
  }
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease,
  }
}

export function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] < right[key]) return -1
    if (left[key] > right[key]) return 1
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1
    if (a === b) continue
    const aNumeric = /^\d+$/u.test(a)
    const bNumeric = /^\d+$/u.test(b)
    if (aNumeric && bNumeric) return BigInt(a) < BigInt(b) ? -1 : 1
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a < b ? -1 : 1
  }
  return 0
}

export function releaseMetadata(name, version) {
  const parsed = parseVersion(version)
  const prerelease = parsed.prerelease.length > 0
  const first = parsed.prerelease[0]
  const distTag = prerelease ? first?.match(/^[A-Za-z]+/u)?.[0]?.toLowerCase() ?? 'next' : 'latest'
  return Object.freeze({
    name,
    version,
    tag: `${name}@${version}`,
    prerelease,
    distTag,
  })
}

export function sortPackages(packages) {
  const byName = new Map(packages.map(row => [row.name, row]))
  const output = []
  const state = new Map()
  const visit = (row) => {
    const current = state.get(row.name)
    if (current === 'done') return
    if (current === 'visiting') throw new Error(`workspace release dependency cycle contains ${row.name}`)
    state.set(row.name, 'visiting')
    const dependencies = {
      ...row.manifest.dependencies,
      ...row.manifest.optionalDependencies,
    }
    for (const name of Object.keys(dependencies).sort()) {
      const dependency = byName.get(name)
      if (dependency !== undefined) visit(dependency)
    }
    state.set(row.name, 'done')
    output.push(row)
  }
  for (const row of [...packages].sort((left, right) => left.name.localeCompare(right.name))) visit(row)
  return output
}

export function selectChangedPackages(packages, previousVersion) {
  const releases = []
  for (const row of sortPackages(packages)) {
    const previous = previousVersion(row)
    if (previous === row.version) continue
    if (previous !== undefined && compareVersions(row.version, previous) <= 0) {
      throw new Error(`${row.name} version changed from ${previous} to ${row.version}; releases must increase`)
    }
    releases.push(Object.freeze({
      directory: row.directory,
      manifestPath: row.manifestPath,
      previousVersion: previous,
      ...releaseMetadata(row.name, row.version),
    }))
  }
  return Object.freeze(releases)
}

export function readWorkspacePackages(root) {
  const packagesRoot = join(root, 'packages')
  const rows = []
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = join(packagesRoot, entry.name, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.private === true) continue
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new TypeError(`${manifestPath} has no package name`)
    }
    parseVersion(manifest.version)
    rows.push(Object.freeze({
      name: manifest.name,
      version: manifest.version,
      directory: relative(root, dirname(manifestPath)).split(sep).join('/'),
      manifestPath: relative(root, manifestPath).split(sep).join('/'),
      manifest,
    }))
  }
  return Object.freeze(rows)
}

export function createReleasePlan(root, before) {
  if (!/^[0-9a-f]{40}$/iu.test(before) || /^0+$/u.test(before)) {
    throw new TypeError('before must be a non-zero 40-character Git object id')
  }
  execFileSync('git', ['cat-file', '-e', `${before}^{commit}`], { cwd: root, stdio: 'ignore' })
  const previousVersion = (row) => {
    try {
      const source = execFileSync('git', ['show', `${before}:${row.manifestPath}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const manifest = JSON.parse(source)
      if (typeof manifest.version !== 'string') throw new TypeError(`${row.manifestPath} had no version at ${before}`)
      parseVersion(manifest.version)
      return manifest.version
    } catch (error) {
      if (error?.status === 128) return undefined
      throw error
    }
  }
  return selectChangedPackages(readWorkspacePackages(root), previousVersion)
}

function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name !== '--before' && name !== '--output') throw new TypeError(`unknown argument ${JSON.stringify(name)}`)
    const value = argv[index + 1]
    if (value === undefined) throw new TypeError(`${name} requires a value`)
    result[name.slice(2)] = value
    index += 1
  }
  if (result.before === undefined || result.output === undefined) {
    throw new TypeError('usage: node scripts/release-plan.mjs --before <commit> --output <file>')
  }
  return result
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArguments(process.argv.slice(2))
  const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
  const plan = createReleasePlan(root, options.before)
  writeFileSync(options.output, `${JSON.stringify(plan, null, 2)}\n`)
  for (const row of plan) {
    process.stdout.write(`${row.name}: ${row.previousVersion ?? '(new)'} -> ${row.version} (${row.distTag})\n`)
  }
  if (plan.length === 0) process.stdout.write('No package version increases detected.\n')
}
