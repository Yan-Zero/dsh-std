import type {
  CapabilityClient,
  CapabilityHandlerContext,
  CapabilityImplementation,
} from '@dsh-std/connection'
import { defineCapabilityProtocol } from '@dsh-std/connection'
import type { ProtocolSupport } from '@dsh-std/core'
import type { PresentationInvocationScope, PresentationRequestContext, PresentationResult } from './index.js'

export const EXTERNAL_REDIRECT_KIND = 'ExternalRedirect'

export interface ExternalRedirectRequest extends PresentationRequestContext { readonly mode: 'http-get' }
export type ExternalRedirectInput = Omit<ExternalRedirectRequest, keyof PresentationRequestContext>

export interface ExternalRedirectReady {
  readonly type: 'ready'
  readonly redirectUri: string
  readonly expiresAt?: string
}

export interface ExternalRedirectValue {
  readonly query: Readonly<Record<string, readonly string[]>>
}

export interface ExternalRedirectCall {
  readonly invocationId: string
  readonly ready: Promise<ExternalRedirectReady>
  readonly result: Promise<PresentationResult<ExternalRedirectValue>>
  cancel(reason?: string): void
}

export interface ExternalRedirectClient {
  receive(input?: ExternalRedirectInput, options?: { readonly signal?: AbortSignal }): ExternalRedirectCall
}

export interface ExternalRedirectHandler {
  receive(
    request: ExternalRedirectRequest,
    context: CapabilityHandlerContext<ExternalRedirectReady>,
  ): PresentationResult<ExternalRedirectValue> | Promise<PresentationResult<ExternalRedirectValue>>
}

const emptySpec = (value: unknown): undefined => {
  if (value !== undefined) throw new TypeError('ExternalRedirect does not accept spec in v1alpha1')
  return undefined
}

export const externalRedirectProtocol = defineCapabilityProtocol({
  apiVersion: 'presentation.dsh/v1alpha1', kind: EXTERNAL_REDIRECT_KIND,
  validateRequirement: emptySpec, validateSupport: emptySpec,
})
export const externalRedirectSupport: ProtocolSupport = Object.freeze({
  apiVersion: 'presentation.dsh/v1alpha1', kind: EXTERNAL_REDIRECT_KIND,
})

export function externalRedirectClient(client: CapabilityClient, scope: PresentationInvocationScope): ExternalRedirectClient {
  validateScope(scope)
  return Object.freeze({
    receive(input: ExternalRedirectInput = { mode: 'http-get' }, options?: { readonly signal?: AbortSignal }) {
      const request = Object.freeze({
        ...input,
        requestId: nextRequestId(scope), invocationId: scope.invocationId, origin: scope.origin,
        ...(scope.deadline === undefined ? {} : { deadline: scope.deadline }),
      })
      validateExternalRedirectRequest(request)
      const call = client.invoke<ExternalRedirectRequest, PresentationResult<ExternalRedirectValue>, ExternalRedirectReady>(
        externalRedirectSupport, 'receive', request, options,
      )
      return Object.freeze({
        invocationId: call.invocationId,
        ready: firstReady(call.progress),
        result: call.result.then(validateExternalRedirectResult),
        cancel: (reason?: string) => call.cancel(reason),
      })
    },
  })
}

export function externalRedirectImplementation(
  participantId: string,
  handler: ExternalRedirectHandler,
): CapabilityImplementation<ExternalRedirectRequest, PresentationResult<ExternalRedirectValue>, ExternalRedirectReady> {
  return Object.freeze({
    participantId, protocol: externalRedirectSupport,
    async handle(operation: string, input: ExternalRedirectRequest, context: CapabilityHandlerContext<ExternalRedirectReady>) {
      if (operation !== 'receive') throw new TypeError(`unsupported ExternalRedirect operation ${JSON.stringify(operation)}`)
      validateExternalRedirectRequest(input)
      let announced = false
      const guardedContext: CapabilityHandlerContext<ExternalRedirectReady> = Object.freeze({
        ...context,
        progress(value: ExternalRedirectReady) {
          if (announced) throw new TypeError('ExternalRedirect provider emitted more than one ready event')
          validateExternalRedirectReady(value)
          announced = true
          context.progress(value)
        },
      })
      const result = validateExternalRedirectResult(await handler.receive(input, guardedContext))
      if (result.status === 'submitted' && !announced) {
        throw new TypeError('ExternalRedirect provider submitted a result before announcing redirectUri')
      }
      return result
    },
  })
}

export function validateExternalRedirectRequest(value: unknown): asserts value is ExternalRedirectRequest {
  const request = exactRecord(value, ['requestId', 'invocationId', 'origin', 'deadline', 'mode'], ['requestId', 'invocationId', 'origin', 'mode'], 'ExternalRedirect request')
  nonEmpty(request.requestId, 'ExternalRedirect request.requestId')
  nonEmpty(request.invocationId, 'ExternalRedirect request.invocationId')
  nonEmpty(request.origin, 'ExternalRedirect request.origin')
  if (request.mode !== 'http-get') throw new TypeError('ExternalRedirect request.mode must be "http-get"')
  dateTime(request.deadline, 'ExternalRedirect request.deadline')
}

export function validateExternalRedirectReady(value: unknown): asserts value is ExternalRedirectReady {
  const ready = exactRecord(value, ['type', 'redirectUri', 'expiresAt'], ['type', 'redirectUri'], 'ExternalRedirect ready')
  if (ready.type !== 'ready') throw new TypeError('ExternalRedirect ready.type must be "ready"')
  nonEmpty(ready.redirectUri, 'ExternalRedirect ready.redirectUri')
  const uri = new URL(ready.redirectUri as string)
  if (uri.protocol !== 'http:') throw new TypeError('ExternalRedirect ready.redirectUri must use HTTP')
  if (uri.hostname !== '127.0.0.1' && uri.hostname !== '[::1]' && uri.hostname !== 'localhost') {
    throw new TypeError('ExternalRedirect ready.redirectUri must target a loopback host')
  }
  dateTime(ready.expiresAt, 'ExternalRedirect ready.expiresAt')
}

export function validateExternalRedirectResult(value: unknown): PresentationResult<ExternalRedirectValue> {
  if (!record(value)) throw new TypeError('ExternalRedirect result must be an object')
  if (value.status === 'submitted') {
    const result = exactRecord(value, ['status', 'value'], ['status', 'value'], 'ExternalRedirect result')
    const submitted = exactRecord(result.value, ['query'], ['query'], 'ExternalRedirect value')
    if (!record(submitted.query)) throw new TypeError('ExternalRedirect value.query must be an object')
    const query: Record<string, readonly string[]> = {}
    for (const [name, entries] of Object.entries(submitted.query)) {
      if (name === '' || !Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) {
        throw new TypeError('ExternalRedirect value.query must map non-empty names to string arrays')
      }
      query[name] = Object.freeze([...entries])
    }
    return Object.freeze({ status: 'submitted', value: Object.freeze({ query: Object.freeze(query) }) })
  }
  if (value.status === 'unavailable') {
    const result = exactRecord(value, ['status', 'reason'], ['status'], 'ExternalRedirect result')
    if (result.reason !== undefined) nonEmpty(result.reason, 'ExternalRedirect result.reason')
    return Object.freeze({ status: 'unavailable', ...(result.reason === undefined ? {} : { reason: result.reason as string }) })
  }
  if (value.status === 'cancelled' || value.status === 'expired') {
    exactRecord(value, ['status'], ['status'], 'ExternalRedirect result')
    return Object.freeze({ status: value.status })
  }
  throw new TypeError('ExternalRedirect result.status is invalid')
}

async function firstReady(progress: AsyncIterable<ExternalRedirectReady>): Promise<ExternalRedirectReady> {
  for await (const value of progress) {
    validateExternalRedirectReady(value)
    return Object.freeze({ ...value })
  }
  throw new TypeError('ExternalRedirect provider completed without announcing redirectUri')
}

function validateScope(scope: PresentationInvocationScope): void {
  if (!record(scope)) throw new TypeError('Presentation invocation scope must be an object')
  nonEmpty(scope.invocationId, 'Presentation invocation scope.invocationId')
  nonEmpty(scope.origin, 'Presentation invocation scope.origin')
  dateTime(scope.deadline, 'Presentation invocation scope.deadline')
  if (typeof scope.nextRequestId !== 'function') throw new TypeError('Presentation invocation scope.nextRequestId must be a function')
}

function nextRequestId(scope: PresentationInvocationScope): string {
  const value = scope.nextRequestId()
  nonEmpty(value, 'Presentation requestId')
  return value
}

function exactRecord(value: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`)
  return value
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}
function dateTime(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) throw new TypeError(`${label} must be an RFC 3339 date-time`)
}
