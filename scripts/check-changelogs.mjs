import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packagesRoot = fileURLToPath(new URL('../packages/', import.meta.url))
const errors = []

for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = join(packagesRoot, entry.name)
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
      if (dependency.startsWith('@dsh-std/') && range !== 'workspace:^') {
        errors.push(`${manifest.name}: ${field}.${dependency} must use workspace:^, found ${range}`)
      }
    }
  }
  const changelogPath = join(directory, 'CHANGELOG.md')
  if (!existsSync(changelogPath)) {
    errors.push(`${manifest.name}: CHANGELOG.md is missing`)
    continue
  }
  if (!Array.isArray(manifest.files) || !manifest.files.includes('CHANGELOG.md')) {
    errors.push(`${manifest.name}: package files do not include CHANGELOG.md`)
  }
  const changelog = readFileSync(changelogPath, 'utf8')
  if (!changelog.includes(`## ${manifest.version}`)) {
    errors.push(`${manifest.name}: CHANGELOG.md has no entry for ${manifest.version}`)
  }
}

if (errors.length > 0) {
  throw new Error(`package metadata validation failed:\n${errors.join('\n')}`)
}
