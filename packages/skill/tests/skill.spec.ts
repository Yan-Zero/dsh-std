import { describe, expect, it } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import {
  API_VERSION,
  KIND,
  assertSkillPublication,
  extensionDefinition,
  register,
  resolveSkillInvocation,
  resourceSupport,
  validateSkillSpec,
} from '../src/index.js'

describe('@dsh-std/skill', () => {
  it('validates a portable lazy Skill resource', () => {
    expect(validateSkillSpec({
      description: 'Use bounded divergent cognition.',
      entry: 'skills/let-me-lsd/SKILL.md',
      invocation: { model: true, user: false },
    })).toEqual({
      description: 'Use bounded divergent cognition.',
      entry: 'skills/let-me-lsd/SKILL.md',
      invocation: { model: true, user: false },
    })
    expect(() => extensionDefinition.validateMetadata({ name: 'let-me-lsd' })).not.toThrow()
    expect(API_VERSION).toBe('skills.dsh/v1alpha1')
    expect(KIND).toBe('Skill')
  })

  it('rejects ambiguous or escaping entry paths and invisible skills', () => {
    for (const entry of ['../SKILL.md', 'skills/../SKILL.md', '/SKILL.md', 'skills\\SKILL.md', 'skills//SKILL.md']) {
      expect(() => validateSkillSpec({ description: 'Example', entry })).toThrow(/entry/u)
    }
    expect(() => validateSkillSpec({
      description: 'Example', entry: 'SKILL.md', invocation: { model: false, user: false },
    })).toThrow(/enable model or user/u)
  })

  it('defaults both invocation audiences without mutating the resource', () => {
    const spec = { description: 'Example', entry: 'SKILL.md' }
    expect(resolveSkillInvocation()).toEqual({ model: true, user: true })
    expect(spec).toEqual({ description: 'Example', entry: 'SKILL.md' })
  })

  it('uses an inert null publication marker instead of an executable handler', () => {
    expect(() => assertSkillPublication(null)).not.toThrow()
    expect(() => assertSkillPublication({})).toThrow(/must be null/u)
  })

  it('negotiates resource publication support', () => {
    const catalog = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
    register(catalog)
    const report = catalog.negotiate([
      defineProtocolDeclaration({
        participant: { id: 'component/skills' },
        requires: [{ apiVersion: API_VERSION, kind: KIND }],
      }),
      defineProtocolDeclaration({ participant: { id: 'host/runtime' }, supports: [resourceSupport] }),
    ])
    expect(report.compatible).toBe(true)
    expect(report.protocols[0]?.agreement).toEqual({ kind: 'ResourcePublication' })
  })
})
