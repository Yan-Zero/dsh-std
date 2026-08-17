import type { ProtocolCatalog } from '@dsh-std/core'
import type { ManifestDefinitionCatalog } from '@dsh-std/manifest'
import { registerWorkspaceCatalog } from './catalog.js'
import { registerWorkspaceSessions } from './sessions.js'

export const API_VERSION = 'workspace.dsh/v1alpha1'

export interface WorkspaceReference { readonly provider: string; readonly id: string }
export interface WorkspaceDomainReference { readonly id: string }
export interface WorkspaceLocator { readonly kind: string; readonly spec: unknown }
export interface FileWorkspaceLocator extends WorkspaceLocator { readonly kind: 'file'; readonly spec: { readonly path: string } }
export interface WorkspaceLocation { readonly kind: string; readonly display: string; readonly canonical?: WorkspaceLocator }
export type WorkspaceState = 'available' | 'missing' | 'inaccessible' | 'unknown'
export interface WorkspaceDescriptor {
  readonly workspace: WorkspaceReference
  readonly title: string
  readonly location: WorkspaceLocation
  readonly state: WorkspaceState
  readonly revision: number
  readonly createdAt?: string
  readonly updatedAt?: string
}

export function validateWorkspaceReference(value: unknown): WorkspaceReference {
  const reference = exactRecord(value, ['provider', 'id'], ['provider', 'id'], 'WorkspaceReference')
  nonEmpty(reference.provider, 'WorkspaceReference.provider'); nonEmpty(reference.id, 'WorkspaceReference.id')
  return Object.freeze({ provider: reference.provider as string, id: reference.id as string })
}

export function validateWorkspaceLocator(value: unknown): WorkspaceLocator {
  const locator = exactRecord(value, ['kind', 'spec'], ['kind', 'spec'], 'WorkspaceLocator')
  nonEmpty(locator.kind, 'WorkspaceLocator.kind')
  if (locator.kind === 'file') {
    const spec = exactRecord(locator.spec, ['path'], ['path'], 'FileWorkspaceLocator.spec')
    nonEmpty(spec.path, 'FileWorkspaceLocator.spec.path')
  }
  return freezeClone(value as WorkspaceLocator)
}

export function validateWorkspaceDescriptor(value: unknown): WorkspaceDescriptor {
  const descriptor = exactRecord(value, ['workspace', 'title', 'location', 'state', 'revision', 'createdAt', 'updatedAt'], ['workspace', 'title', 'location', 'state', 'revision'], 'WorkspaceDescriptor')
  validateWorkspaceReference(descriptor.workspace); nonEmpty(descriptor.title, 'WorkspaceDescriptor.title')
  const location = exactRecord(descriptor.location, ['kind', 'display', 'canonical'], ['kind', 'display'], 'WorkspaceLocation')
  nonEmpty(location.kind, 'WorkspaceLocation.kind'); nonEmpty(location.display, 'WorkspaceLocation.display')
  if (location.canonical !== undefined) validateWorkspaceLocator(location.canonical)
  if (!['available', 'missing', 'inaccessible', 'unknown'].includes(descriptor.state as string)) throw new TypeError('WorkspaceDescriptor.state is invalid')
  nonNegativeInteger(descriptor.revision, 'WorkspaceDescriptor.revision')
  dateTime(descriptor.createdAt, 'WorkspaceDescriptor.createdAt'); dateTime(descriptor.updatedAt, 'WorkspaceDescriptor.updatedAt')
  return freezeClone(value as WorkspaceDescriptor)
}

export function exactRecord(value: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`)
  return value
}
export function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
export function nonEmpty(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`) }
export function nonNegativeInteger(value: unknown, label: string): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative safe integer`) }
export function dateTime(value: unknown, label: string): void { if (value !== undefined && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) throw new TypeError(`${label} must be an RFC 3339 date-time`) }
export function freezeClone<T>(value: T): T { return deepFreeze(structuredClone(value)) }
function deepFreeze<T>(value: T): T { if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value }

export * from './catalog.js'
export * from './sessions.js'

export function register(protocols: ProtocolCatalog, manifest?: ManifestDefinitionCatalog): () => void {
  const disposers = [registerWorkspaceCatalog(protocols, manifest), registerWorkspaceSessions(protocols)]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
