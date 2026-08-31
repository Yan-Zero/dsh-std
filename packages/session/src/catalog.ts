import type { CapabilityCall, CapabilityClient, CapabilityHandlerContext, CapabilityImplementation } from '@dsh-std/connection'
import type { ProtocolCatalog, ProtocolDefinition, ProtocolNegotiationInput, ProtocolSupport } from '@dsh-std/core'
import {
  API_VERSION,
  validateSessionDescriptor,
  validateSessionReference,
  type SessionDescriptor,
  type SessionPageCursor,
  type SessionReference,
} from './index.js'
import { negotiateSessionCapability } from './negotiation.js'
import {
  exactRecord,
  freezeClone,
  nonEmpty,
  nonNegativeInteger,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  positiveInteger,
  requiredHandler,
  stringList,
} from './validation.js'

export const CATALOG_KIND = 'SessionCatalog'

export type SessionCatalogOperation = 'list' | 'get' | 'create' | 'rename' | 'delete' | 'watch'
export type SessionMutationConcurrency = 'serialized' | 'revision-checked'

export interface SessionCatalogRequirementSpec {
  readonly operations: readonly SessionCatalogOperation[]
  readonly optionalOperations?: readonly SessionCatalogOperation[]
  readonly sessionDomain?: string
  readonly mutationConcurrency?: SessionMutationConcurrency
}

export interface SessionCatalogLimits {
  readonly maxPageSize?: number
  readonly maxWatchBuffer?: number
}

export interface SessionCatalogSupportSpec {
  readonly sessionDomain: string
  readonly operations: readonly SessionCatalogOperation[]
  readonly mutationConcurrency: SessionMutationConcurrency
  readonly limits?: SessionCatalogLimits
}

export interface ListSessionsInput {
  readonly after?: SessionPageCursor
  readonly limit?: number
}

export interface SessionCatalogPage {
  readonly catalogRevision: number
  readonly sessions: readonly SessionDescriptor[]
  readonly next?: SessionPageCursor
}

export interface WatchSessionCatalogInput { readonly afterRevision?: number }

export interface CreateSessionInput {
  readonly title?: string
  readonly requestId: string
}

export interface CreateSessionResult { readonly session: SessionDescriptor }

export interface RenameSessionInput {
  readonly session: SessionReference
  readonly title: string
  readonly expectedRevision?: number
}

export interface DeleteSessionInput {
  readonly session: SessionReference
  readonly expectedRevision?: number
}

export interface DeleteSessionResult { readonly deleted: boolean }

export type SessionCatalogEvent =
  | { readonly type: 'session-created' | 'descriptor-changed'; readonly beforeRevision: number; readonly afterRevision: number; readonly session: SessionDescriptor }
  | { readonly type: 'session-deleted'; readonly beforeRevision: number; readonly afterRevision: number; readonly session: SessionReference }
  | { readonly type: 'catalog-invalidated'; readonly beforeRevision: number; readonly afterRevision: number }

export type SessionCatalogWatchProgress =
  | { readonly type: 'ready'; readonly catalogRevision: number }
  | { readonly type: 'event'; readonly event: SessionCatalogEvent }

interface CallOptions { readonly signal?: AbortSignal }

export interface SessionCatalogClient {
  list(input?: ListSessionsInput, options?: CallOptions): CapabilityCall<SessionCatalogPage>
  get(session: SessionReference, options?: CallOptions): CapabilityCall<SessionDescriptor | undefined>
  create(input: CreateSessionInput, options?: CallOptions): CapabilityCall<CreateSessionResult>
  rename(input: RenameSessionInput, options?: CallOptions): CapabilityCall<SessionDescriptor>
  delete(input: DeleteSessionInput, options?: CallOptions): CapabilityCall<DeleteSessionResult>
  watch(input?: WatchSessionCatalogInput, options?: CallOptions): CapabilityCall<void, SessionCatalogWatchProgress>
}

export interface SessionCatalogHandler {
  list?(input: ListSessionsInput, context: CapabilityHandlerContext): SessionCatalogPage | Promise<SessionCatalogPage>
  get?(session: SessionReference, context: CapabilityHandlerContext): SessionDescriptor | undefined | Promise<SessionDescriptor | undefined>
  create?(input: CreateSessionInput, context: CapabilityHandlerContext): CreateSessionResult | Promise<CreateSessionResult>
  rename?(input: RenameSessionInput, context: CapabilityHandlerContext): SessionDescriptor | Promise<SessionDescriptor>
  delete?(input: DeleteSessionInput, context: CapabilityHandlerContext): DeleteSessionResult | Promise<DeleteSessionResult>
  watch?(input: WatchSessionCatalogInput, context: CapabilityHandlerContext<SessionCatalogWatchProgress>): void | Promise<void>
}

export const sessionCatalogProtocol: ProtocolDefinition<SessionCatalogRequirementSpec, SessionCatalogSupportSpec> = Object.freeze({
  apiVersion: API_VERSION,
  kind: CATALOG_KIND,
  validateRequirement: validateSessionCatalogRequirement,
  validateSupport: validateSessionCatalogSupport,
  negotiate(input: ProtocolNegotiationInput<SessionCatalogRequirementSpec, SessionCatalogSupportSpec>) {
    return negotiateSessionCapability(input, {
      kind: CATALOG_KIND,
      compatible(requirement, support) {
        return requirement.operations.every(operation => support.operations.includes(operation))
          && (requirement.sessionDomain === undefined || requirement.sessionDomain === support.sessionDomain)
          && (requirement.mutationConcurrency === undefined || requirement.mutationConcurrency === support.mutationConcurrency)
      },
    })
  },
})

export function sessionCatalogSupport(spec: SessionCatalogSupportSpec): ProtocolSupport<SessionCatalogSupportSpec> {
  return Object.freeze({ apiVersion: API_VERSION, kind: CATALOG_KIND, spec: validateSessionCatalogSupport(spec) })
}

export function sessionCatalog(client: CapabilityClient): SessionCatalogClient {
  const reference = Object.freeze({ apiVersion: API_VERSION, kind: CATALOG_KIND })
  return Object.freeze({
    list(input: ListSessionsInput = {}, options?: CallOptions) {
      return client.invoke(reference, 'list', validateListSessionsInput(input), options) as CapabilityCall<SessionCatalogPage>
    },
    get(session: SessionReference, options?: CallOptions) {
      return client.invoke(reference, 'get', validateSessionReference(session), options) as CapabilityCall<SessionDescriptor | undefined>
    },
    create(input: CreateSessionInput, options?: CallOptions) {
      return client.invoke(reference, 'create', validateCreateSessionInput(input), options) as CapabilityCall<CreateSessionResult>
    },
    rename(input: RenameSessionInput, options?: CallOptions) {
      return client.invoke(reference, 'rename', validateRenameSessionInput(input), options) as CapabilityCall<SessionDescriptor>
    },
    delete(input: DeleteSessionInput, options?: CallOptions) {
      return client.invoke(reference, 'delete', validateDeleteSessionInput(input), options) as CapabilityCall<DeleteSessionResult>
    },
    watch(input: WatchSessionCatalogInput = {}, options?: CallOptions) {
      return client.invoke(reference, 'watch', validateWatchSessionCatalogInput(input), options) as CapabilityCall<void, SessionCatalogWatchProgress>
    },
  })
}

export function sessionCatalogImplementation(
  participantId: string,
  spec: SessionCatalogSupportSpec,
  handler: SessionCatalogHandler,
): CapabilityImplementation {
  const support = sessionCatalogSupport(spec)
  const normalizedSpec = support.spec!
  validateDeclaredHandlers(normalizedSpec.operations, handler, CATALOG_KIND)
  return Object.freeze({
    participantId,
    protocol: support,
    async handle(operation: string, input: unknown, context: CapabilityHandlerContext) {
      if (!normalizedSpec.operations.includes(operation as SessionCatalogOperation)) {
        throw new TypeError(`SessionCatalog operation ${JSON.stringify(operation)} was not declared`)
      }
      if (operation === 'list') {
        const validatedInput = validateListSessionsInput(input)
        enforcePageLimit(validatedInput.limit, normalizedSpec.limits?.maxPageSize, 'SessionCatalog.list input.limit')
        return validateSessionCatalogPage(
          await requiredHandler(handler.list, CATALOG_KIND, operation)(validatedInput, context),
          participantId,
          minimumDefined(validatedInput.limit, normalizedSpec.limits?.maxPageSize),
        )
      }
      if (operation === 'get') {
        const requested = ownedSessionReference(input, participantId, 'SessionCatalog.get input')
        const result = await requiredHandler(handler.get, CATALOG_KIND, operation)(requested, context)
        return result === undefined ? undefined : expectedDescriptor(result, requested, 'SessionCatalog.get result')
      }
      if (operation === 'create') {
        return validateCreateSessionResult(
          await requiredHandler(handler.create, CATALOG_KIND, operation)(validateCreateSessionInput(input), context),
          participantId,
        )
      }
      if (operation === 'rename') {
        const validatedInput = validateRenameSessionInput(input)
        assertProvider(validatedInput.session, participantId, 'SessionCatalog.rename input.session')
        enforceConcurrency(validatedInput.expectedRevision, normalizedSpec.mutationConcurrency, operation)
        return expectedDescriptor(
          await requiredHandler(handler.rename, CATALOG_KIND, operation)(validatedInput, context),
          validatedInput.session,
          'SessionCatalog.rename result',
        )
      }
      if (operation === 'delete') {
        const validatedInput = validateDeleteSessionInput(input)
        assertProvider(validatedInput.session, participantId, 'SessionCatalog.delete input.session')
        enforceConcurrency(validatedInput.expectedRevision, normalizedSpec.mutationConcurrency, operation)
        return validateDeleteSessionResult(await requiredHandler(handler.delete, CATALOG_KIND, operation)(validatedInput, context))
      }
      if (operation === 'watch') {
        const validatedInput = validateWatchSessionCatalogInput(input)
        const progress = validatedWatchContext(context, participantId, validatedInput.afterRevision)
        await requiredHandler(handler.watch, CATALOG_KIND, operation)(validatedInput, progress.context)
        progress.assertReady()
        return undefined
      }
      throw new TypeError(`unsupported SessionCatalog operation ${JSON.stringify(operation)}`)
    },
  })
}

export function registerSessionCatalog(protocols: ProtocolCatalog): () => void {
  return protocols.register(sessionCatalogProtocol)
}

export function validateSessionCatalogRequirement(value: unknown): SessionCatalogRequirementSpec {
  const spec = exactRecord(value, ['operations', 'optionalOperations', 'sessionDomain', 'mutationConcurrency'], ['operations'], 'SessionCatalog requirement spec')
  const operations = operationList(spec.operations, 'SessionCatalog requirement spec.operations')
  const optionalOperations = spec.optionalOperations === undefined ? undefined : operationList(spec.optionalOperations, 'SessionCatalog requirement spec.optionalOperations')
  if (optionalOperations?.some(operation => operations.includes(operation))) throw new TypeError('SessionCatalog optionalOperations duplicates required operations')
  if (spec.sessionDomain !== undefined) nonEmpty(spec.sessionDomain, 'SessionCatalog requirement spec.sessionDomain')
  const mutationConcurrency = concurrency(spec.mutationConcurrency, true)
  return freezeClone({
    operations,
    ...(optionalOperations === undefined ? {} : { optionalOperations }),
    ...(spec.sessionDomain === undefined ? {} : { sessionDomain: spec.sessionDomain as string }),
    ...(mutationConcurrency === undefined ? {} : { mutationConcurrency }),
  })
}

export function validateSessionCatalogSupport(value: unknown): SessionCatalogSupportSpec {
  const spec = exactRecord(value, ['sessionDomain', 'operations', 'mutationConcurrency', 'limits'], ['sessionDomain', 'operations', 'mutationConcurrency'], 'SessionCatalog support spec')
  nonEmpty(spec.sessionDomain, 'SessionCatalog support spec.sessionDomain')
  const limits = spec.limits === undefined ? undefined : validateCatalogLimits(spec.limits)
  return freezeClone({
    sessionDomain: spec.sessionDomain,
    operations: operationList(spec.operations, 'SessionCatalog support spec.operations'),
    mutationConcurrency: concurrency(spec.mutationConcurrency, false)!,
    ...(limits === undefined ? {} : { limits }),
  })
}

export function validateListSessionsInput(value: unknown): ListSessionsInput {
  const input = exactRecord(value, ['after', 'limit'], [], 'SessionCatalog.list input')
  if (input.after !== undefined) nonEmpty(input.after, 'SessionCatalog.list input.after')
  optionalPositiveInteger(input.limit, 'SessionCatalog.list input.limit')
  return Object.freeze({
    ...(input.after === undefined ? {} : { after: input.after as string }),
    ...(input.limit === undefined ? {} : { limit: input.limit as number }),
  })
}

export function validateWatchSessionCatalogInput(value: unknown): WatchSessionCatalogInput {
  const input = exactRecord(value, ['afterRevision'], [], 'SessionCatalog.watch input')
  optionalNonNegativeInteger(input.afterRevision, 'SessionCatalog.watch input.afterRevision')
  return Object.freeze({
    ...(input.afterRevision === undefined ? {} : { afterRevision: input.afterRevision as number }),
  })
}

export function validateSessionCatalogPage(
  value: unknown,
  expectedProvider?: string,
  maximumSize?: number,
): SessionCatalogPage {
  const page = exactRecord(value, ['catalogRevision', 'sessions', 'next'], ['catalogRevision', 'sessions'], 'SessionCatalog page')
  nonNegativeInteger(page.catalogRevision, 'SessionCatalog page.catalogRevision')
  if (!Array.isArray(page.sessions)) throw new TypeError('SessionCatalog page.sessions must be an array')
  if (maximumSize !== undefined && page.sessions.length > maximumSize) {
    throw new TypeError('SessionCatalog page.sessions exceeds the negotiated or requested maximum')
  }
  const sessions = page.sessions.map(validateSessionDescriptor)
  if (expectedProvider !== undefined) {
    for (const descriptor of sessions) assertProvider(descriptor.session, expectedProvider, 'SessionCatalog page.sessions[].session')
  }
  const identities = sessions.map(row => `${row.session.provider}\0${row.session.id}`)
  if (new Set(identities).size !== identities.length) throw new TypeError('SessionCatalog page.sessions contains duplicate references')
  if (page.next !== undefined) nonEmpty(page.next, 'SessionCatalog page.next')
  return freezeClone({
    catalogRevision: page.catalogRevision,
    sessions,
    ...(page.next === undefined ? {} : { next: page.next as string }),
  })
}

export function validateSessionCatalogEvent(value: unknown, expectedProvider?: string): SessionCatalogEvent {
  const event = exactRecord(value, ['type', 'beforeRevision', 'afterRevision', 'session'], ['type', 'beforeRevision', 'afterRevision'], 'SessionCatalog event')
  nonNegativeInteger(event.beforeRevision, 'SessionCatalog event.beforeRevision')
  positiveInteger(event.afterRevision, 'SessionCatalog event.afterRevision')
  if (event.afterRevision <= event.beforeRevision) throw new TypeError('SessionCatalog event revisions must increase')
  if (event.type === 'catalog-invalidated') {
    if (event.session !== undefined) throw new TypeError('catalog-invalidated event must not contain session')
    return Object.freeze({ type: event.type, beforeRevision: event.beforeRevision, afterRevision: event.afterRevision })
  }
  if (event.type === 'session-created' || event.type === 'descriptor-changed') {
    const descriptor = validateSessionDescriptor(event.session)
    if (expectedProvider !== undefined) assertProvider(descriptor.session, expectedProvider, 'SessionCatalog event.session')
    return Object.freeze({
      type: event.type,
      beforeRevision: event.beforeRevision,
      afterRevision: event.afterRevision,
      session: descriptor,
    })
  }
  if (event.type === 'session-deleted') {
    const session = validateSessionReference(event.session)
    if (expectedProvider !== undefined) assertProvider(session, expectedProvider, 'SessionCatalog event.session')
    return Object.freeze({
      type: event.type,
      beforeRevision: event.beforeRevision,
      afterRevision: event.afterRevision,
      session,
    })
  }
  throw new TypeError('SessionCatalog event.type is invalid')
}

export function validateSessionCatalogWatchProgress(value: unknown, expectedProvider?: string): SessionCatalogWatchProgress {
  const progress = exactRecord(value, ['type', 'catalogRevision', 'event'], ['type'], 'SessionCatalog.watch progress')
  if (progress.type === 'ready') {
    if (progress.event !== undefined) throw new TypeError('SessionCatalog.watch ready progress must not contain event')
    nonNegativeInteger(progress.catalogRevision, 'SessionCatalog.watch ready progress.catalogRevision')
    return Object.freeze({ type: progress.type, catalogRevision: progress.catalogRevision })
  }
  if (progress.type === 'event') {
    if (progress.catalogRevision !== undefined) throw new TypeError('SessionCatalog.watch event progress must not contain catalogRevision')
    return Object.freeze({ type: progress.type, event: validateSessionCatalogEvent(progress.event, expectedProvider) })
  }
  throw new TypeError('SessionCatalog.watch progress.type is invalid')
}

function validateCreateSessionInput(value: unknown): CreateSessionInput {
  const input = exactRecord(value, ['title', 'requestId'], ['requestId'], 'SessionCatalog.create input')
  if (input.title !== undefined) nonEmpty(input.title, 'SessionCatalog.create input.title')
  nonEmpty(input.requestId, 'SessionCatalog.create input.requestId')
  return Object.freeze({
    ...(input.title === undefined ? {} : { title: (input.title as string).trim() }),
    requestId: input.requestId,
  })
}

function validateCreateSessionResult(value: unknown, expectedProvider?: string): CreateSessionResult {
  const result = exactRecord(value, ['session'], ['session'], 'SessionCatalog.create result')
  const session = validateSessionDescriptor(result.session)
  if (expectedProvider !== undefined) assertProvider(session.session, expectedProvider, 'SessionCatalog.create result.session.session')
  return Object.freeze({ session })
}

function validateRenameSessionInput(value: unknown): RenameSessionInput {
  const input = exactRecord(value, ['session', 'title', 'expectedRevision'], ['session', 'title'], 'SessionCatalog.rename input')
  nonEmpty(input.title, 'SessionCatalog.rename input.title')
  optionalNonNegativeInteger(input.expectedRevision, 'SessionCatalog.rename input.expectedRevision')
  return Object.freeze({
    session: validateSessionReference(input.session),
    title: (input.title as string).trim(),
    ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision as number }),
  })
}

function validateDeleteSessionInput(value: unknown): DeleteSessionInput {
  const input = exactRecord(value, ['session', 'expectedRevision'], ['session'], 'SessionCatalog.delete input')
  optionalNonNegativeInteger(input.expectedRevision, 'SessionCatalog.delete input.expectedRevision')
  return Object.freeze({
    session: validateSessionReference(input.session),
    ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision as number }),
  })
}

function validateDeleteSessionResult(value: unknown): DeleteSessionResult {
  const result = exactRecord(value, ['deleted'], ['deleted'], 'SessionCatalog.delete result')
  if (typeof result.deleted !== 'boolean') throw new TypeError('SessionCatalog.delete result.deleted must be boolean')
  return Object.freeze({ deleted: result.deleted })
}

function validateCatalogLimits(value: unknown): SessionCatalogLimits {
  const limits = exactRecord(value, ['maxPageSize', 'maxWatchBuffer'], [], 'SessionCatalog limits')
  for (const [name, limit] of Object.entries(limits)) positiveInteger(limit, `SessionCatalog limits.${name}`)
  return freezeClone(limits as SessionCatalogLimits)
}

function operationList(value: unknown, label: string): readonly SessionCatalogOperation[] {
  const allowed = new Set<SessionCatalogOperation>(['list', 'get', 'create', 'rename', 'delete', 'watch'])
  const values = stringList(value, label)
  if (values.some(value => !allowed.has(value as SessionCatalogOperation))) throw new TypeError(`${label} contains an invalid operation`)
  return values as readonly SessionCatalogOperation[]
}

function concurrency(value: unknown, optional: boolean): SessionMutationConcurrency | undefined {
  if (value === undefined && optional) return undefined
  if (value !== 'serialized' && value !== 'revision-checked') throw new TypeError('SessionCatalog mutationConcurrency is invalid')
  return value
}

function ownedSessionReference(value: unknown, participantId: string, label: string): SessionReference {
  const session = validateSessionReference(value)
  assertProvider(session, participantId, label)
  return session
}

function expectedDescriptor(value: unknown, expected: SessionReference, label: string): SessionDescriptor {
  const descriptor = validateSessionDescriptor(value)
  if (!sameSession(descriptor.session, expected)) throw new TypeError(`${label} belongs to another session`)
  return descriptor
}

function assertProvider(session: SessionReference, participantId: string, label: string): void {
  if (session.provider !== participantId) throw new TypeError(`${label} belongs to another provider`)
}

function sameSession(left: SessionReference, right: SessionReference): boolean {
  return left.provider === right.provider && left.id === right.id
}

function enforceConcurrency(
  expectedRevision: number | undefined,
  mutationConcurrency: SessionMutationConcurrency,
  operation: string,
): void {
  if (mutationConcurrency === 'serialized' && expectedRevision !== undefined) {
    throw new TypeError(`SessionCatalog.${operation} does not accept expectedRevision with serialized concurrency`)
  }
}

function enforcePageLimit(requested: number | undefined, maximum: number | undefined, label: string): void {
  if (requested !== undefined && maximum !== undefined && requested > maximum) {
    throw new TypeError(`${label} exceeds the negotiated maximum`)
  }
}

function minimumDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return Math.min(left, right)
}

function validateDeclaredHandlers(
  operations: readonly SessionCatalogOperation[],
  handler: SessionCatalogHandler,
  owner: string,
): void {
  for (const operation of operations) {
    if (typeof handler[operation] !== 'function') throw new TypeError(`${owner} handler.${operation} is missing`)
  }
}

function validatedWatchContext(
  context: CapabilityHandlerContext,
  participantId: string,
  afterRevision: number | undefined,
): {
  readonly context: CapabilityHandlerContext<SessionCatalogWatchProgress>
  assertReady(): void
} {
  let revision: number | undefined
  let invalidated = false
  return Object.freeze({
    context: Object.freeze({
      ...context,
      progress(value: SessionCatalogWatchProgress) {
        const progress = validateSessionCatalogWatchProgress(value, participantId)
        if (progress.type === 'ready') {
          if (revision !== undefined) throw new TypeError('SessionCatalog.watch emitted ready more than once')
          if (afterRevision !== undefined && afterRevision > progress.catalogRevision) {
            throw new TypeError('SessionCatalog.watch ready revision precedes the requested revision')
          }
          revision = afterRevision ?? progress.catalogRevision
        } else {
          if (revision === undefined) throw new TypeError('SessionCatalog.watch must emit ready before events')
          if (invalidated) throw new TypeError('SessionCatalog.watch must end after catalog-invalidated')
          if (progress.event.beforeRevision !== revision) throw new TypeError('SessionCatalog.watch event revisions are not contiguous')
          revision = progress.event.afterRevision
          invalidated = progress.event.type === 'catalog-invalidated'
        }
        context.progress(progress)
      },
    }),
    assertReady() {
      if (revision === undefined) throw new TypeError('SessionCatalog.watch ended before ready')
    },
  })
}
