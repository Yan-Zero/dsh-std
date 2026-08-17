import type { ApiReference, ProtocolSupport } from '@dsh-std/core'
import type { CapabilityBinding, ConnectionEndpointReference, ConnectionPlan, EndpointOffer } from './model.js'

export interface CapabilityHandlerContext<TProgress = unknown> {
  readonly connectionId: string
  readonly planRevision: number
  readonly invocationId: string
  readonly binding: CapabilityBinding
  readonly signal: AbortSignal
  progress(value: TProgress): void
}

export type CapabilityHandler<TInput = unknown, TOutput = unknown, TProgress = unknown> = (
  operation: string, input: TInput, context: CapabilityHandlerContext<TProgress>,
) => TOutput | Promise<TOutput>

export interface CapabilityImplementation<TInput = unknown, TOutput = unknown, TProgress = unknown> {
  readonly participantId: string
  readonly protocol: ProtocolSupport
  readonly handle: CapabilityHandler<TInput, TOutput, TProgress>
}

export interface CapabilityDispatch<TInput = unknown, TProgress = unknown> {
  readonly connectionId: string
  readonly planRevision: number
  readonly invocationId: string
  readonly binding: CapabilityBinding
  readonly operation: string
  readonly input: TInput
  readonly signal: AbortSignal
  progress(value: TProgress): void
}

export interface ConnectionEndpoint {
  readonly offer: EndpointOffer
  dispatch<TInput = unknown, TOutput = unknown, TProgress = unknown>(invocation: CapabilityDispatch<TInput, TProgress>): Promise<TOutput>
  onOfferChange(listener: (offer: EndpointOffer) => void): () => void
}

export interface CapabilityCall<TOutput = unknown, TProgress = unknown> {
  readonly invocationId: string
  readonly result: Promise<TOutput>
  readonly progress: AsyncIterable<TProgress>
  cancel(reason?: string): void
}

export interface CapabilityClient {
  readonly participantId: string
  binding(reference: ApiReference): CapabilityBinding | undefined
  invoke<TInput = unknown, TOutput = unknown, TProgress = unknown>(
    reference: ApiReference,
    operation: string,
    input: TInput,
    options?: { readonly signal?: AbortSignal },
  ): CapabilityCall<TOutput, TProgress>
}

export interface StandardConnection {
  readonly id: string
  readonly local: ConnectionEndpointReference
  readonly remote: ConnectionEndpointReference
  readonly plan: ConnectionPlan
  client(participantId: string): CapabilityClient
  onPlanChange(listener: (plan: ConnectionPlan) => void): () => void
  close(reason?: string): void | Promise<void>
}

export class ConnectionInvocationError extends Error {
  constructor(
    readonly code: 'connection-closed' | 'capability-unbound' | 'handler-missing' | 'cancelled' | 'handler-failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ConnectionInvocationError'
  }
}
