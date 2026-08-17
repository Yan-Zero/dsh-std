import { describe, expect, it } from 'vitest'
import { eventExtensionDefinition } from '../src/index.js'

describe('@dsh-std/session', () => {
  it('validates durable event declarations', () => {
    expect(() => eventExtensionDefinition.validateSpec({
      description: 'Resolved provider request.',
      replay: 'required',
      payloadSchema: { type: 'object' },
    })).not.toThrow()
    expect(() => eventExtensionDefinition.validateSpec({ description: 'Diagnostic.', replay: 'ignorable' })).not.toThrow()
  })

  it('requires an explicit replay rule', () => {
    expect(() => eventExtensionDefinition.validateSpec({ description: 'Ambiguous.' })).toThrow(/replay/)
    expect(() => eventExtensionDefinition.validateSpec({ description: 'Ambiguous.', replay: 'optional' })).toThrow(/replay/)
  })
})
