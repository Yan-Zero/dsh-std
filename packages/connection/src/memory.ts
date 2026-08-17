import { sameProtocol, type ApiReference } from '@dsh-std/core'
import {
  ConnectionInvocationError,
  type CapabilityCall,
  type CapabilityClient,
  type CapabilityDispatch,
  type CapabilityImplementation,
  type ConnectionEndpoint,
  type StandardConnection,
} from './connection.js'
import {
  validateEndpointOffer,
  type CapabilityBinding,
  type ConnectionPlan,
  type EndpointOffer,
  type ResolveConnectionOptions,
} from './model.js'
import { resolveConnection } from './resolve.js'

export class MemoryConnectionEndpoint implements ConnectionEndpoint {
  private currentOffer: EndpointOffer
  private readonly implementations: CapabilityImplementation[] = []
  private readonly offerListeners = new Set<(offer: EndpointOffer) => void>()

  constructor(offer: EndpointOffer) {
    validateEndpointOffer(offer)
    this.currentOffer = offer
  }

  get offer(): EndpointOffer { return this.currentOffer }

  replaceOffer(offer: EndpointOffer): void {
    validateEndpointOffer(offer)
    if (offer.endpoint.instanceId !== this.currentOffer.endpoint.instanceId) throw new TypeError('replacement offer belongs to another endpoint')
    if (offer.revision <= this.currentOffer.revision) throw new TypeError('replacement offer must increase revision')
    this.currentOffer = offer
    for (const listener of this.offerListeners) listener(offer)
  }

  register(implementation: CapabilityImplementation): () => void {
    const declaration = this.currentOffer.declarations.find(row => row.participant.id === implementation.participantId)
    if (declaration === undefined || !(declaration.supports ?? []).some(row => sameProtocol(row, implementation.protocol))) {
      throw new TypeError('implementation is not backed by a live endpoint declaration')
    }
    if (this.implementations.some(row => row.participantId === implementation.participantId && sameProtocol(row.protocol, implementation.protocol))) {
      throw new TypeError('capability implementation is already registered')
    }
    const stored = Object.freeze({ ...implementation, protocol: Object.freeze({ ...implementation.protocol }) })
    this.implementations.push(stored)
    return () => {
      const index = this.implementations.indexOf(stored)
      if (index >= 0) this.implementations.splice(index, 1)
    }
  }

  async dispatch<TInput = unknown, TOutput = unknown, TProgress = unknown>(invocation: CapabilityDispatch<TInput, TProgress>): Promise<TOutput> {
    const implementation = this.implementations.find(row =>
      row.participantId === invocation.binding.provider.participantId
      && sameProtocol(row.protocol, invocation.binding.support))
    if (implementation === undefined) throw new ConnectionInvocationError('handler-missing', 'binding has no live implementation')
    return await implementation.handle(invocation.operation, invocation.input, Object.freeze({
      connectionId: invocation.connectionId,
      planRevision: invocation.planRevision,
      invocationId: invocation.invocationId,
      binding: invocation.binding,
      signal: invocation.signal,
      progress: invocation.progress,
    })) as TOutput
  }

  onOfferChange(listener: (offer: EndpointOffer) => void): () => void {
    this.offerListeners.add(listener)
    return () => { this.offerListeners.delete(listener) }
  }
}

export interface MemoryConnectionPair {
  readonly left: StandardConnection
  readonly right: StandardConnection
  readonly plan: ConnectionPlan
  renegotiate(options: ResolveConnectionOptions): ConnectionPlan
  close(reason?: string): void
}

export function createMemoryConnectionPair(
  left: MemoryConnectionEndpoint, right: MemoryConnectionEndpoint, options: ResolveConnectionOptions,
): MemoryConnectionPair {
  return new MemoryPair(left, right, options)
}

class MemoryPair implements MemoryConnectionPair {
  private currentPlan: ConnectionPlan
  private closed = false
  private invocationSequence = 0
  private readonly listeners = new Set<(plan: ConnectionPlan) => void>()
  private readonly active = new Map<string, (reason?: string, code?: 'cancelled' | 'connection-closed') => void>()
  readonly left: StandardConnection
  readonly right: StandardConnection

  constructor(
    private readonly leftEndpoint: MemoryConnectionEndpoint,
    private readonly rightEndpoint: MemoryConnectionEndpoint,
    options: ResolveConnectionOptions,
  ) {
    this.currentPlan = resolveConnection(leftEndpoint.offer, rightEndpoint.offer, options)
    this.left = new MemoryConnectionView(this, leftEndpoint, rightEndpoint)
    this.right = new MemoryConnectionView(this, rightEndpoint, leftEndpoint)
  }

  get plan(): ConnectionPlan { return this.currentPlan }

  renegotiate(options: ResolveConnectionOptions): ConnectionPlan {
    this.assertOpen()
    if (options.connectionId !== this.currentPlan.connectionId || options.revision <= this.currentPlan.revision) {
      throw new TypeError('renegotiation must retain connectionId and increase revision')
    }
    this.currentPlan = resolveConnection(this.leftEndpoint.offer, this.rightEndpoint.offer, options)
    for (const listener of this.listeners) listener(this.currentPlan)
    return this.currentPlan
  }

  subscribe(listener: (plan: ConnectionPlan) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  binding(local: MemoryConnectionEndpoint, participantId: string, reference: ApiReference): CapabilityBinding | undefined {
    return this.currentPlan.bindings.find(binding =>
      binding.consumer.endpoint.instanceId === local.offer.endpoint.instanceId
      && binding.consumer.participantId === participantId
      && sameProtocol(binding.requirement, reference))
  }

  invoke<TInput, TOutput, TProgress>(
    local: MemoryConnectionEndpoint,
    participantId: string,
    reference: ApiReference,
    operation: string,
    input: TInput,
    signal?: AbortSignal,
  ): CapabilityCall<TOutput, TProgress> {
    this.assertOpen()
    signal?.throwIfAborted()
    const binding = this.binding(local, participantId, reference)
    if (binding === undefined) throw new ConnectionInvocationError('capability-unbound', `participant ${JSON.stringify(participantId)} has no binding`)
    const target = binding.provider.endpoint.instanceId === this.leftEndpoint.offer.endpoint.instanceId
      ? this.leftEndpoint
      : binding.provider.endpoint.instanceId === this.rightEndpoint.offer.endpoint.instanceId ? this.rightEndpoint : undefined
    if (target === undefined) throw new ConnectionInvocationError('handler-missing', 'binding provider endpoint is unavailable')
    const invocationId = `${local.offer.endpoint.instanceId}:${String(++this.invocationSequence)}`
    const controller = new AbortController()
    const progress = new AsyncProgress<TProgress>()
    let settled = false
    let resolveResult!: (value: TOutput | PromiseLike<TOutput>) => void
    let rejectResult!: (reason?: unknown) => void
    const result = new Promise<TOutput>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    const finish = () => { settled = true; this.active.delete(invocationId); progress.close() }
    const cancel = (reason = 'capability invocation cancelled', code: 'cancelled' | 'connection-closed' = 'cancelled') => {
      if (settled) return
      controller.abort(reason)
      finish()
      rejectResult(new ConnectionInvocationError(code, reason))
    }
    this.active.set(invocationId, cancel)
    if (signal !== undefined) signal.addEventListener('abort', () => cancel(abortMessage(signal)), { once: true })
    queueMicrotask(() => {
      if (settled) return
      Promise.resolve(target.dispatch<TInput, TOutput, TProgress>({
        connectionId: this.currentPlan.connectionId,
        planRevision: binding.planRevision,
        invocationId,
        binding,
        operation,
        input,
        signal: controller.signal,
        progress: value => { if (!settled) progress.push(value) },
      })).then(value => { if (!settled) { finish(); resolveResult(value) } }, error => {
        if (!settled) { finish(); rejectResult(error) }
      })
    })
    return Object.freeze({ invocationId, result, progress, cancel })
  }

  close(reason = 'connection closed'): void {
    if (this.closed) return
    this.closed = true
    for (const cancel of this.active.values()) cancel(reason, 'connection-closed')
    this.active.clear()
    this.listeners.clear()
  }

  private assertOpen(): void {
    if (this.closed) throw new ConnectionInvocationError('connection-closed', 'connection is closed')
  }
}

class MemoryConnectionView implements StandardConnection {
  constructor(
    private readonly pair: MemoryPair,
    private readonly localEndpoint: MemoryConnectionEndpoint,
    private readonly remoteEndpoint: MemoryConnectionEndpoint,
  ) {}

  get id(): string { return this.pair.plan.connectionId }
  get local() { return this.localEndpoint.offer.endpoint }
  get remote() { return this.remoteEndpoint.offer.endpoint }
  get plan() { return this.pair.plan }

  client(participantId: string): CapabilityClient {
    nonEmpty(participantId, 'participantId')
    return Object.freeze({
      participantId,
      binding: (reference: ApiReference) => this.pair.binding(this.localEndpoint, participantId, reference),
      invoke: <TInput, TOutput, TProgress>(
        reference: ApiReference, operation: string, input: TInput, options?: { readonly signal?: AbortSignal },
      ) => this.pair.invoke<TInput, TOutput, TProgress>(this.localEndpoint, participantId, reference, operation, input, options?.signal),
    })
  }

  onPlanChange(listener: (plan: ConnectionPlan) => void): () => void { return this.pair.subscribe(listener) }
  close(reason?: string): void { this.pair.close(reason) }
}

class AsyncProgress<T> implements AsyncIterableIterator<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private done = false
  push(value: T): void {
    if (this.done) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.values.push(value)
    else waiter({ done: false, value })
  }
  close(): void {
    if (this.done) return
    this.done = true
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined })
  }
  next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) return Promise.resolve({ done: false, value: this.values.shift() as T })
    if (this.done) return Promise.resolve({ done: true, value: undefined })
    return new Promise(resolve => { this.waiters.push(resolve) })
  }
  return(): Promise<IteratorResult<T>> { this.close(); return Promise.resolve({ done: true, value: undefined }) }
  [Symbol.asyncIterator](): AsyncIterableIterator<T> { return this }
}

function abortMessage(signal: AbortSignal): string {
  return signal.reason instanceof Error ? signal.reason.message : typeof signal.reason === 'string' ? signal.reason : 'capability invocation cancelled'
}

function nonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be non-empty`)
}
