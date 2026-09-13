import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  releaseMetadata,
  selectChangedPackages,
  sortPackages,
} from './release-plan.mjs'

function pkg(name, version, dependencies = {}) {
  return {
    name,
    version,
    directory: `packages/${name}`,
    manifestPath: `packages/${name}/package.json`,
    manifest: { name, version, dependencies },
  }
}

describe('release plan', () => {
  it('compares stable and prerelease SemVer identifiers', () => {
    expect(compareVersions('0.1.1-rc.2', '0.1.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('0.1.1', '0.1.1-rc.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.2-alpha.1', '0.1.1-rc.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.1-rc.1', '0.1.1-rc.1')).toBe(0)
    expect(() => compareVersions('0.1.1-rc.01', '0.1.1-rc.1')).toThrow(/invalid semantic version/u)
  })

  it('derives package tags and npm dist-tags from package versions', () => {
    expect(releaseMetadata('@dsh-std/core', '0.1.1-rc.2')).toEqual({
      name: '@dsh-std/core', version: '0.1.1-rc.2',
      tag: '@dsh-std/core@0.1.1-rc.2', prerelease: true, distTag: 'rc',
    })
    expect(releaseMetadata('@dsh-std/core', '0.1.1').distTag).toBe('latest')
  })

  it('orders workspace dependencies before their dependents', () => {
    const skill = pkg('@dsh-std/skill', '0.1.1-rc.1')
    const adapter = pkg('@dsh-std/adapter-dsh', '0.1.1-rc.3', { '@dsh-std/skill': 'workspace:^' })
    expect(sortPackages([adapter, skill]).map(row => row.name)).toEqual([
      '@dsh-std/skill', '@dsh-std/adapter-dsh',
    ])
  })

  it('selects only increases and rejects reused or decreasing versions', () => {
    const core = pkg('@dsh-std/core', '0.1.1-rc.2')
    const stable = pkg('@dsh-std/stable', '0.1.1')
    expect(selectChangedPackages([stable, core], row => row.name === core.name ? '0.1.1-rc.1' : row.version))
      .toEqual([expect.objectContaining({ name: core.name, previousVersion: '0.1.1-rc.1' })])
    expect(() => selectChangedPackages([core], () => '0.1.1-rc.3')).toThrow(/must increase/u)
  })
})
