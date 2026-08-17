import type { CapabilityCall, CapabilityClient, CapabilityHandlerContext, CapabilityImplementation } from '@dsh-std/connection'
import type { ProtocolCatalog, ProtocolDefinition, ProtocolNegotiationInput, ProtocolSupport } from '@dsh-std/core'
import { validateSessionReference, type SessionReference } from '@dsh-std/session'
import { exactRecord, freezeClone, nonEmpty, nonNegativeInteger, validateWorkspaceReference, type WorkspaceReference } from './index.js'
import { negotiateWorkspaceCapability } from './negotiation.js'

const WORKSPACE_API_VERSION = 'workspace.dsh/v1alpha1'

export const WORKSPACE_SESSIONS_KIND = 'WorkspaceSessions'
export type WorkspaceSessionsOperation = 'list' | 'attach' | 'detach' | 'reorder' | 'watch'
export interface WorkspaceSessionsRequirementSpec {
  readonly operations: readonly WorkspaceSessionsOperation[]
  readonly optionalOperations?: readonly WorkspaceSessionsOperation[]
  readonly workspaceDomain?: string
  readonly sessionDomain?: string
  readonly mutationConcurrency?: 'serialized' | 'revision-checked'
}
export interface WorkspaceSessionsSupportSpec {
  readonly workspaceDomain: string
  readonly sessionDomain: string
  readonly operations: readonly WorkspaceSessionsOperation[]
  readonly mutationConcurrency: 'serialized' | 'revision-checked'
}
export interface WorkspaceSessionSnapshot { readonly workspace: WorkspaceReference; readonly revision: number; readonly sessions: readonly SessionReference[] }
export interface AttachWorkspaceSessionInput { readonly workspace: WorkspaceReference; readonly session: SessionReference; readonly expectedRevision?: number }
export type DetachWorkspaceSessionInput = AttachWorkspaceSessionInput
export interface ReorderWorkspaceSessionInput { readonly workspace: WorkspaceReference; readonly session: SessionReference; readonly before?: SessionReference; readonly expectedRevision?: number }
export interface WorkspaceSessionsEvent { readonly type: 'attached' | 'detached' | 'reordered' | 'invalidated'; readonly beforeRevision: number; readonly afterRevision: number; readonly workspace: WorkspaceReference; readonly session?: SessionReference }
interface CallOptions { readonly signal?: AbortSignal }
export interface WorkspaceSessionsClient {
  list(workspace: WorkspaceReference, options?: CallOptions): CapabilityCall<WorkspaceSessionSnapshot>
  attach(input: AttachWorkspaceSessionInput, options?: CallOptions): CapabilityCall<WorkspaceSessionSnapshot>
  detach(input: DetachWorkspaceSessionInput, options?: CallOptions): CapabilityCall<WorkspaceSessionSnapshot>
  reorder(input: ReorderWorkspaceSessionInput, options?: CallOptions): CapabilityCall<WorkspaceSessionSnapshot>
  watch(workspace: WorkspaceReference, options?: CallOptions): CapabilityCall<WorkspaceSessionSnapshot, WorkspaceSessionsEvent>
}
export interface WorkspaceSessionsHandler {
  list(workspace: WorkspaceReference, context: CapabilityHandlerContext): WorkspaceSessionSnapshot | Promise<WorkspaceSessionSnapshot>
  attach?(input: AttachWorkspaceSessionInput, context: CapabilityHandlerContext): WorkspaceSessionSnapshot | Promise<WorkspaceSessionSnapshot>
  detach?(input: DetachWorkspaceSessionInput, context: CapabilityHandlerContext): WorkspaceSessionSnapshot | Promise<WorkspaceSessionSnapshot>
  reorder?(input: ReorderWorkspaceSessionInput, context: CapabilityHandlerContext): WorkspaceSessionSnapshot | Promise<WorkspaceSessionSnapshot>
  watch?(workspace: WorkspaceReference, context: CapabilityHandlerContext<WorkspaceSessionsEvent>): WorkspaceSessionSnapshot | Promise<WorkspaceSessionSnapshot>
}

export const workspaceSessionsProtocol: ProtocolDefinition<WorkspaceSessionsRequirementSpec, WorkspaceSessionsSupportSpec> = Object.freeze({
  apiVersion: WORKSPACE_API_VERSION, kind: WORKSPACE_SESSIONS_KIND,
  validateRequirement: validateWorkspaceSessionsRequirement,
  validateSupport: validateWorkspaceSessionsSupport,
  negotiate(input: ProtocolNegotiationInput<WorkspaceSessionsRequirementSpec, WorkspaceSessionsSupportSpec>) {
    return negotiateWorkspaceCapability<WorkspaceSessionsRequirementSpec, WorkspaceSessionsSupportSpec>(input, {
    kind: WORKSPACE_SESSIONS_KIND,
    compatible(requirement, support) {
      return requirement.operations.every(operation => support.operations.includes(operation))
        && (requirement.workspaceDomain === undefined || requirement.workspaceDomain === support.workspaceDomain)
        && (requirement.sessionDomain === undefined || requirement.sessionDomain === support.sessionDomain)
        && (requirement.mutationConcurrency === undefined || requirement.mutationConcurrency === support.mutationConcurrency)
    },
    })
  },
})
export function workspaceSessionsSupport(spec: WorkspaceSessionsSupportSpec): ProtocolSupport<WorkspaceSessionsSupportSpec> { return Object.freeze({ apiVersion: WORKSPACE_API_VERSION, kind: WORKSPACE_SESSIONS_KIND, spec: validateWorkspaceSessionsSupport(spec) }) }
export function workspaceSessions(client: CapabilityClient): WorkspaceSessionsClient {
  const reference = { apiVersion: WORKSPACE_API_VERSION, kind: WORKSPACE_SESSIONS_KIND }
  return Object.freeze({
    list: (workspace: WorkspaceReference, options?: CallOptions) => client.invoke(reference, 'list', validateWorkspaceReference(workspace), options) as CapabilityCall<WorkspaceSessionSnapshot>,
    attach: (input: AttachWorkspaceSessionInput, options?: CallOptions) => client.invoke(reference, 'attach', validateMembershipInput(input, 'attach'), options) as CapabilityCall<WorkspaceSessionSnapshot>,
    detach: (input: DetachWorkspaceSessionInput, options?: CallOptions) => client.invoke(reference, 'detach', validateMembershipInput(input, 'detach'), options) as CapabilityCall<WorkspaceSessionSnapshot>,
    reorder: (input: ReorderWorkspaceSessionInput, options?: CallOptions) => client.invoke(reference, 'reorder', validateReorderInput(input), options) as CapabilityCall<WorkspaceSessionSnapshot>,
    watch: (workspace: WorkspaceReference, options?: CallOptions) => client.invoke(reference, 'watch', validateWorkspaceReference(workspace), options) as CapabilityCall<WorkspaceSessionSnapshot, WorkspaceSessionsEvent>,
  })
}
export function workspaceSessionsImplementation(participantId: string, spec: WorkspaceSessionsSupportSpec, handler: WorkspaceSessionsHandler): CapabilityImplementation {
  const support = workspaceSessionsSupport(spec)
  return Object.freeze({
    participantId, protocol: support,
    async handle(operation: string, input: unknown, context: CapabilityHandlerContext) {
      if (!spec.operations.includes(operation as WorkspaceSessionsOperation)) throw new TypeError(`WorkspaceSessions operation ${JSON.stringify(operation)} was not declared`)
      if (operation === 'list') return validateSnapshot(await handler.list(validateWorkspaceReference(input), context))
      if (operation === 'attach') return validateSnapshot(await requireHandler(handler.attach, operation)(validateMembershipInput(input, operation), context))
      if (operation === 'detach') return validateSnapshot(await requireHandler(handler.detach, operation)(validateMembershipInput(input, operation), context))
      if (operation === 'reorder') return validateSnapshot(await requireHandler(handler.reorder, operation)(validateReorderInput(input), context))
      if (operation === 'watch') return validateSnapshot(await requireHandler(handler.watch, operation)(validateWorkspaceReference(input), context as CapabilityHandlerContext<WorkspaceSessionsEvent>))
      throw new TypeError(`unsupported WorkspaceSessions operation ${JSON.stringify(operation)}`)
    },
  })
}
export function registerWorkspaceSessions(protocols: ProtocolCatalog): () => void { return protocols.register(workspaceSessionsProtocol) }

export function validateWorkspaceSessionsRequirement(value: unknown): WorkspaceSessionsRequirementSpec {
  const spec = exactRecord(value, ['operations', 'optionalOperations', 'workspaceDomain', 'sessionDomain', 'mutationConcurrency'], ['operations'], 'WorkspaceSessions requirement spec')
  const operations = operationList(spec.operations, 'WorkspaceSessions requirement spec.operations')
  const optionalOperations = spec.optionalOperations === undefined ? undefined : operationList(spec.optionalOperations, 'WorkspaceSessions requirement spec.optionalOperations')
  if (optionalOperations?.some(operation => operations.includes(operation))) throw new TypeError('WorkspaceSessions optionalOperations duplicates required operations')
  if (spec.workspaceDomain !== undefined) nonEmpty(spec.workspaceDomain, 'WorkspaceSessions requirement spec.workspaceDomain')
  if (spec.sessionDomain !== undefined) nonEmpty(spec.sessionDomain, 'WorkspaceSessions requirement spec.sessionDomain')
  const mutationConcurrency = concurrency(spec.mutationConcurrency, true)
  return freezeClone({ operations, ...(optionalOperations === undefined ? {} : { optionalOperations }), ...(spec.workspaceDomain === undefined ? {} : { workspaceDomain: spec.workspaceDomain as string }), ...(spec.sessionDomain === undefined ? {} : { sessionDomain: spec.sessionDomain as string }), ...(mutationConcurrency === undefined ? {} : { mutationConcurrency }) })
}
export function validateWorkspaceSessionsSupport(value: unknown): WorkspaceSessionsSupportSpec {
  const spec = exactRecord(value, ['workspaceDomain', 'sessionDomain', 'operations', 'mutationConcurrency'], ['workspaceDomain', 'sessionDomain', 'operations', 'mutationConcurrency'], 'WorkspaceSessions support spec')
  nonEmpty(spec.workspaceDomain, 'WorkspaceSessions support spec.workspaceDomain'); nonEmpty(spec.sessionDomain, 'WorkspaceSessions support spec.sessionDomain')
  return freezeClone({ workspaceDomain: spec.workspaceDomain as string, sessionDomain: spec.sessionDomain as string, operations: operationList(spec.operations, 'WorkspaceSessions support spec.operations'), mutationConcurrency: concurrency(spec.mutationConcurrency, false)! })
}
function validateMembershipInput(value: unknown, operation: string): AttachWorkspaceSessionInput { const input = exactRecord(value, ['workspace', 'session', 'expectedRevision'], ['workspace', 'session'], `WorkspaceSessions.${operation} input`); optionalRevision(input.expectedRevision, `WorkspaceSessions.${operation} input.expectedRevision`); return freezeClone({ workspace: validateWorkspaceReference(input.workspace), session: validateSessionReference(input.session), ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision as number }) }) }
function validateReorderInput(value: unknown): ReorderWorkspaceSessionInput { const input = exactRecord(value, ['workspace', 'session', 'before', 'expectedRevision'], ['workspace', 'session'], 'WorkspaceSessions.reorder input'); optionalRevision(input.expectedRevision, 'WorkspaceSessions.reorder input.expectedRevision'); return freezeClone({ workspace: validateWorkspaceReference(input.workspace), session: validateSessionReference(input.session), ...(input.before === undefined ? {} : { before: validateSessionReference(input.before) }), ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision as number }) }) }
function validateSnapshot(value: unknown): WorkspaceSessionSnapshot { const snapshot = exactRecord(value, ['workspace', 'revision', 'sessions'], ['workspace', 'revision', 'sessions'], 'WorkspaceSession snapshot'); nonNegativeInteger(snapshot.revision, 'WorkspaceSession snapshot.revision'); if (!Array.isArray(snapshot.sessions)) throw new TypeError('WorkspaceSession snapshot.sessions must be an array'); return Object.freeze({ workspace: validateWorkspaceReference(snapshot.workspace), revision: snapshot.revision, sessions: Object.freeze(snapshot.sessions.map(validateSessionReference)) }) }
function operationList(value: unknown, label: string): readonly WorkspaceSessionsOperation[] { const allowed = new Set(['list', 'attach', 'detach', 'reorder', 'watch']); if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array`); for (const row of value) if (typeof row !== 'string' || !allowed.has(row)) throw new TypeError(`${label} contains an invalid operation`); if (new Set(value).size !== value.length) throw new TypeError(`${label} contains duplicates`); return Object.freeze([...value]) as readonly WorkspaceSessionsOperation[] }
function concurrency(value: unknown, optional: boolean): 'serialized' | 'revision-checked' | undefined { if (value === undefined && optional) return undefined; if (value !== 'serialized' && value !== 'revision-checked') throw new TypeError('mutationConcurrency is invalid'); return value }
function optionalRevision(value: unknown, label: string): void { if (value !== undefined) nonNegativeInteger(value, label) }
function requireHandler<T extends Function>(value: T | undefined, operation: string): T { if (value === undefined) throw new TypeError(`WorkspaceSessions handler.${operation} is missing`); return value }
