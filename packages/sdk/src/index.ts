import type { ApiReference, NegotiatedProtocol } from '@dsh-std/core'
import type { ActivationContext } from '@dsh-std/lifecycle'

declare const protocolBrand: unique symbol

export interface ProtocolKey<Client> extends ApiReference {
  readonly [protocolBrand]: Client
  fromAgreement(agreement: NegotiatedProtocol, context: ActivationContext): Client
}

const protocolKeys = new WeakSet<object>()

export interface FacetModule {
  activate(context: ActivationContext): void | Promise<void>
  deactivate?(reason: string): void | Promise<void>
  snapshot?(): FacetProjection | Promise<FacetProjection>
}

export interface ExtensionStatusProjection {
  readonly apiVersion: string
  readonly kind: string
  readonly name: string
  readonly status: unknown
}

export interface FacetProjection {
  readonly state?: 'active' | 'degraded'
  readonly message?: string
  readonly extensions?: readonly ExtensionStatusProjection[]
}

export type FacetActivator = (context: ActivationContext) => void | Promise<void>

export function defineFacet(
  activate: FacetActivator,
  deactivate?: FacetModule['deactivate'],
  snapshot?: FacetModule['snapshot'],
): FacetModule {
  if (typeof activate !== 'function') throw new TypeError('facet activate must be a function')
  if (deactivate !== undefined && typeof deactivate !== 'function') throw new TypeError('facet deactivate must be a function')
  if (snapshot !== undefined && typeof snapshot !== 'function') throw new TypeError('facet snapshot must be a function')
  return Object.freeze({
    activate,
    ...(deactivate === undefined ? {} : { deactivate }),
    ...(snapshot === undefined ? {} : { snapshot }),
  })
}

export function defineProtocolKey<Client>(
  reference: ApiReference,
  fromAgreement: (agreement: NegotiatedProtocol, context: ActivationContext) => Client,
): ProtocolKey<Client> {
  if (typeof fromAgreement !== 'function') throw new TypeError('protocol key adapter must be a function')
  const key = Object.freeze({ ...reference, fromAgreement }) as ProtocolKey<Client>
  protocolKeys.add(key)
  return key
}

export function protocol<Client>(context: ActivationContext, key: ProtocolKey<Client>): Client {
  assertProtocolKey(key)
  const agreement = context.protocols.client(key)
  if (agreement === undefined) throw new Error(`required protocol ${key.apiVersion} ${key.kind} is unavailable`)
  return key.fromAgreement(agreement, context)
}

export function optionalProtocol<Client>(
  context: ActivationContext,
  key: ProtocolKey<Client>,
): { readonly available: true; readonly client: Client } | { readonly available: false } {
  assertProtocolKey(key)
  const agreement = context.protocols.client(key)
  return agreement === undefined
    ? Object.freeze({ available: false })
    : Object.freeze({ available: true, client: key.fromAgreement(agreement, context) })
}

function assertProtocolKey(value: object): void {
  if (!protocolKeys.has(value)) throw new TypeError('protocol key was not created by defineProtocolKey')
}

export type { ActivationContext } from '@dsh-std/lifecycle'
