import {
  ProtocolCatalog,
  defineProtocolDeclaration,
  protocolKey,
  sameProtocol,
  type ApiReference,
  type NegotiatedProtocol,
  type ProtocolDeclaration,
  type ProtocolSupport,
} from '@dsh-std/core'
import type { CompositionPlan, SelectedFacet } from '@dsh-std/composition'
import type { ActivationObject, ManifestExtension } from '@dsh-std/manifest'

export type LifecycleState = 'planned' | 'activating' | 'active' | 'deactivating' | 'inactive' | 'failed'

/** Portable ECMAScript facet activation declared by a component manifest. */
export const FACET_MODULE_API_VERSION = 'lifecycle.dsh/v1alpha1'
export const FACET_MODULE_KIND = 'FacetModule'

export interface FacetModuleActivationSpec {
  readonly module: string
}

export const facetModuleActivationDefinition = Object.freeze({
  apiVersion: FACET_MODULE_API_VERSION,
  kind: FACET_MODULE_KIND,
  validateSpec(value: unknown): FacetModuleActivationSpec {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('FacetModule spec must be an object')
    }
    const row = value as Record<string, unknown>
    const unknown = Object.keys(row).filter(key => key !== 'module' && !key.startsWith('x-'))
    if (unknown.length > 0) throw new TypeError(`FacetModule spec contains unknown field ${JSON.stringify(unknown[0])}`)
    if (typeof row.module !== 'string' || row.module.trim() === '') {
      throw new TypeError('FacetModule spec.module must be a non-empty string')
    }
    return Object.freeze({ module: row.module })
  },
})

export interface ActivationInstanceIdentity {
  readonly component: string
  readonly version: string
  readonly facet: string
  readonly instanceId: string
  readonly participantId: string
}

export interface LifecycleRecord {
  readonly identity: ActivationInstanceIdentity
  readonly from?: LifecycleState
  readonly to: LifecycleState
  readonly planRevision: string
  readonly time: number
  readonly reason?: string
}

export interface CleanupScope {
  readonly signal: AbortSignal
  add(dispose: () => void | Promise<void>): () => void
}

export interface ProtocolImplementation<T = unknown> {
  readonly support: ProtocolSupport
  readonly implementation: T
}

export interface ExtensionPublication<T = unknown> {
  readonly extension: ManifestExtension
  readonly handler: T
}

export interface ActivationContext {
  readonly identity: ActivationInstanceIdentity
  readonly plan: CompositionPlan
  readonly scope: CleanupScope
  readonly protocols: {
    client(reference: ApiReference): NegotiatedProtocol | undefined
    implement<T>(support: ProtocolSupport, implementation: T): () => void
  }
  readonly extensions: {
    publish<T>(reference: ApiReference, name: string, handler: T): () => void
  }
}

export interface ActivationRequest {
  readonly selected: SelectedFacet
  readonly activation: ActivationObject
  readonly context: ActivationContext
}

export interface ActivationDriver extends ApiReference {
  readonly id: string
  activate(request: ActivationRequest): void | Promise<void>
  deactivate?(identity: ActivationInstanceIdentity, reason: string): void | Promise<void>
}

export interface LivePublication {
  readonly identity: ActivationInstanceIdentity
  readonly declaration: ProtocolDeclaration
  readonly protocols: readonly ProtocolImplementation[]
  readonly extensions: readonly ExtensionPublication[]
}

export interface ActivationHandle {
  readonly identity: ActivationInstanceIdentity
  readonly state: LifecycleState
  deactivate(reason?: string): Promise<void>
}

interface MutableInstance {
  readonly selected: SelectedFacet
  readonly identity: ActivationInstanceIdentity
  readonly scope: Scope
  readonly driver: ActivationDriver
  readonly protocols: ProtocolImplementation[]
  readonly extensions: ExtensionPublication[]
  state: LifecycleState
}

export class ActivationDriverRegistry {
  private readonly drivers = new Map<string, ActivationDriver>()

  register(driver: ActivationDriver): () => void {
    nonEmpty(driver.id, 'activation driver.id')
    const key = driverKey(driver)
    if (this.drivers.has(key)) throw new Error(`activation driver ${JSON.stringify(driver.id)} is already registered for ${driver.apiVersion} ${driver.kind}`)
    if (typeof driver.activate !== 'function') throw new TypeError('activation driver.activate must be a function')
    const stored = Object.freeze({ ...driver })
    this.drivers.set(key, stored)
    return () => { if (this.drivers.get(key) === stored) this.drivers.delete(key) }
  }

  get(id: string, reference: ApiReference): ActivationDriver | undefined {
    return this.drivers.get(`${id}\0${protocolKey(reference)}`)
  }

  descriptors(): readonly { readonly id: string; readonly apiVersion: string; readonly kind: string }[] {
    return Object.freeze([...this.drivers.values()].map(driver => Object.freeze({
      id: driver.id, apiVersion: driver.apiVersion, kind: driver.kind,
    })))
  }
}

export class PublicationRegistry {
  private readonly publications = new Map<string, LivePublication>()

  publish(publication: LivePublication): () => void {
    const id = publication.identity.instanceId
    if (this.publications.has(id)) throw new Error(`activation instance ${JSON.stringify(id)} is already published`)
    const stored = freezePublication(publication)
    this.publications.set(id, stored)
    return () => { if (this.publications.get(id) === stored) this.publications.delete(id) }
  }

  get(instanceId: string): LivePublication | undefined { return this.publications.get(instanceId) }

  list(): readonly LivePublication[] { return Object.freeze([...this.publications.values()]) }

  declarations(): readonly ProtocolDeclaration[] {
    return Object.freeze([...this.publications.values()].map(row => row.declaration))
  }
}

export class LifecycleCoordinator {
  private sequence = 0
  private readonly instances = new Map<string, MutableInstance>()
  private readonly listeners = new Set<(record: LifecycleRecord) => void>()

  constructor(
    readonly protocols: ProtocolCatalog,
    readonly drivers: ActivationDriverRegistry,
    readonly publications = new PublicationRegistry(),
  ) {}

  onStateChange(listener: (record: LifecycleRecord) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async activate(plan: CompositionPlan): Promise<readonly ActivationHandle[]> {
    if (!plan.compatible) throw new Error('cannot activate an incompatible composition plan')
    const selectedByKey = new Map(plan.selected.map(row => [facetKey(row), row]))
    const handles: ActivationHandle[] = []
    try {
      for (const key of plan.activationOrder) {
        const selected = selectedByKey.get(key)
        if (selected === undefined || selected.facet.activation === undefined || selected.driver === undefined) continue
        const activation = selected.facet.activation
        const driver = this.drivers.get(selected.driver.id, activation)
        if (driver === undefined) throw new Error(`activation driver ${JSON.stringify(selected.driver.id)} disappeared before activation`)
        handles.push(await this.activateOne(plan, selected, driver, activation))
      }
      return Object.freeze(handles)
    } catch (error) {
      for (const handle of [...handles].reverse()) await handle.deactivate('activation batch rolled back')
      throw error
    }
  }

  private async activateOne(
    plan: CompositionPlan, selected: SelectedFacet, driver: ActivationDriver, activation: ActivationObject,
  ): Promise<ActivationHandle> {
    const identity: ActivationInstanceIdentity = Object.freeze({
      ...selected.identity,
      instanceId: `${selected.participantId}:${String(++this.sequence)}`,
      participantId: selected.participantId,
    })
    const scope = new Scope()
    const instance: MutableInstance = {
      selected, identity, scope, driver, protocols: [], extensions: [], state: 'planned',
    }
    this.instances.set(identity.instanceId, instance)
    this.transition(instance, 'activating', plan.revision)

    const plannedDeclaration = defineProtocolDeclaration({
      participant: { id: identity.participantId },
      requires: selected.facet.protocols?.requires ?? [],
    })
    const preActivation = this.protocols.negotiate([plannedDeclaration, ...this.publications.declarations()])
    const missingRequired = preActivation.issues.filter(issue => issue.severity === 'error')
    if (missingRequired.length > 0) {
      this.transition(instance, 'failed', plan.revision, missingRequired.map(row => row.message).join('; '))
      this.instances.delete(identity.instanceId)
      throw new Error(`facet ${facetKey(selected)} requirements are unavailable: ${missingRequired.map(row => row.message).join('; ')}`)
    }
    const agreement = (reference: ApiReference): NegotiatedProtocol | undefined => {
      const definition = this.protocols.resolve(reference)
      if (definition === undefined || !(selected.facet.protocols?.requires ?? []).some(row => this.protocols.resolve(row) === definition)) {
        return undefined
      }
      return preActivation.protocols.find(row => this.protocols.resolve(row) === definition)
    }
    const context: ActivationContext = Object.freeze({
      identity, plan, scope,
      protocols: Object.freeze({
        client: agreement,
        implement: <T>(support: ProtocolSupport, implementation: T) => this.stageProtocol(instance, support, implementation),
      }),
      extensions: Object.freeze({
        publish: <T>(reference: ApiReference, name: string, handler: T) => this.stageExtension(instance, reference, name, handler),
      }),
    })

    let unpublish = (): void => undefined
    try {
      await driver.activate({ selected, activation, context })
      const declaration = defineProtocolDeclaration({
        participant: { id: identity.participantId },
        requires: selected.facet.protocols?.requires ?? [],
        supports: instance.protocols.map(row => row.support),
      })
      const report = this.protocols.negotiate([...this.publications.declarations(), declaration])
      if (!report.compatible) throw new Error(report.issues.filter(row => row.severity === 'error').map(row => row.message).join('; '))
      unpublish = this.publications.publish({
        identity, declaration,
        protocols: Object.freeze([...instance.protocols]),
        extensions: Object.freeze([...instance.extensions]),
      })
      scope.add(unpublish)
      this.transition(instance, 'active', plan.revision)
    } catch (error) {
      unpublish()
      await scope.close()
      this.transition(instance, 'failed', plan.revision, errorMessage(error))
      this.instances.delete(identity.instanceId)
      throw error
    }

    const coordinator = this
    return Object.freeze({
      identity,
      get state() { return instance.state },
      async deactivate(reason = 'deactivated') {
        if (instance.state === 'inactive' || instance.state === 'deactivating') return
        coordinator.transition(instance, 'deactivating', plan.revision, reason)
        scope.abort(reason)
        let failure: unknown
        try { await driver.deactivate?.(identity, reason) } catch (error) { failure = error }
        try { await scope.close() } catch (error) { failure ??= error }
        coordinator.instances.delete(identity.instanceId)
        coordinator.transition(instance, failure === undefined ? 'inactive' : 'failed', plan.revision, failure === undefined ? reason : errorMessage(failure))
        if (failure !== undefined) throw failure
      },
    })
  }

  private stageProtocol<T>(instance: MutableInstance, support: ProtocolSupport, implementation: T): () => void {
    if (instance.state !== 'activating') throw new Error('protocol implementations can only be staged during activation')
    const declared = instance.selected.facet.protocols?.supports ?? []
    const definition = this.protocols.resolve(support)
    if (definition === undefined || !declared.some(row => this.protocols.resolve(row) === definition)) {
      throw new TypeError(`facet attempted to implement undeclared protocol ${support.apiVersion} ${support.kind}`)
    }
    if (instance.protocols.some(row => this.protocols.resolve(row.support) === definition)) {
      throw new TypeError(`facet already staged protocol ${support.apiVersion} ${support.kind}`)
    }
    const row: ProtocolImplementation = Object.freeze({ support: Object.freeze(structuredClone(support)), implementation })
    instance.protocols.push(row)
    const dispose = () => {
      const index = instance.protocols.indexOf(row)
      if (index >= 0) instance.protocols.splice(index, 1)
    }
    instance.scope.add(dispose)
    return dispose
  }

  private stageExtension<T>(instance: MutableInstance, reference: ApiReference, name: string, handler: T): () => void {
    if (instance.state !== 'activating') throw new Error('extension handlers can only be staged during activation')
    const extension = (instance.selected.facet.extensions ?? []).find(row => sameProtocol(row, reference) && row.metadata.name === name)
    if (extension === undefined) throw new TypeError(`facet attempted to publish undeclared extension ${reference.apiVersion} ${reference.kind} ${name}`)
    if (instance.extensions.some(row => row.extension === extension)) throw new TypeError(`facet already staged extension ${name}`)
    const row: ExtensionPublication = Object.freeze({ extension, handler })
    instance.extensions.push(row)
    const dispose = () => {
      const index = instance.extensions.indexOf(row)
      if (index >= 0) instance.extensions.splice(index, 1)
    }
    instance.scope.add(dispose)
    return dispose
  }

  private transition(instance: MutableInstance, to: LifecycleState, planRevision: string, reason?: string): void {
    const from = instance.state
    instance.state = to
    const record: LifecycleRecord = Object.freeze({
      identity: instance.identity, from, to, planRevision, time: Date.now(), ...(reason === undefined ? {} : { reason }),
    })
    for (const listener of this.listeners) listener(record)
  }
}

class Scope implements CleanupScope {
  private readonly controller = new AbortController()
  private readonly disposers: Array<() => void | Promise<void>> = []
  private closed = false

  get signal(): AbortSignal { return this.controller.signal }

  add(dispose: () => void | Promise<void>): () => void {
    if (this.closed) throw new Error('cleanup scope is closed')
    let active = true
    const once = async (): Promise<void> => {
      if (!active) return
      active = false
      await dispose()
    }
    this.disposers.push(once)
    return () => { void once() }
  }

  abort(reason?: string): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.abort()
    const errors: unknown[] = []
    for (const dispose of this.disposers.reverse()) {
      try { await dispose() } catch (error) { errors.push(error) }
    }
    this.disposers.length = 0
    if (errors.length > 0) throw new AggregateError(errors, 'one or more cleanup disposers failed')
  }
}

function driverKey(driver: ActivationDriver): string { return `${driver.id}\0${protocolKey(driver)}` }
function facetKey(selected: SelectedFacet): string { return `${selected.identity.component}@${selected.identity.version}#${selected.identity.facet}` }

function freezePublication(publication: LivePublication): LivePublication {
  return Object.freeze({
    identity: Object.freeze({ ...publication.identity }),
    declaration: defineProtocolDeclaration(publication.declaration),
    protocols: Object.freeze([...publication.protocols]),
    extensions: Object.freeze([...publication.extensions]),
  })
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
