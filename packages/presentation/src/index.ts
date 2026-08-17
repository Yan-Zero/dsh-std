import type { ProtocolCatalog, ProtocolDefinition } from '@dsh-std/core'
import { defineCapabilityProtocol } from '@dsh-std/connection'

export const API_VERSION = 'presentation.dsh/v1alpha1'

export type Operation =
  | { readonly apiVersion: typeof API_VERSION; readonly kind: 'OpenExternal'; readonly uri: string }
  | { readonly apiVersion: typeof API_VERSION; readonly kind: 'CopyText'; readonly text: string }
  | {
      readonly apiVersion: typeof API_VERSION
      readonly kind: 'Notification'
      readonly text: string
      readonly level?: 'info' | 'warning' | 'error'
    }

export const protocols: readonly ProtocolDefinition[] = Object.freeze(
  ['OpenExternal', 'CopyText', 'Notification'].map(kind => defineCapabilityProtocol({ apiVersion: API_VERSION, kind })),
)

export function register(catalog: ProtocolCatalog): () => void {
  const disposers = protocols.map(protocol => catalog.register(protocol))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

/** Validate an invocation-scoped operation before a transport forwards it. */
export function validateOperation(operation: Operation): void {
  if (operation.apiVersion !== API_VERSION) throw new TypeError(`unsupported presentation apiVersion ${JSON.stringify(operation.apiVersion)}`)
  if (operation.kind === 'OpenExternal') {
    const uri = new URL(operation.uri)
    if (uri.protocol !== 'https:' && uri.protocol !== 'http:') throw new TypeError('OpenExternal only accepts HTTP(S) URIs')
    return
  }
  if (operation.kind === 'CopyText') {
    text(operation.text, 'CopyText.text')
    return
  }
  text(operation.text, 'Notification.text')
  if (operation.level !== undefined && !['info', 'warning', 'error'].includes(operation.level)) {
    throw new TypeError('Notification.level is invalid')
  }
}

function text(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}
