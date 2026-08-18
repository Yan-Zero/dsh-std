import { describe, expect, it } from 'vitest'
import { CompositionRuleCatalog } from '@dsh-std/composition'
import { defineComponentManifest } from '@dsh-std/manifest'
import {
  assertExecutableToolDefinition,
  assertToolHandler,
  assertToolOverrideHandler,
  extensionDefinition,
  overrideCompositionRule,
  overrideExtensionDefinition,
  validateToolStatus,
} from '../src/index.js'

describe('@dsh-std/tool', () => {
  it('separates a static discoverable catalog entry from Runtime-resolved schema', () => {
    expect(() => extensionDefinition.validateSpec({ title: 'Search tools', description: 'Search the active tool catalog.' })).not.toThrow()
    expect(() => validateToolStatus({
      state: 'available',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    })).not.toThrow()
    expect(() => validateToolStatus({ state: 'available' })).not.toThrow()
  })

  it('rejects invalid availability state without requiring eager disclosure', () => {
    expect(() => validateToolStatus({ state: 'missing' })).toThrow(/state is invalid/)
    expect(() => validateToolStatus({ state: 'available', reason: 'not loaded' })).toThrow(/cannot contain reason/)
  })

  it('defines explicit runtime handlers for tool overrides', () => {
    expect(() => overrideExtensionDefinition.validateSpec({
      target: 'read_image',
      providers: ['openai-codex'],
      description: 'Accept remote image sources.',
    })).not.toThrow()
    expect(() => overrideExtensionDefinition.validateSpec({
      target: 'read_image', providers: ['openai-codex', 'openai-codex'], description: 'Duplicate.',
    })).toThrow(/duplicates/u)
    expect(() => assertToolOverrideHandler({ resolve: (original: unknown) => original })).not.toThrow()
    expect(() => assertToolOverrideHandler({})).toThrow(/resolve/)
  })

  it('validates portable executable Tool handlers and definitions', () => {
    const definition = {
      name: 'imagegen', description: 'Generate an image.',
      parameters: { type: 'object' }, output: { type: 'object' },
      execute: async () => ({ data: {}, content: [] }),
    }
    expect(() => assertExecutableToolDefinition(definition)).not.toThrow()
    expect(() => assertToolHandler({ resolve: () => definition })).not.toThrow()
    expect(() => assertToolHandler({})).toThrow(/resolve/u)
  })

  it('rejects multiple override owners for the same target', () => {
    const extension = (name: string) => defineComponentManifest({
      apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
      metadata: { name: `example.${name}`, version: '1.0.0' },
      spec: { facets: [{ name: 'runtime', extensions: [{
        apiVersion: 'tools.dsh/v1alpha1', kind: 'ToolOverride',
        metadata: { name }, spec: { target: 'read_image', description: name },
      }] }] },
    }).spec.facets[0]!.extensions![0]!
    const rules = new CompositionRuleCatalog()
    rules.register(overrideCompositionRule)
    const issues = overrideCompositionRule.composeExtensions?.({ extensions: [
      { owner: { component: 'one', version: '1.0.0', facet: 'runtime' }, extension: extension('one') },
      { owner: { component: 'two', version: '1.0.0', facet: 'runtime' }, extension: extension('two') },
    ] })
    expect(issues).toEqual([expect.objectContaining({ code: 'extension-conflict', severity: 'error' })])
  })
})
