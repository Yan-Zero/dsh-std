import { describe, expect, it } from 'vitest'
import { ProtocolCatalog, defineProtocolDeclaration } from '@dsh-std/core'
import {
  API_VERSION,
  KIND,
  parseMessageEvent,
  protocol,
  support,
  validateMessageEvent,
} from '../src/index.js'

const event = {
  eventType: 'messages.observe',
  eventVersion: '0.15',
  eventId: 'evt-1',
  scope: 'session:demo',
  sequence: 0,
  privacyClass: 'internal',
  summary: 'A message was received',
  payload: {
    kind: 'message.received',
    messageId: 'msg-1',
    content: [
      { type: 'text', text: 'hello' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ],
  },
}

describe('@dsh-std/messages', () => {
  it('publishes the Community v0.15 MessageObserver coordinates', () => {
    expect(protocol).toMatchObject({ apiVersion: API_VERSION, kind: KIND })
    expect(support).toEqual({ apiVersion: 'messages.dsh/v1alpha1', kind: 'MessageObserver' })
  })

  it('negotiates an observer with one publisher', () => {
    const catalog = new ProtocolCatalog({ name: 'test', version: '1.0.0' })
    catalog.register(protocol)
    const observer = defineProtocolDeclaration({
      participant: { id: 'example.plugin' },
      requires: [{ apiVersion: API_VERSION, kind: KIND }],
    })
    const publisher = defineProtocolDeclaration({ participant: { id: 'example.host' }, supports: [support] })
    expect(catalog.negotiate([observer])).toMatchObject({ compatible: false })
    expect(catalog.negotiate([observer, publisher])).toMatchObject({ compatible: true })
  })

  it('validates and freezes the MCP ContentBlock-aligned text/image subset', () => {
    expect(() => validateMessageEvent(event)).not.toThrow()
    const parsed = parseMessageEvent(event)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.payload.content)).toBe(true)
    expect(() => validateMessageEvent({
      ...event,
      payload: { ...event.payload, content: [{ type: 'text' }] },
    })).toThrow(/text/u)
    expect(() => validateMessageEvent({
      ...event,
      payload: { ...event.payload, content: [{ type: 'audio', data: 'AAAA', mimeType: 'audio/wav' }] },
    })).toThrow(/text.*image/u)
    expect(() => validateMessageEvent({
      ...event,
      payload: { ...event.payload, content: [{ type: 'image', data: 'not base64', mimeType: 'image/png' }] },
    })).toThrow(/base64/u)
    expect(() => validateMessageEvent({ ...event, privacyClass: 'secret' })).toThrow(/privacyClass/u)
  })
})
