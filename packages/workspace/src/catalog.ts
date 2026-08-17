import type { CapabilityCall, CapabilityClient, CapabilityHandlerContext, CapabilityImplementation } from '@dsh-std/connection'
import type { ProtocolCatalog, ProtocolDefinition, ProtocolNegotiationInput, ProtocolSupport } from '@dsh-std/core'
import type { ManifestDefinitionCatalog, ManifestExtension } from '@dsh-std/manifest'
import {
  exactRecord,
  freezeClone,
  nonEmpty,
  nonNegativeInteger,
  validateWorkspaceDescriptor,
  validateWorkspaceLocator,
  validateWorkspaceReference,
  type WorkspaceDescriptor,
  type WorkspaceLocation,
  type WorkspaceLocator,
  type WorkspaceReference,
} from './index.js'
import { negotiateWorkspaceCapability } from './negotiation.js'

const WORKSPACE_API_VERSION = 'workspace.dsh/v1alpha1'

export const WORKSPACE_PROVIDER_KIND = 'WorkspaceProvider'
export const WORKSPACE_CATALOG_KIND = 'WorkspaceCatalog'

export type WorkspaceCatalogOperation = 'list' | 'get' | 'resolve' | 'register' | 'rename' | 'unregister' | 'reorder' | 'status' | 'watch'
export type WorkspaceMutationConcurrency = 'serialized' | 'revision-checked'

export interface WorkspaceCatalogRequirementSpec {
  readonly operations: readonly WorkspaceCatalogOperation[]
  readonly optionalOperations?: readonly WorkspaceCatalogOperation[]
  readonly workspaceDomain?: string
  readonly locatorKinds?: readonly string[]
  readonly mutationConcurrency?: WorkspaceMutationConcurrency
}

export interface WorkspaceCatalogLimits {
  readonly maxWorkspaces?: number
  readonly maxLocatorLength?: number
  readonly maxWatchBuffer?: number
}

export interface WorkspaceCatalogSupportSpec {
  readonly workspaceDomain: string
  readonly operations: readonly WorkspaceCatalogOperation[]
  readonly locatorKinds: readonly string[]
  readonly mutationConcurrency: WorkspaceMutationConcurrency
  readonly limits?: WorkspaceCatalogLimits
}

/** A portable plugin contribution from which a host may compose its WorkspaceCatalog. */
export interface WorkspaceProviderSpec extends WorkspaceCatalogSupportSpec {
  readonly title: string
}

export type WorkspaceProviderResource = ManifestExtension<WorkspaceProviderSpec>

export interface WorkspaceCatalogSnapshot { readonly catalogRevision: number; readonly workspaces: readonly WorkspaceDescriptor[] }
export interface ResolveWorkspaceInput { readonly locator: WorkspaceLocator }
export interface ResolveWorkspaceResult { readonly workspace?: WorkspaceDescriptor; readonly location?: WorkspaceLocation }
export interface RegisterWorkspaceInput { readonly locator: WorkspaceLocator; readonly title?: string; readonly requestId: string }
export interface RegisterWorkspaceResult { readonly workspace: WorkspaceDescriptor; readonly created: boolean }
export interface RenameWorkspaceInput { readonly workspace: WorkspaceReference; readonly title: string; readonly expectedRevision?: number }
export interface UnregisterWorkspaceInput { readonly workspace: WorkspaceReference; readonly expectedRevision?: number }
export interface UnregisterWorkspaceResult { readonly removed: boolean }
export interface ReorderWorkspaceInput { readonly workspace: WorkspaceReference; readonly before?: WorkspaceReference; readonly expectedCatalogRevision?: number }
export interface WorkspaceCatalogEvent {
  readonly type: 'registered' | 'changed' | 'unregistered' | 'reordered' | 'invalidated'
  readonly beforeRevision: number
  readonly afterRevision: number
  readonly workspace?: WorkspaceDescriptor | WorkspaceReference
}

export interface WorkspaceCatalogClient {
  list(options?: CallOptions): CapabilityCall<WorkspaceCatalogSnapshot>
  get(workspace: WorkspaceReference, options?: CallOptions): CapabilityCall<WorkspaceDescriptor | undefined>
  resolve(input: ResolveWorkspaceInput, options?: CallOptions): CapabilityCall<ResolveWorkspaceResult>
  register(input: RegisterWorkspaceInput, options?: CallOptions): CapabilityCall<RegisterWorkspaceResult>
  rename(input: RenameWorkspaceInput, options?: CallOptions): CapabilityCall<WorkspaceDescriptor>
  unregister(input: UnregisterWorkspaceInput, options?: CallOptions): CapabilityCall<UnregisterWorkspaceResult>
  reorder(input: ReorderWorkspaceInput, options?: CallOptions): CapabilityCall<WorkspaceCatalogSnapshot>
  status(workspace: WorkspaceReference, options?: CallOptions): CapabilityCall<WorkspaceDescriptor>
  watch(options?: CallOptions): CapabilityCall<WorkspaceCatalogSnapshot, WorkspaceCatalogEvent>
}

export interface WorkspaceCatalogHandler {
  list(context: CapabilityHandlerContext): WorkspaceCatalogSnapshot | Promise<WorkspaceCatalogSnapshot>
  get(workspace: WorkspaceReference, context: CapabilityHandlerContext): WorkspaceDescriptor | undefined | Promise<WorkspaceDescriptor | undefined>
  resolve(input: ResolveWorkspaceInput, context: CapabilityHandlerContext): ResolveWorkspaceResult | Promise<ResolveWorkspaceResult>
  register?(input: RegisterWorkspaceInput, context: CapabilityHandlerContext): RegisterWorkspaceResult | Promise<RegisterWorkspaceResult>
  rename?(input: RenameWorkspaceInput, context: CapabilityHandlerContext): WorkspaceDescriptor | Promise<WorkspaceDescriptor>
  unregister?(input: UnregisterWorkspaceInput, context: CapabilityHandlerContext): UnregisterWorkspaceResult | Promise<UnregisterWorkspaceResult>
  reorder?(input: ReorderWorkspaceInput, context: CapabilityHandlerContext): WorkspaceCatalogSnapshot | Promise<WorkspaceCatalogSnapshot>
  status?(workspace: WorkspaceReference, context: CapabilityHandlerContext): WorkspaceDescriptor | Promise<WorkspaceDescriptor>
  watch?(context: CapabilityHandlerContext<WorkspaceCatalogEvent>): WorkspaceCatalogSnapshot | Promise<WorkspaceCatalogSnapshot>
}

export interface WorkspaceProviderContext { readonly signal?: AbortSignal }
export interface WorkspaceProviderHandler {
  list(context: WorkspaceProviderContext): WorkspaceCatalogSnapshot | Promise<WorkspaceCatalogSnapshot>
  get(workspace: WorkspaceReference, context: WorkspaceProviderContext): WorkspaceDescriptor | undefined | Promise<WorkspaceDescriptor | undefined>
  resolve(input: ResolveWorkspaceInput, context: WorkspaceProviderContext): ResolveWorkspaceResult | Promise<ResolveWorkspaceResult>
  register?(input: RegisterWorkspaceInput, context: WorkspaceProviderContext): RegisterWorkspaceResult | Promise<RegisterWorkspaceResult>
  rename?(input: RenameWorkspaceInput, context: WorkspaceProviderContext): WorkspaceDescriptor | Promise<WorkspaceDescriptor>
  unregister?(input: UnregisterWorkspaceInput, context: WorkspaceProviderContext): UnregisterWorkspaceResult | Promise<UnregisterWorkspaceResult>
  reorder?(input: ReorderWorkspaceInput, context: WorkspaceProviderContext): WorkspaceCatalogSnapshot | Promise<WorkspaceCatalogSnapshot>
  status?(workspace: WorkspaceReference, context: WorkspaceProviderContext): WorkspaceDescriptor | Promise<WorkspaceDescriptor>
  watch?(context: WorkspaceProviderContext & { progress(value: WorkspaceCatalogEvent): void }): WorkspaceCatalogSnapshot | Promise<WorkspaceCatalogSnapshot>
}
interface CallOptions { readonly signal?: AbortSignal }

export const workspaceProviderExtensionDefinition = Object.freeze({
  apiVersion: WORKSPACE_API_VERSION,
  kind: WORKSPACE_PROVIDER_KIND,
  validateMetadata(metadata: { readonly name: string }): void {
    if (!/^[a-z][a-z0-9-]*$/u.test(metadata.name)) throw new TypeError('WorkspaceProvider metadata.name is invalid')
  },
  validateSpec: validateWorkspaceProviderSpec,
})

export function assertWorkspaceProviderHandler(value: unknown, spec?: WorkspaceProviderSpec): asserts value is WorkspaceProviderHandler {
  if (typeof value !== 'object' || value === null) throw new TypeError('WorkspaceProvider handler must be an object')
  const handler = value as Record<string, unknown>
  for (const operation of spec?.operations ?? ['list', 'get', 'resolve']) {
    if (typeof handler[operation] !== 'function') throw new TypeError(`WorkspaceProvider handler.${operation} must be a function`)
  }
}

export const workspaceCatalogProtocol: ProtocolDefinition<WorkspaceCatalogRequirementSpec, WorkspaceCatalogSupportSpec> = Object.freeze({
  apiVersion: WORKSPACE_API_VERSION,
  kind: WORKSPACE_CATALOG_KIND,
  validateRequirement: validateWorkspaceCatalogRequirement,
  validateSupport: validateWorkspaceCatalogSupport,
  negotiate(input: ProtocolNegotiationInput<WorkspaceCatalogRequirementSpec, WorkspaceCatalogSupportSpec>) {
    return negotiateWorkspaceCapability<WorkspaceCatalogRequirementSpec, WorkspaceCatalogSupportSpec>(input, {
    kind: WORKSPACE_CATALOG_KIND,
    compatible(requirement, support) {
      return requirement.operations.every(operation => support.operations.includes(operation))
        && (requirement.workspaceDomain === undefined || requirement.workspaceDomain === support.workspaceDomain)
        && (requirement.locatorKinds ?? []).every(kind => support.locatorKinds.includes(kind))
        && (requirement.mutationConcurrency === undefined || requirement.mutationConcurrency === support.mutationConcurrency)
    },
    })
  },
})

export function workspaceCatalogSupport(spec: WorkspaceCatalogSupportSpec): ProtocolSupport<WorkspaceCatalogSupportSpec> {
  return Object.freeze({ apiVersion: WORKSPACE_API_VERSION, kind: WORKSPACE_CATALOG_KIND, spec: validateWorkspaceCatalogSupport(spec) })
}

export function workspaceCatalog(client: CapabilityClient): WorkspaceCatalogClient {
  const reference = { apiVersion: WORKSPACE_API_VERSION, kind: WORKSPACE_CATALOG_KIND }
  return Object.freeze({
    list: (options?: CallOptions) => client.invoke(reference, 'list', {}, options) as CapabilityCall<WorkspaceCatalogSnapshot>,
    get: (workspace: WorkspaceReference, options?: CallOptions) => client.invoke(reference, 'get', validateWorkspaceReference(workspace), options) as CapabilityCall<WorkspaceDescriptor | undefined>,
    resolve: (input: ResolveWorkspaceInput, options?: CallOptions) => client.invoke(reference, 'resolve', validateResolveInput(input), options) as CapabilityCall<ResolveWorkspaceResult>,
    register: (input: RegisterWorkspaceInput, options?: CallOptions) => client.invoke(reference, 'register', validateRegisterInput(input), options) as CapabilityCall<RegisterWorkspaceResult>,
    rename: (input: RenameWorkspaceInput, options?: CallOptions) => client.invoke(reference, 'rename', validateRenameInput(input), options) as CapabilityCall<WorkspaceDescriptor>,
    unregister: (input: UnregisterWorkspaceInput, options?: CallOptions) => client.invoke(reference, 'unregister', validateUnregisterInput(input), options) as CapabilityCall<UnregisterWorkspaceResult>,
    reorder: (input: ReorderWorkspaceInput, options?: CallOptions) => client.invoke(reference, 'reorder', validateReorderInput(input), options) as CapabilityCall<WorkspaceCatalogSnapshot>,
    status: (workspace: WorkspaceReference, options?: CallOptions) => client.invoke(reference, 'status', validateWorkspaceReference(workspace), options) as CapabilityCall<WorkspaceDescriptor>,
    watch: (options?: CallOptions) => client.invoke(reference, 'watch', {}, options) as CapabilityCall<WorkspaceCatalogSnapshot, WorkspaceCatalogEvent>,
  })
}

export function workspaceCatalogImplementation(participantId: string, spec: WorkspaceCatalogSupportSpec, handler: WorkspaceCatalogHandler): CapabilityImplementation {
  const support = workspaceCatalogSupport(spec)
  return Object.freeze({
    participantId, protocol: support,
    async handle(operation: string, input: unknown, context: CapabilityHandlerContext) {
      if (!spec.operations.includes(operation as WorkspaceCatalogOperation)) throw new TypeError(`WorkspaceCatalog operation ${JSON.stringify(operation)} was not declared`)
      if (operation === 'list') { empty(input, 'WorkspaceCatalog.list input'); return validateSnapshot(await handler.list(context)) }
      if (operation === 'get') { const result = await handler.get(validateWorkspaceReference(input), context); return result === undefined ? undefined : validateWorkspaceDescriptor(result) }
      if (operation === 'resolve') return validateResolveResult(await handler.resolve(validateResolveInput(input), context))
      if (operation === 'register') return validateRegisterResult(await required(handler.register, operation)(validateRegisterInput(input), context))
      if (operation === 'rename') return validateWorkspaceDescriptor(await required(handler.rename, operation)(validateRenameInput(input), context))
      if (operation === 'unregister') return validateUnregisterResult(await required(handler.unregister, operation)(validateUnregisterInput(input), context))
      if (operation === 'reorder') return validateSnapshot(await required(handler.reorder, operation)(validateReorderInput(input), context))
      if (operation === 'status') return validateWorkspaceDescriptor(await required(handler.status, operation)(validateWorkspaceReference(input), context))
      if (operation === 'watch') { empty(input, 'WorkspaceCatalog.watch input'); return validateSnapshot(await required(handler.watch, operation)(context as CapabilityHandlerContext<WorkspaceCatalogEvent>)) }
      throw new TypeError(`unsupported WorkspaceCatalog operation ${JSON.stringify(operation)}`)
    },
  })
}

export function registerWorkspaceCatalog(protocols: ProtocolCatalog, manifest?: ManifestDefinitionCatalog): () => void {
  const disposeProvider = manifest?.registerExtension(workspaceProviderExtensionDefinition) ?? (() => undefined)
  const disposeCatalog = protocols.register(workspaceCatalogProtocol)
  return () => { disposeCatalog(); disposeProvider() }
}

export function validateWorkspaceProviderSpec(value: unknown): WorkspaceProviderSpec {
  const spec = exactRecord(value, ['title', 'workspaceDomain', 'operations', 'locatorKinds', 'mutationConcurrency', 'limits'], ['title', 'workspaceDomain', 'operations', 'locatorKinds', 'mutationConcurrency'], 'WorkspaceProvider spec')
  nonEmpty(spec.title, 'WorkspaceProvider spec.title')
  return Object.freeze({
    title: spec.title as string,
    ...validateWorkspaceCatalogSupport({
      workspaceDomain: spec.workspaceDomain,
      operations: spec.operations,
      locatorKinds: spec.locatorKinds,
      mutationConcurrency: spec.mutationConcurrency,
      ...(spec.limits === undefined ? {} : { limits: spec.limits }),
    }),
  })
}

export function validateWorkspaceCatalogRequirement(value: unknown): WorkspaceCatalogRequirementSpec {
  const spec = exactRecord(value, ['operations', 'optionalOperations', 'workspaceDomain', 'locatorKinds', 'mutationConcurrency'], ['operations'], 'WorkspaceCatalog requirement spec')
  const operations = operationList(spec.operations, 'WorkspaceCatalog requirement spec.operations')
  const optionalOperations = spec.optionalOperations === undefined ? undefined : operationList(spec.optionalOperations, 'WorkspaceCatalog requirement spec.optionalOperations')
  if (optionalOperations?.some(operation => operations.includes(operation))) throw new TypeError('WorkspaceCatalog optionalOperations duplicates required operations')
  if (spec.workspaceDomain !== undefined) nonEmpty(spec.workspaceDomain, 'WorkspaceCatalog requirement spec.workspaceDomain')
  const locatorKinds = spec.locatorKinds === undefined ? undefined : stringList(spec.locatorKinds, 'WorkspaceCatalog requirement spec.locatorKinds')
  const mutationConcurrency = concurrency(spec.mutationConcurrency, true)
  return freezeClone({ operations, ...(optionalOperations === undefined ? {} : { optionalOperations }), ...(spec.workspaceDomain === undefined ? {} : { workspaceDomain: spec.workspaceDomain as string }), ...(locatorKinds === undefined ? {} : { locatorKinds }), ...(mutationConcurrency === undefined ? {} : { mutationConcurrency }) })
}

export function validateWorkspaceCatalogSupport(value: unknown): WorkspaceCatalogSupportSpec {
  const spec = exactRecord(value, ['workspaceDomain', 'operations', 'locatorKinds', 'mutationConcurrency', 'limits'], ['workspaceDomain', 'operations', 'locatorKinds', 'mutationConcurrency'], 'WorkspaceCatalog support spec')
  nonEmpty(spec.workspaceDomain, 'WorkspaceCatalog support spec.workspaceDomain')
  const limits = spec.limits === undefined ? undefined : validateLimits(spec.limits)
  return freezeClone({ workspaceDomain: spec.workspaceDomain as string, operations: operationList(spec.operations, 'WorkspaceCatalog support spec.operations'), locatorKinds: stringList(spec.locatorKinds, 'WorkspaceCatalog support spec.locatorKinds'), mutationConcurrency: concurrency(spec.mutationConcurrency, false)!, ...(limits === undefined ? {} : { limits }) })
}

function validateResolveInput(value: unknown): ResolveWorkspaceInput { const input = exactRecord(value, ['locator'], ['locator'], 'ResolveWorkspace input'); return Object.freeze({ locator: validateWorkspaceLocator(input.locator) }) }
function validateResolveResult(value: unknown): ResolveWorkspaceResult { const result = exactRecord(value, ['workspace', 'location'], [], 'ResolveWorkspace result'); if (result.workspace === undefined && result.location === undefined) return Object.freeze({}); return freezeClone({ ...(result.workspace === undefined ? {} : { workspace: validateWorkspaceDescriptor(result.workspace) }), ...(result.location === undefined ? {} : { location: validateLocation(result.location) }) }) }
function validateRegisterInput(value: unknown): RegisterWorkspaceInput { const input = exactRecord(value, ['locator', 'title', 'requestId'], ['locator', 'requestId'], 'RegisterWorkspace input'); if (input.title !== undefined) nonEmpty(input.title, 'RegisterWorkspace input.title'); nonEmpty(input.requestId, 'RegisterWorkspace input.requestId'); return freezeClone({ locator: validateWorkspaceLocator(input.locator), ...(input.title === undefined ? {} : { title: (input.title as string).trim() }), requestId: input.requestId as string }) }
function validateRegisterResult(value: unknown): RegisterWorkspaceResult { const result = exactRecord(value, ['workspace', 'created'], ['workspace', 'created'], 'RegisterWorkspace result'); if (typeof result.created !== 'boolean') throw new TypeError('RegisterWorkspace result.created must be boolean'); return Object.freeze({ workspace: validateWorkspaceDescriptor(result.workspace), created: result.created }) }
function validateRenameInput(value: unknown): RenameWorkspaceInput { const input = exactRecord(value, ['workspace', 'title', 'expectedRevision'], ['workspace', 'title'], 'RenameWorkspace input'); nonEmpty(input.title, 'RenameWorkspace input.title'); optionalRevision(input.expectedRevision, 'RenameWorkspace input.expectedRevision'); return freezeClone({ workspace: validateWorkspaceReference(input.workspace), title: (input.title as string).trim(), ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision as number }) }) }
function validateUnregisterInput(value: unknown): UnregisterWorkspaceInput { const input = exactRecord(value, ['workspace', 'expectedRevision'], ['workspace'], 'UnregisterWorkspace input'); optionalRevision(input.expectedRevision, 'UnregisterWorkspace input.expectedRevision'); return freezeClone({ workspace: validateWorkspaceReference(input.workspace), ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision as number }) }) }
function validateUnregisterResult(value: unknown): UnregisterWorkspaceResult { const result = exactRecord(value, ['removed'], ['removed'], 'UnregisterWorkspace result'); if (typeof result.removed !== 'boolean') throw new TypeError('UnregisterWorkspace result.removed must be boolean'); return Object.freeze({ removed: result.removed }) }
function validateReorderInput(value: unknown): ReorderWorkspaceInput { const input = exactRecord(value, ['workspace', 'before', 'expectedCatalogRevision'], ['workspace'], 'ReorderWorkspace input'); optionalRevision(input.expectedCatalogRevision, 'ReorderWorkspace input.expectedCatalogRevision'); return freezeClone({ workspace: validateWorkspaceReference(input.workspace), ...(input.before === undefined ? {} : { before: validateWorkspaceReference(input.before) }), ...(input.expectedCatalogRevision === undefined ? {} : { expectedCatalogRevision: input.expectedCatalogRevision as number }) }) }
function validateLocation(value: unknown): WorkspaceLocation { const descriptor = validateWorkspaceDescriptor({ workspace: { provider: '_', id: '_' }, title: '_', location: value, state: 'unknown', revision: 0 }); return descriptor.location }
function validateSnapshot(value: unknown): WorkspaceCatalogSnapshot { const snapshot = exactRecord(value, ['catalogRevision', 'workspaces'], ['catalogRevision', 'workspaces'], 'WorkspaceCatalog snapshot'); nonNegativeInteger(snapshot.catalogRevision, 'WorkspaceCatalog snapshot.catalogRevision'); if (!Array.isArray(snapshot.workspaces)) throw new TypeError('WorkspaceCatalog snapshot.workspaces must be an array'); return Object.freeze({ catalogRevision: snapshot.catalogRevision, workspaces: Object.freeze(snapshot.workspaces.map(validateWorkspaceDescriptor)) }) }
function validateLimits(value: unknown): WorkspaceCatalogLimits { const limits = exactRecord(value, ['maxWorkspaces', 'maxLocatorLength', 'maxWatchBuffer'], [], 'WorkspaceCatalog limits'); for (const [name, limit] of Object.entries(limits)) { if (!Number.isSafeInteger(limit) || (limit as number) < 1) throw new TypeError(`WorkspaceCatalog limits.${name} must be a positive safe integer`) }; return freezeClone(value as WorkspaceCatalogLimits) }
function operationList(value: unknown, label: string): readonly WorkspaceCatalogOperation[] { const allowed = new Set(['list', 'get', 'resolve', 'register', 'rename', 'unregister', 'reorder', 'status', 'watch']); const values = stringList(value, label); if (values.some(row => !allowed.has(row))) throw new TypeError(`${label} contains an invalid operation`); return values as readonly WorkspaceCatalogOperation[] }
function stringList(value: unknown, label: string): readonly string[] { if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array`); for (const row of value) nonEmpty(row, label); if (new Set(value).size !== value.length) throw new TypeError(`${label} contains duplicates`); return Object.freeze([...value] as string[]) }
function concurrency(value: unknown, optional: boolean): WorkspaceMutationConcurrency | undefined { if (value === undefined && optional) return undefined; if (value !== 'serialized' && value !== 'revision-checked') throw new TypeError('mutationConcurrency is invalid'); return value }
function optionalRevision(value: unknown, label: string): void { if (value !== undefined) nonNegativeInteger(value, label) }
function empty(value: unknown, label: string): void { exactRecord(value, [], [], label) }
function required<T extends Function>(value: T | undefined, operation: string): T { if (value === undefined) throw new TypeError(`WorkspaceCatalog handler.${operation} is missing`); return value }
