import { describe, expect, it } from 'vitest'
import { compareSemanticVersions, parseSemanticVersion, satisfiesVersionRange } from '../src/index.js'

describe('portable semantic version ranges', () => {
  it('orders releases and prereleases according to SemVer precedence', () => {
    expect(compareSemanticVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(0)
    expect(compareSemanticVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareSemanticVersions('1.0.0+build.1', '1.0.0+build.2')).toBe(0)
    expect(parseSemanticVersion('2.3.4').major).toBe(2)
  })

  it('supports exact, wildcard, comparator, caret, tilde, and OR ranges', () => {
    expect(satisfiesVersionRange('1.4.2', '1.x')).toBe(true)
    expect(satisfiesVersionRange('1.4.2', '>=1.2.0 <2.0.0')).toBe(true)
    expect(satisfiesVersionRange('1.9.0', '^1.2.3')).toBe(true)
    expect(satisfiesVersionRange('2.0.0', '^1.2.3')).toBe(false)
    expect(satisfiesVersionRange('0.2.9', '^0.2.3')).toBe(true)
    expect(satisfiesVersionRange('0.3.0', '^0.2.3')).toBe(false)
    expect(satisfiesVersionRange('1.2.9', '~1.2.3')).toBe(true)
    expect(satisfiesVersionRange('1.3.0', '~1.2.3')).toBe(false)
    expect(satisfiesVersionRange('3.0.0', ['1.x', '3.x'])).toBe(true)
  })

  it('does not accidentally admit prereleases into a release range', () => {
    expect(satisfiesVersionRange('2.0.0-beta.1', '>=1.0.0 <3.0.0')).toBe(false)
    expect(satisfiesVersionRange('2.0.0-beta.2', '>=2.0.0-beta.1 <2.0.0')).toBe(true)
    expect(() => satisfiesVersionRange('1.0.0', '>=1.x')).toThrow(/partial version/)
  })
})
