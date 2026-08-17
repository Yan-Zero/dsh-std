import {
  defineProtocolDeclaration,
  sameProtocol,
  type ProtocolDeclaration,
  type ProtocolSupport,
} from '@dsh-std/core'
import {
  ConnectionInvocationError,
  type CapabilityDispatch,
  type CapabilityImplementation,
  type ConnectionEndpoint,
} from './connection.js'
import { createEndpointOffer, type EndpointIdentity, type EndpointOffer } from './model.js'

export interface EndpointPublication {
  readonly declaration: ProtocolDeclaration
  readonly implementations?: readonly CapabilityImplementation[]
}

export interface EndpointRuntimeOptions extends EndpointIdentity {
  readonly revision?: number
}

export class StandardEndpointRuntime implements ConnectionEndpoint {
  private readonly declarations = new Map<string, ProtocolDeclaration>()
  private readonly implementations: CapabilityImplementation[] = []
  private readonly listeners = new Set<(offer: EndpointOffer) => void>()
  private readonly identity: EndpointIdentity
  private revision: number
  private currentOffer: EndpointOffer

  constructor(options: EndpointRuntimeOptions) {
    this.identity = Object.freeze({ id: options.id, instanceId: options.instanceId })
    this.revision = options.revision ?? 0
    this.currentOffer = this.createOffer()
  }

  get offer(): EndpointOffer { return this.currentOffer }

  register(publication: EndpointPublication): () => void {
    const declaration = defineProtocolDeclaration(publication.declaration)
    const participantId = declaration.participant.id
    if (this.declarations.has(participantId)) throw new Error(`participant ${JSON.stringify(participantId)} is already registered`)
    const implementations = [...(publication.implementations ?? [])]
    const implemented = new Set<string>()
    for (const implementation of implementations) {
      if (implementation.participantId !== participantId) throw new TypeError(`implementation participantId must be ${JSON.stringify(participantId)}`)
      if (!(declaration.supports ?? []).some(support => sameProtocol(support, implementation.protocol))) {
        throw new TypeError(`participant implementation ${implementation.protocol.apiVersion} ${implementation.protocol.kind} is not declared live`)
      }
      const key = `${implementation.protocol.apiVersion}\0${implementation.protocol.kind}`
      if (implemented.has(key)) throw new TypeError(`participant has multiple implementations for ${implementation.protocol.apiVersion} ${implementation.protocol.kind}`)
      implemented.add(key)
    }
    const stored = implementations.map(implementation => Object.freeze({
      ...implementation, protocol: Object.freeze({ ...implementation.protocol }),
      handle: implementation.handle as CapabilityImplementation['handle'],
    }))
    this.declarations.set(participantId, declaration)
    this.implementations.push(...stored)
    this.publishOffer()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.declarations.get(participantId) === declaration) this.declarations.delete(participantId)
      for (const implementation of stored) {
        const index = this.implementations.indexOf(implementation)
        if (index >= 0) this.implementations.splice(index, 1)
      }
      this.publishOffer()
    }
  }

  async dispatch<TInput = unknown, TOutput = unknown, TProgress = unknown>(invocation: CapabilityDispatch<TInput, TProgress>): Promise<TOutput> {
    validateDispatch(invocation, this.currentOffer)
    const implementation = this.implementations.find(candidate =>
      candidate.participantId === invocation.binding.provider.participantId
      && sameProtocol(candidate.protocol, invocation.binding.support))
    if (implementation === undefined) throw new ConnectionInvocationError('handler-missing', `binding ${JSON.stringify(invocation.binding.bindingId)} has no live implementation`)
    try {
      return await implementation.handle(invocation.operation, invocation.input, Object.freeze({
        connectionId: invocation.connectionId,
        planRevision: invocation.planRevision,
        invocationId: invocation.invocationId,
        binding: invocation.binding,
        signal: invocation.signal,
        progress: invocation.progress,
      })) as TOutput
    } catch (error) {
      if (error instanceof ConnectionInvocationError) throw error
      throw new ConnectionInvocationError('handler-failed', error instanceof Error ? error.message : String(error), { cause: error })
    }
  }

  onOfferChange(listener: (offer: EndpointOffer) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private createOffer(): EndpointOffer {
    return createEndpointOffer(this.identity, this.revision, [...this.declarations.values()])
  }

  private publishOffer(): void {
    this.revision += 1
    this.currentOffer = this.createOffer()
    for (const listener of this.listeners) listener(this.currentOffer)
  }
}

function validateDispatch(invocation: CapabilityDispatch, offer: EndpointOffer): void {
  if (invocation.connectionId.trim() === '') throw new TypeError('connectionId must be non-empty')
  if (!Number.isSafeInteger(invocation.planRevision) || invocation.planRevision < 1) throw new TypeError('planRevision must be positive')
  if (invocation.binding.planRevision !== invocation.planRevision) throw new ConnectionInvocationError('capability-unbound', 'binding belongs to another plan revision')
  if (invocation.binding.provider.endpoint.instanceId !== offer.endpoint.instanceId) throw new ConnectionInvocationError('capability-unbound', 'binding provider belongs to another endpoint')
  if (invocation.invocationId.trim() === '' || invocation.operation.trim() === '') throw new TypeError('invocationId and operation must be non-empty')
  invocation.signal.throwIfAborted()
}
