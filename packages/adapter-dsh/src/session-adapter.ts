/** DeepSeek Harness Session Controller mapping for the standard Session protocols. */

import { createHash, randomUUID } from 'node:crypto'
import type { CapabilityHandlerContext, CapabilityImplementation } from '@dsh-std/connection'
import {
  sessionCatalogImplementation,
  type CreateSessionInput,
  type ListSessionsInput,
  type RenameSessionInput,
  type SessionCatalogPage,
} from '@dsh-std/session/catalog'
import {
  sessionHistoryImplementation,
  type FollowSessionHistoryInput,
  type ReadSessionHistoryInput,
  type SessionEventEnvelope,
  type SessionHistoryFollowProgress,
  type SessionHistoryPage,
} from '@dsh-std/session/history'
import type { SessionDescriptor, SessionReference } from '@dsh-std/session'

const MAX_CATALOG_PAGE_SIZE = 100
const MAX_HISTORY_PAGE_EVENTS = 500
const MAX_CATALOG_SNAPSHOTS = 64

interface DshSessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

interface DshSessionHeader {
  readonly id: string
  readonly createdAt: number
  readonly parentSession?: string
  readonly seedLength?: number
  readonly origin?: 'subagent'
}

interface DshSessionProjectionHints {
  readonly asOfSeq: number
  readonly values: Readonly<Record<string, unknown>>
}

interface DshSessionSummary {
  readonly sessionId: string
  readonly origin?: 'subagent'
  readonly projections?: DshSessionProjectionHints
}

interface DshSessionFollowSnapshot {
  readonly type: 'snapshot'
  readonly cursor: number
}

interface DshSessionFollowEvent {
  readonly type: 'event'
  readonly event: DshSessionEvent
}

/** Structural face of `@deepseek-ai/dsh-api-session-controller@0.1.2-alpha.2`. */
export interface DshSessionControllerFace {
  list(request: { readonly cursor?: string }, signal: AbortSignal): Promise<{
    readonly items: readonly DshSessionSummary[]
  }>
  inspect(sessionId: string, signal?: AbortSignal): Promise<{
    readonly meta: DshSessionHeader
    readonly events: readonly DshSessionEvent[]
  }>
  create(request: { readonly sessionId?: string }): Promise<{ readonly sessionId: string }>
  rename(request: { readonly sessionId: string; readonly title: string }): Promise<{
    readonly title: string
    readonly seq: number
  }>
  follow(
    request: { readonly address: { readonly kind: 'session'; readonly sessionId: string } },
    signal: AbortSignal,
  ): AsyncIterable<DshSessionFollowSnapshot | DshSessionFollowEvent>
}

interface CatalogSnapshot {
  readonly revision: number
  readonly sessions: readonly SessionDescriptor[]
}

/** Product adapter for the portable SessionCatalog and SessionHistory capabilities. */
export class DshSessionProtocolAdapter {
  readonly implementations: readonly CapabilityImplementation[]

  private readonly snapshots = new Map<string, CatalogSnapshot>()
  private catalogRevision = 0
  private catalogFingerprint: string | undefined
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly participantId: string,
    private readonly controller: DshSessionControllerFace,
    private readonly replayOf: (type: string) => 'required' | 'ignorable',
  ) {
    this.implementations = Object.freeze([
      sessionCatalogImplementation(participantId, {
        sessionDomain: 'deepseek-harness',
        operations: ['list', 'get', 'create', 'rename'],
        mutationConcurrency: 'serialized',
        limits: { maxPageSize: MAX_CATALOG_PAGE_SIZE },
      }, {
        list: (input, context) => this.list(input, context),
        get: (session, context) => this.get(session, context.signal),
        create: (input, context) => this.create(input, context.signal),
        rename: (input, context) => this.rename(input, context.signal),
      }),
      sessionHistoryImplementation(participantId, {
        sessionDomain: 'deepseek-harness',
        operations: ['read', 'follow'],
        limits: { maxPageEvents: MAX_HISTORY_PAGE_EVENTS },
      }, {
        read: (input, context) => this.read(input, context.signal),
        follow: (input, context) => this.follow(input, context),
      }),
    ])
  }

  private async list(
    input: ListSessionsInput,
    context: CapabilityHandlerContext,
  ): Promise<SessionCatalogPage> {
    const limit = input.limit ?? MAX_CATALOG_PAGE_SIZE
    let snapshot: CatalogSnapshot
    let offset = 0
    let snapshotId: string | undefined
    if (input.after === undefined) {
      snapshot = await this.captureCatalog(context.signal)
    } else {
      const cursor = parsePageCursor(input.after)
      snapshotId = cursor.snapshotId
      offset = cursor.offset
      snapshot = this.snapshots.get(snapshotId) ?? invalidCursor('SessionCatalog page cursor is no longer available')
      if (offset < 1 || offset >= snapshot.sessions.length) {
        invalidCursor('SessionCatalog page cursor is outside its snapshot')
      }
    }
    const sessions = snapshot.sessions.slice(offset, offset + limit)
    const nextOffset = offset + sessions.length
    let next: string | undefined
    if (nextOffset < snapshot.sessions.length) {
      snapshotId ??= this.retainSnapshot(snapshot)
      next = `${snapshotId}:${String(nextOffset)}`
    } else if (snapshotId !== undefined) {
      this.snapshots.delete(snapshotId)
    }
    return {
      catalogRevision: snapshot.revision,
      sessions,
      ...(next === undefined ? {} : { next }),
    }
  }

  private async captureCatalog(signal: AbortSignal): Promise<CatalogSnapshot> {
    const listed = await this.controller.list({}, signal)
    const ordinary = listed.items.filter(item => item.origin !== 'subagent')
    const sessions = await Promise.all(ordinary.map(async item => {
      const inspected = await this.controller.inspect(item.sessionId, signal)
      return descriptorOf(this.participantId, inspected.meta, inspected.events)
    }))
    const fingerprint = sessions
      .map(session => `${session.session.id}\0${String(session.revision)}`)
      .join('\0')
    if (fingerprint !== this.catalogFingerprint) {
      this.catalogFingerprint = fingerprint
      this.catalogRevision++
    }
    return Object.freeze({ revision: this.catalogRevision, sessions: Object.freeze(sessions) })
  }

  private retainSnapshot(snapshot: CatalogSnapshot): string {
    while (this.snapshots.size >= MAX_CATALOG_SNAPSHOTS) {
      const oldest = this.snapshots.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.snapshots.delete(oldest)
    }
    const id = randomUUID()
    this.snapshots.set(id, snapshot)
    return id
  }

  private async get(session: SessionReference, signal: AbortSignal): Promise<SessionDescriptor | undefined> {
    try {
      const inspected = await this.controller.inspect(session.id, signal)
      if (inspected.meta.origin === 'subagent') return undefined
      return descriptorOf(this.participantId, inspected.meta, inspected.events)
    } catch (error) {
      const code = failureCode(error)
      if (code === 'session/not-found' || code === 'session-not-found') return undefined
      throw error
    }
  }

  private create(input: CreateSessionInput, signal: AbortSignal): Promise<{ readonly session: SessionDescriptor }> {
    return this.serializeMutation(async () => {
      signal.throwIfAborted()
      const sessionId = sessionIdForRequest(input.requestId)
      let descriptor = await this.get({ provider: this.participantId, id: sessionId }, signal)
      if (descriptor === undefined) {
        await this.controller.create({ sessionId })
        descriptor = await this.requiredDescriptor(sessionId, signal)
      }
      if (input.title !== undefined && descriptor.title !== input.title) {
        await this.controller.rename({ sessionId, title: input.title })
        descriptor = await this.requiredDescriptor(sessionId, signal)
      }
      this.invalidateCatalog()
      return { session: descriptor }
    })
  }

  private rename(input: RenameSessionInput, signal: AbortSignal): Promise<SessionDescriptor> {
    return this.serializeMutation(async () => {
      signal.throwIfAborted()
      await this.controller.rename({ sessionId: input.session.id, title: input.title })
      const descriptor = await this.requiredDescriptor(input.session.id, signal)
      this.invalidateCatalog()
      return descriptor
    })
  }

  private async requiredDescriptor(sessionId: string, signal: AbortSignal): Promise<SessionDescriptor> {
    const descriptor = await this.get({ provider: this.participantId, id: sessionId }, signal)
    if (descriptor === undefined) throw new Error(`DSH Session ${JSON.stringify(sessionId)} disappeared after mutation`)
    return descriptor
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private invalidateCatalog(): void {
    this.catalogFingerprint = undefined
    this.snapshots.clear()
  }

  private async read(input: ReadSessionHistoryInput, signal: AbortSignal): Promise<SessionHistoryPage> {
    const inspected = await this.controller.inspect(input.session.id, signal)
    if (inspected.meta.origin === 'subagent') {
      throw new Error('DSH subagent history requires a parent-qualified product address')
    }
    const after = validateEventCursor(input.after, inspected.events)
    const before = validateEventCursor(input.before, inspected.events)
    const candidates = inspected.events.filter(event =>
      (after === undefined || event.seq > after) && (before === undefined || event.seq < before))
    const limit = input.limit ?? MAX_HISTORY_PAGE_EVENTS
    const hasMore = candidates.length > limit
    const selected = input.direction === 'backward'
      ? candidates.slice(Math.max(0, candidates.length - limit))
      : candidates.slice(0, limit)
    const events = selected.map(event => eventEnvelope(this.participantId, input.session.id, event, this.replayOf))
    return {
      session: input.session,
      events,
      ...(events.length === 0 ? {} : { first: events[0]!.cursor, last: events.at(-1)!.cursor }),
      hasMore,
    }
  }

  private async follow(
    input: FollowSessionHistoryInput,
    context: CapabilityHandlerContext<SessionHistoryFollowProgress>,
  ): Promise<void> {
    let ready = false
    for await (const frame of this.controller.follow({
      address: { kind: 'session', sessionId: input.session.id },
    }, context.signal)) {
      if (frame.type === 'snapshot') {
        if (ready) throw new Error('DSH Session follow produced more than one snapshot')
        ready = true
        const boundary = frame.cursor >= 0 ? String(frame.cursor) : undefined
        context.progress({
          type: 'ready',
          session: input.session,
          ...(boundary === undefined ? {} : { boundary }),
        })
        if (input.after !== undefined) {
          const inspected = await this.controller.inspect(input.session.id, context.signal)
          const after = validateEventCursor(input.after, inspected.events)
          for (const event of inspected.events) {
            if (event.seq <= (after as number) || event.seq > frame.cursor) continue
            context.progress({
              type: 'event',
              event: eventEnvelope(this.participantId, input.session.id, event, this.replayOf),
            })
          }
        }
        continue
      }
      if (!ready) throw new Error('DSH Session follow emitted an event before its snapshot')
      context.progress({
        type: 'event',
        event: eventEnvelope(this.participantId, input.session.id, frame.event, this.replayOf),
      })
    }
    if (!ready && !context.signal.aborted) throw new Error('DSH Session follow ended before its snapshot')
  }
}

function descriptorOf(
  participantId: string,
  header: DshSessionHeader,
  events: readonly DshSessionEvent[],
): SessionDescriptor {
  const titleEvent = [...events].reverse().find(event => event.type === 'session/title'
    && typeof record(event.data)?.title === 'string')
  const title = record(titleEvent?.data)?.title
  const last = events.at(-1)
  return Object.freeze({
    session: Object.freeze({ provider: participantId, id: header.id }),
    ...(typeof title === 'string' && title.trim() !== '' ? { title } : {}),
    state: 'available',
    revision: last === undefined ? 0 : last.seq + 1,
    createdAt: new Date(header.createdAt).toISOString(),
    updatedAt: new Date(last?.time ?? header.createdAt).toISOString(),
    ...(header.parentSession === undefined ? {} : {
      lineage: Object.freeze({
        parent: Object.freeze({ provider: participantId, id: header.parentSession }),
        ...(header.seedLength === undefined || header.seedLength === 0
          ? {}
          : { through: String(header.seedLength - 1) }),
      }),
    }),
  })
}

function eventEnvelope(
  participantId: string,
  sessionId: string,
  event: DshSessionEvent,
  replayOf: (type: string) => 'required' | 'ignorable',
): SessionEventEnvelope {
  return Object.freeze({
    session: Object.freeze({ provider: participantId, id: sessionId }),
    cursor: String(event.seq),
    type: event.type,
    timestamp: new Date(event.time).toISOString(),
    replay: replayOf(event.type),
    data: event.data,
  })
}

function validateEventCursor(
  cursor: string | undefined,
  events: readonly DshSessionEvent[],
): number | undefined {
  if (cursor === undefined) return undefined
  if (!/^(?:0|[1-9]\d*)$/u.test(cursor)) invalidCursor('DSH Session event cursor is invalid')
  const seq = Number(cursor)
  if (!Number.isSafeInteger(seq) || events[seq]?.seq !== seq) {
    invalidCursor('DSH Session event cursor does not exist in this history')
  }
  return seq
}

function parsePageCursor(cursor: string): { readonly snapshotId: string; readonly offset: number } {
  const match = /^([0-9a-f-]{36}):([1-9]\d*)$/u.exec(cursor)
  if (match === null) invalidCursor('SessionCatalog page cursor is invalid')
  const offset = Number(match[2])
  if (!Number.isSafeInteger(offset)) invalidCursor('SessionCatalog page cursor offset is invalid')
  return { snapshotId: match[1]!, offset }
}

function invalidCursor(message: string): never {
  throw new TypeError(message)
}

function sessionIdForRequest(requestId: string): string {
  const digest = createHash('sha256').update(requestId).digest('hex').slice(0, 32)
  return `session-std-${digest}`
}

function failureCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = Reflect.get(error, 'code')
  if (typeof code === 'string') return code
  const failure = Reflect.get(error, 'failure') as unknown
  return typeof failure === 'object' && failure !== null && typeof Reflect.get(failure, 'code') === 'string'
    ? Reflect.get(failure, 'code') as string
    : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
