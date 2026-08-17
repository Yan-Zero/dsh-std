import type {
  ProtocolCatalog,
  ProtocolDefinition,
  ProtocolIssue,
  ProtocolSupport,
} from '@dsh-std/core'

export const API_VERSION = 'messages.dsh/v1alpha1'
export const KIND = 'MessageObserver'
export const READ_PERMISSION = 'messages.observe.read'
export const EVENT_TYPE = 'messages.observe'
export const EVENT_VERSION = '0.15'

export type PrivacyClass = 'public' | 'internal' | 'sensitive'
export type MessageEventKind = 'message.created' | 'message.received' | 'message.sent'

export interface TextContentBlock {
  readonly type: 'text'
  readonly text: string
}

export interface ImageContentBlock {
  readonly type: 'image'
  readonly data: string
  readonly mimeType: string
}

export type MessageContentBlock = TextContentBlock | ImageContentBlock

export interface MessagePayload {
  readonly kind: MessageEventKind
  readonly messageId?: string
  readonly author?: string
  readonly content: readonly MessageContentBlock[]
  readonly truncated?: boolean
}

export interface MessageEvent {
  readonly eventType: typeof EVENT_TYPE
  readonly eventVersion: typeof EVENT_VERSION
  readonly eventId: string
  readonly scope: string
  readonly sequence: number
  readonly privacyClass: PrivacyClass
  readonly summary: string
  readonly payload: MessagePayload
}

export interface MessageSubscription {
  readonly scope?: string
}

export type MessageObserverErrorCode =
  | 'PERMISSION_NOT_GRANTED'
  | 'UNKNOWN_PRIVACY_CLASS'
  | 'INVALID_EVENT_ENVELOPE'
  | 'SUBSCRIPTION_CLOSED'

export const protocol: ProtocolDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
  validateRequirement: emptySpec,
  validateSupport: emptySpec,
  negotiate: negotiatePublisher,
})

export const support: ProtocolSupport = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
})

export function register(catalog: ProtocolCatalog): () => void {
  return catalog.register(protocol)
}

export function validateSubscription(value: unknown): asserts value is MessageSubscription {
  const subscription = exactRecord(value, ['scope'], [], 'MessageObserver subscription')
  if (subscription.scope !== undefined) boundedText(subscription.scope, 256, 'MessageObserver subscription.scope', false)
}

export function validateMessageEvent(value: unknown): asserts value is MessageEvent {
  const envelope = exactRecord(
    value,
    ['eventType', 'eventVersion', 'eventId', 'scope', 'sequence', 'privacyClass', 'summary', 'payload'],
    ['eventType', 'eventVersion', 'eventId', 'scope', 'sequence', 'privacyClass', 'summary', 'payload'],
    'MessageObserver event',
  )
  if (envelope.eventType !== EVENT_TYPE) throw new TypeError(`MessageObserver event.eventType must be ${JSON.stringify(EVENT_TYPE)}`)
  if (envelope.eventVersion !== EVENT_VERSION) throw new TypeError(`MessageObserver event.eventVersion must be ${JSON.stringify(EVENT_VERSION)}`)
  if (typeof envelope.eventId !== 'string' || !/^[A-Za-z0-9._:-]+$/u.test(envelope.eventId)) {
    throw new TypeError('MessageObserver event.eventId is invalid')
  }
  boundedText(envelope.scope, 256, 'MessageObserver event.scope', false)
  if (!Number.isSafeInteger(envelope.sequence) || (envelope.sequence as number) < 0) {
    throw new TypeError('MessageObserver event.sequence must be a non-negative safe integer')
  }
  if (envelope.privacyClass !== 'public' && envelope.privacyClass !== 'internal' && envelope.privacyClass !== 'sensitive') {
    throw new TypeError('MessageObserver event.privacyClass is invalid')
  }
  boundedText(envelope.summary, 1024, 'MessageObserver event.summary', true)
  validatePayload(envelope.payload)
}

export function parseMessageEvent(value: unknown): MessageEvent {
  validateMessageEvent(value)
  return deepFreeze(structuredClone(value))
}

export function validateContentBlock(value: unknown): asserts value is MessageContentBlock {
  if (!record(value)) throw new TypeError('MessageObserver content block must be an object')
  if (value.type === 'text') {
    const block = exactRecord(value, ['type', 'text'], ['type', 'text'], 'MessageObserver text block')
    if (typeof block.text !== 'string' || block.text.length > 262_144) {
      throw new TypeError('MessageObserver text block.text must be a string of at most 262144 characters')
    }
    return
  }
  if (value.type === 'image') {
    const block = exactRecord(value, ['type', 'data', 'mimeType'], ['type', 'data', 'mimeType'], 'MessageObserver image block')
    if (typeof block.data !== 'string' || !base64(block.data)) {
      throw new TypeError('MessageObserver image block.data must be a base64 string')
    }
    if (typeof block.mimeType !== 'string' || !/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/u.test(block.mimeType)) {
      throw new TypeError('MessageObserver image block.mimeType is invalid')
    }
    return
  }
  throw new TypeError('MessageObserver content block.type must be "text" or "image"')
}

function validatePayload(value: unknown): asserts value is MessagePayload {
  const payload = exactRecord(
    value,
    ['kind', 'messageId', 'author', 'content', 'truncated'],
    ['kind', 'content'],
    'MessageObserver event.payload',
  )
  if (payload.kind !== 'message.created' && payload.kind !== 'message.received' && payload.kind !== 'message.sent') {
    throw new TypeError('MessageObserver event.payload.kind is invalid')
  }
  if (payload.messageId !== undefined) boundedText(payload.messageId, 256, 'MessageObserver event.payload.messageId', true)
  if (payload.author !== undefined) boundedText(payload.author, 256, 'MessageObserver event.payload.author', true)
  if (!Array.isArray(payload.content) || payload.content.length === 0) {
    throw new TypeError('MessageObserver event.payload.content must be a non-empty array')
  }
  for (const block of payload.content) validateContentBlock(block)
  if (payload.truncated !== undefined && typeof payload.truncated !== 'boolean') {
    throw new TypeError('MessageObserver event.payload.truncated must be boolean')
  }
}

function negotiatePublisher(input: Parameters<NonNullable<ProtocolDefinition['negotiate']>>[0]) {
  const issues: ProtocolIssue[] = []
  const publishers = new Map<string, string>()
  for (const row of input.requirements) {
    const candidates = input.supports.filter(candidate => candidate.participant !== row.participant)
    if (candidates.length === 0) {
      issues.push(Object.freeze({
        code: row.requirement.optional === true ? 'optional-support-missing' : 'required-support-missing',
        severity: row.requirement.optional === true ? 'warning' : 'error',
        participant: row.participant,
        message: `no participant supports ${API_VERSION} ${KIND}`,
      }))
    } else if (candidates.length > 1) {
      issues.push(Object.freeze({
        code: 'support-ambiguous',
        severity: 'error',
        participant: row.participant,
        message: `multiple participants support ${API_VERSION} ${KIND}`,
      }))
    } else {
      publishers.set(row.participant, candidates[0]!.participant)
    }
  }
  return {
    agreement: Object.freeze({
      kind: 'MessageObserverBindings',
      publishers: Object.freeze(Object.fromEntries([...publishers].sort(([left], [right]) => left.localeCompare(right)))),
    }),
    issues: Object.freeze(issues),
  }
}

function emptySpec(value: unknown): undefined {
  if (value !== undefined) throw new TypeError(`${KIND} does not accept spec in v1alpha1`)
  return undefined
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  const unknown = Object.keys(value).filter(name => !allowed.includes(name))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
  for (const name of required) {
    if (!Object.hasOwn(value, name)) throw new TypeError(`${label}.${name} is required`)
  }
  return value
}

function boundedText(value: unknown, maximum: number, label: string, empty: boolean): asserts value is string {
  if (typeof value !== 'string' || (!empty && value.length === 0) || value.length > maximum) {
    throw new TypeError(`${label} must be ${empty ? '' : 'a non-empty '}string of at most ${maximum} characters`)
  }
}

function base64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
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
