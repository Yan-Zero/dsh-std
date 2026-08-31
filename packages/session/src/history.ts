import type { CapabilityCall, CapabilityClient, CapabilityHandlerContext, CapabilityImplementation } from '@dsh-std/connection'
import type { ProtocolCatalog, ProtocolDefinition, ProtocolNegotiationInput, ProtocolSupport } from '@dsh-std/core'
import {
  API_VERSION,
  validateSessionDescriptor,
  validateSessionReference,
  type SessionCursor,
  type SessionDescriptor,
  type SessionReference,
} from './index.js'
import { negotiateSessionCapability } from './negotiation.js'
import {
  exactRecord,
  freezeClone,
  nonEmpty,
  optionalPositiveInteger,
  positiveInteger,
  requiredHandler,
  stringList,
} from './validation.js'

export const HISTORY_KIND = 'SessionHistory'

export type SessionHistoryOperation = 'read' | 'follow' | 'fork'

export interface SessionHistoryRequirementSpec {
  readonly operations: readonly SessionHistoryOperation[]
  readonly optionalOperations?: readonly SessionHistoryOperation[]
  readonly sessionDomain?: string
}

export interface SessionHistoryLimits {
  readonly maxPageEvents?: number
  readonly maxEventBytes?: number
  readonly maxFollowBuffer?: number
  readonly maxForkEvents?: number
}

export interface SessionHistorySupportSpec {
  readonly sessionDomain: string
  readonly operations: readonly SessionHistoryOperation[]
  readonly limits?: SessionHistoryLimits
}

export interface SessionEventEnvelope<Data = unknown> {
  readonly session: SessionReference
  readonly cursor: SessionCursor
  readonly type: string
  readonly timestamp?: string
  readonly replay: 'required' | 'ignorable'
  readonly data: Data
}

export interface ReadSessionHistoryInput {
  readonly session: SessionReference
  readonly after?: SessionCursor
  readonly before?: SessionCursor
  readonly direction?: 'forward' | 'backward'
  readonly limit?: number
}

export interface SessionHistoryPage {
  readonly session: SessionReference
  readonly events: readonly SessionEventEnvelope[]
  readonly first?: SessionCursor
  readonly last?: SessionCursor
  readonly hasMore: boolean
}

export interface FollowSessionHistoryInput {
  readonly session: SessionReference
  readonly after?: SessionCursor
}

export type SessionHistoryFollowProgress =
  | { readonly type: 'ready'; readonly session: SessionReference; readonly boundary?: SessionCursor }
  | { readonly type: 'event'; readonly event: SessionEventEnvelope }

export interface ForkSessionInput {
  readonly source: SessionReference
  readonly through: SessionCursor
  readonly requestId: string
}

export interface ForkSessionResult { readonly session: SessionDescriptor }

interface CallOptions { readonly signal?: AbortSignal }

export interface SessionHistoryClient {
  read(input: ReadSessionHistoryInput, options?: CallOptions): CapabilityCall<SessionHistoryPage>
  follow(input: FollowSessionHistoryInput, options?: CallOptions): CapabilityCall<void, SessionHistoryFollowProgress>
  fork(input: ForkSessionInput, options?: CallOptions): CapabilityCall<ForkSessionResult>
}

export interface SessionHistoryHandler {
  read?(input: ReadSessionHistoryInput, context: CapabilityHandlerContext): SessionHistoryPage | Promise<SessionHistoryPage>
  follow?(input: FollowSessionHistoryInput, context: CapabilityHandlerContext<SessionHistoryFollowProgress>): void | Promise<void>
  fork?(input: ForkSessionInput, context: CapabilityHandlerContext): ForkSessionResult | Promise<ForkSessionResult>
}

export const sessionHistoryProtocol: ProtocolDefinition<SessionHistoryRequirementSpec, SessionHistorySupportSpec> = Object.freeze({
  apiVersion: API_VERSION,
  kind: HISTORY_KIND,
  validateRequirement: validateSessionHistoryRequirement,
  validateSupport: validateSessionHistorySupport,
  negotiate(input: ProtocolNegotiationInput<SessionHistoryRequirementSpec, SessionHistorySupportSpec>) {
    return negotiateSessionCapability(input, {
      kind: HISTORY_KIND,
      compatible(requirement, support) {
        return requirement.operations.every(operation => support.operations.includes(operation))
          && (requirement.sessionDomain === undefined || requirement.sessionDomain === support.sessionDomain)
      },
    })
  },
})

export function sessionHistorySupport(spec: SessionHistorySupportSpec): ProtocolSupport<SessionHistorySupportSpec> {
  return Object.freeze({ apiVersion: API_VERSION, kind: HISTORY_KIND, spec: validateSessionHistorySupport(spec) })
}

export function sessionHistory(client: CapabilityClient): SessionHistoryClient {
  const reference = Object.freeze({ apiVersion: API_VERSION, kind: HISTORY_KIND })
  return Object.freeze({
    read(input: ReadSessionHistoryInput, options?: CallOptions) {
      return client.invoke(reference, 'read', validateReadSessionHistoryInput(input), options) as CapabilityCall<SessionHistoryPage>
    },
    follow(input: FollowSessionHistoryInput, options?: CallOptions) {
      return client.invoke(reference, 'follow', validateFollowSessionHistoryInput(input), options) as CapabilityCall<void, SessionHistoryFollowProgress>
    },
    fork(input: ForkSessionInput, options?: CallOptions) {
      return client.invoke(reference, 'fork', validateForkSessionInput(input), options) as CapabilityCall<ForkSessionResult>
    },
  })
}

export function sessionHistoryImplementation(
  participantId: string,
  spec: SessionHistorySupportSpec,
  handler: SessionHistoryHandler,
): CapabilityImplementation {
  const support = sessionHistorySupport(spec)
  const normalizedSpec = support.spec!
  validateDeclaredHandlers(normalizedSpec.operations, handler, HISTORY_KIND)
  return Object.freeze({
    participantId,
    protocol: support,
    async handle(operation: string, input: unknown, context: CapabilityHandlerContext) {
      if (!normalizedSpec.operations.includes(operation as SessionHistoryOperation)) {
        throw new TypeError(`SessionHistory operation ${JSON.stringify(operation)} was not declared`)
      }
      if (operation === 'read') {
        const validatedInput = validateReadSessionHistoryInput(input)
        assertProvider(validatedInput.session, participantId, 'SessionHistory.read input.session')
        enforcePageLimit(validatedInput.limit, normalizedSpec.limits?.maxPageEvents)
        return validateSessionHistoryPage(
          await requiredHandler(handler.read, HISTORY_KIND, operation)(validatedInput, context),
          validatedInput.session,
          minimumDefined(validatedInput.limit, normalizedSpec.limits?.maxPageEvents),
        )
      }
      if (operation === 'follow') {
        const validatedInput = validateFollowSessionHistoryInput(input)
        assertProvider(validatedInput.session, participantId, 'SessionHistory.follow input.session')
        const follow = requiredHandler(handler.follow, HISTORY_KIND, operation)
        const progress = validatedFollowContext(context, validatedInput.session)
        await follow(validatedInput, progress.context)
        progress.assertReady()
        return undefined
      }
      if (operation === 'fork') {
        const validatedInput = validateForkSessionInput(input)
        assertProvider(validatedInput.source, participantId, 'SessionHistory.fork input.source')
        return validateForkSessionResult(
          await requiredHandler(handler.fork, HISTORY_KIND, operation)(validatedInput, context),
          participantId,
          validatedInput,
        )
      }
      throw new TypeError(`unsupported SessionHistory operation ${JSON.stringify(operation)}`)
    },
  })
}

export function registerSessionHistory(protocols: ProtocolCatalog): () => void {
  return protocols.register(sessionHistoryProtocol)
}

export function validateSessionHistoryRequirement(value: unknown): SessionHistoryRequirementSpec {
  const spec = exactRecord(value, ['operations', 'optionalOperations', 'sessionDomain'], ['operations'], 'SessionHistory requirement spec')
  const operations = operationList(spec.operations, 'SessionHistory requirement spec.operations')
  const optionalOperations = spec.optionalOperations === undefined ? undefined : operationList(spec.optionalOperations, 'SessionHistory requirement spec.optionalOperations')
  if (optionalOperations?.some(operation => operations.includes(operation))) throw new TypeError('SessionHistory optionalOperations duplicates required operations')
  if (spec.sessionDomain !== undefined) nonEmpty(spec.sessionDomain, 'SessionHistory requirement spec.sessionDomain')
  return freezeClone({
    operations,
    ...(optionalOperations === undefined ? {} : { optionalOperations }),
    ...(spec.sessionDomain === undefined ? {} : { sessionDomain: spec.sessionDomain as string }),
  })
}

export function validateSessionHistorySupport(value: unknown): SessionHistorySupportSpec {
  const spec = exactRecord(value, ['sessionDomain', 'operations', 'limits'], ['sessionDomain', 'operations'], 'SessionHistory support spec')
  nonEmpty(spec.sessionDomain, 'SessionHistory support spec.sessionDomain')
  const limits = spec.limits === undefined ? undefined : validateHistoryLimits(spec.limits)
  return freezeClone({
    sessionDomain: spec.sessionDomain,
    operations: operationList(spec.operations, 'SessionHistory support spec.operations'),
    ...(limits === undefined ? {} : { limits }),
  })
}

export function validateSessionEventEnvelope(value: unknown): SessionEventEnvelope {
  const event = exactRecord(value, ['session', 'cursor', 'type', 'timestamp', 'replay', 'data'], ['session', 'cursor', 'type', 'replay', 'data'], 'SessionEvent envelope')
  nonEmpty(event.cursor, 'SessionEvent envelope.cursor')
  if (typeof event.type !== 'string' || !/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)+$/u.test(event.type)) {
    throw new TypeError('SessionEvent envelope.type must be a namespaced event type')
  }
  if (event.timestamp !== undefined) nonEmpty(event.timestamp, 'SessionEvent envelope.timestamp')
  if (event.replay !== 'required' && event.replay !== 'ignorable') throw new TypeError('SessionEvent envelope.replay is invalid')
  return freezeClone({
    session: validateSessionReference(event.session),
    cursor: event.cursor,
    type: event.type,
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp as string }),
    replay: event.replay,
    data: event.data,
  })
}

export function validateReadSessionHistoryInput(value: unknown): ReadSessionHistoryInput {
  const input = exactRecord(value, ['session', 'after', 'before', 'direction', 'limit'], ['session'], 'SessionHistory.read input')
  if (input.after !== undefined) nonEmpty(input.after, 'SessionHistory.read input.after')
  if (input.before !== undefined) nonEmpty(input.before, 'SessionHistory.read input.before')
  if (input.direction !== undefined && input.direction !== 'forward' && input.direction !== 'backward') throw new TypeError('SessionHistory.read input.direction is invalid')
  optionalPositiveInteger(input.limit, 'SessionHistory.read input.limit')
  return Object.freeze({
    session: validateSessionReference(input.session),
    ...(input.after === undefined ? {} : { after: input.after as string }),
    ...(input.before === undefined ? {} : { before: input.before as string }),
    ...(input.direction === undefined ? {} : { direction: input.direction }),
    ...(input.limit === undefined ? {} : { limit: input.limit as number }),
  })
}

export function validateSessionHistoryPage(
  value: unknown,
  expected?: SessionReference,
  maximumEvents?: number,
): SessionHistoryPage {
  const page = exactRecord(value, ['session', 'events', 'first', 'last', 'hasMore'], ['session', 'events', 'hasMore'], 'SessionHistory page')
  const session = validateSessionReference(page.session)
  if (expected !== undefined && !sameSession(session, expected)) throw new TypeError('SessionHistory page belongs to another session')
  if (!Array.isArray(page.events)) throw new TypeError('SessionHistory page.events must be an array')
  if (maximumEvents !== undefined && page.events.length > maximumEvents) {
    throw new TypeError('SessionHistory page.events exceeds the negotiated or requested maximum')
  }
  const events = page.events.map(validateSessionEventEnvelope)
  for (const event of events) if (!sameSession(event.session, session)) throw new TypeError('SessionHistory page contains an event for another session')
  const cursors = events.map(event => event.cursor)
  if (new Set(cursors).size !== cursors.length) throw new TypeError('SessionHistory page.events contains duplicate cursors')
  if (page.first !== undefined) nonEmpty(page.first, 'SessionHistory page.first')
  if (page.last !== undefined) nonEmpty(page.last, 'SessionHistory page.last')
  if (typeof page.hasMore !== 'boolean') throw new TypeError('SessionHistory page.hasMore must be boolean')
  if (events.length > 0 && page.first !== undefined && page.first !== events[0]!.cursor) throw new TypeError('SessionHistory page.first does not match the first event')
  if (events.length > 0 && page.last !== undefined && page.last !== events.at(-1)!.cursor) throw new TypeError('SessionHistory page.last does not match the last event')
  return freezeClone({
    session,
    events,
    ...(page.first === undefined ? {} : { first: page.first as string }),
    ...(page.last === undefined ? {} : { last: page.last as string }),
    hasMore: page.hasMore,
  })
}

export function validateFollowSessionHistoryInput(value: unknown): FollowSessionHistoryInput {
  const input = exactRecord(value, ['session', 'after'], ['session'], 'SessionHistory.follow input')
  if (input.after !== undefined) nonEmpty(input.after, 'SessionHistory.follow input.after')
  return Object.freeze({
    session: validateSessionReference(input.session),
    ...(input.after === undefined ? {} : { after: input.after as string }),
  })
}

export function validateSessionHistoryFollowProgress(value: unknown): SessionHistoryFollowProgress {
  const progress = exactRecord(value, ['type', 'session', 'boundary', 'event'], ['type'], 'SessionHistory.follow progress')
  if (progress.type === 'ready') {
    if (progress.event !== undefined) throw new TypeError('SessionHistory.follow ready progress must not contain event')
    const session = validateSessionReference(progress.session)
    if (progress.boundary !== undefined) nonEmpty(progress.boundary, 'SessionHistory.follow ready progress.boundary')
    return Object.freeze({
      type: progress.type,
      session,
      ...(progress.boundary === undefined ? {} : { boundary: progress.boundary as string }),
    })
  }
  if (progress.type === 'event') {
    if (progress.session !== undefined || progress.boundary !== undefined) {
      throw new TypeError('SessionHistory.follow event progress must not contain ready fields')
    }
    return Object.freeze({ type: progress.type, event: validateSessionEventEnvelope(progress.event) })
  }
  throw new TypeError('SessionHistory.follow progress.type is invalid')
}

export function validateForkSessionInput(value: unknown): ForkSessionInput {
  const input = exactRecord(value, ['source', 'through', 'requestId'], ['source', 'through', 'requestId'], 'SessionHistory.fork input')
  nonEmpty(input.through, 'SessionHistory.fork input.through')
  nonEmpty(input.requestId, 'SessionHistory.fork input.requestId')
  return Object.freeze({ source: validateSessionReference(input.source), through: input.through, requestId: input.requestId })
}

function validateForkSessionResult(
  value: unknown,
  expectedProvider?: string,
  input?: ForkSessionInput,
): ForkSessionResult {
  const result = exactRecord(value, ['session'], ['session'], 'SessionHistory.fork result')
  const session = validateSessionDescriptor(result.session)
  if (expectedProvider !== undefined) assertProvider(session.session, expectedProvider, 'SessionHistory.fork result.session.session')
  if (input !== undefined && (
    session.lineage === undefined
    || !sameSession(session.lineage.parent, input.source)
    || session.lineage.through !== input.through
  )) {
    throw new TypeError('SessionHistory.fork result does not record the requested lineage')
  }
  return Object.freeze({ session })
}

function validateHistoryLimits(value: unknown): SessionHistoryLimits {
  const limits = exactRecord(value, ['maxPageEvents', 'maxEventBytes', 'maxFollowBuffer', 'maxForkEvents'], [], 'SessionHistory limits')
  for (const [name, limit] of Object.entries(limits)) positiveInteger(limit, `SessionHistory limits.${name}`)
  return freezeClone(limits as SessionHistoryLimits)
}

function operationList(value: unknown, label: string): readonly SessionHistoryOperation[] {
  const allowed = new Set<SessionHistoryOperation>(['read', 'follow', 'fork'])
  const values = stringList(value, label)
  if (values.some(value => !allowed.has(value as SessionHistoryOperation))) throw new TypeError(`${label} contains an invalid operation`)
  return values as readonly SessionHistoryOperation[]
}

function validatedFollowContext(
  context: CapabilityHandlerContext,
  session: SessionReference,
): {
  readonly context: CapabilityHandlerContext<SessionHistoryFollowProgress>
  assertReady(): void
} {
  let ready = false
  return Object.freeze({
    context: Object.freeze({
      ...context,
      progress(value: SessionHistoryFollowProgress) {
        const progress = validateSessionHistoryFollowProgress(value)
        if (progress.type === 'ready') {
          if (ready) throw new TypeError('SessionHistory.follow emitted ready more than once')
          if (!sameSession(progress.session, session)) throw new TypeError('SessionHistory.follow ready belongs to another session')
          ready = true
        } else {
          if (!ready) throw new TypeError('SessionHistory.follow must emit ready before events')
          if (!sameSession(progress.event.session, session)) throw new TypeError('SessionHistory.follow event belongs to another session')
        }
        context.progress(progress)
      },
    }),
    assertReady() {
      if (!ready) throw new TypeError('SessionHistory.follow ended before ready')
    },
  })
}

function sameSession(left: SessionReference, right: SessionReference): boolean {
  return left.provider === right.provider && left.id === right.id
}

function assertProvider(session: SessionReference, participantId: string, label: string): void {
  if (session.provider !== participantId) throw new TypeError(`${label} belongs to another provider`)
}

function enforcePageLimit(requested: number | undefined, maximum: number | undefined): void {
  if (requested !== undefined && maximum !== undefined && requested > maximum) {
    throw new TypeError('SessionHistory.read input.limit exceeds the negotiated maximum')
  }
}

function minimumDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return Math.min(left, right)
}

function validateDeclaredHandlers(
  operations: readonly SessionHistoryOperation[],
  handler: SessionHistoryHandler,
  owner: string,
): void {
  for (const operation of operations) {
    if (typeof handler[operation] !== 'function') throw new TypeError(`${owner} handler.${operation} is missing`)
  }
}
