/** DeepSeek Harness Web mapping for local standard UI facets. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import {
  ProtocolCatalog,
  defineProtocolDeclaration,
  sameProtocol,
  type ApiReference,
  type NegotiatedProtocol,
} from '@dsh-std/core'
import {
  defineComponentManifest,
  findFacet,
  type ComponentManifest,
} from '@dsh-std/manifest'
import { compose, type CompositionPlan } from '@dsh-std/composition'
import type {
  ActivationContext,
  ActivationInstanceIdentity,
  CleanupScope,
} from '@dsh-std/lifecycle'
import type { FacetModule } from '@dsh-std/sdk'
import {
  API_VERSION as UI_API_VERSION,
  CONTRIBUTION_HOST_KIND,
  bindContributionHosts,
  contributionHostSupport,
  register as registerUi,
  validateContributionHostAgreement,
  type ContributionHostClient,
  type UiContributionProvider,
  type UiContributionRegistration,
  type UiSurfaceRequirement,
} from '@dsh-std/ui'

export const WEB_UI_API_VERSION = 'web.ui.dsh/v1alpha1'
export const WEB_SETTINGS_SECTION_KIND = 'SettingsSection'
export const WEB_TOOL_CALL_VIEW_KIND = 'ToolCallView'
export const WEB_CLIENT_ACTIVATION_API_VERSION = 'adapter.dsh/v1alpha1'
export const WEB_CLIENT_ACTIVATION_KIND = 'WebClientModule'

export const WEB_SETTINGS_SECTION = Object.freeze({
  apiVersion: WEB_UI_API_VERSION,
  kind: WEB_SETTINGS_SECTION_KIND,
})

export const WEB_TOOL_CALL_VIEW = Object.freeze({
  apiVersion: WEB_UI_API_VERSION,
  kind: WEB_TOOL_CALL_VIEW_KIND,
})

export interface DshWebSettingsSectionContent {
  readonly label: string
  readonly order?: number
}

export interface DshWebToolCallViewContent {
  readonly tool: string
}

/** Same-page React value consumed by the DSH Web slot registry. */
export interface DshWebLocalView {
  readonly component: unknown
  readonly inject?: (...args: unknown[]) => Record<string, unknown>
  readonly locale?: string
  /** A locale-following label thunk may accompany the JSON fallback label. */
  readonly label?: string | (() => unknown)
  readonly dispose?: () => void | Promise<void>
  /** Resolve optional product services only while this contribution is live. */
  readonly setup?: (host: DshWebLocalHost) => DshWebLocalViewBinding
}

export interface DshWebLocalViewBinding {
  readonly inject?: (...args: unknown[]) => Record<string, unknown>
  readonly locale?: string
  readonly label?: string | (() => unknown)
  readonly dispose?: () => void | Promise<void>
}

export interface DshWebLocaleBinding {
  readonly t: (key: string, params?: Record<string, unknown>) => string
  dispose(): void
}

export interface DshWebAttachment {
  readonly mediaType: string
  readonly name?: string
  readonly data: Uint8Array
}

export interface DshWebCommandResult {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

/** Narrow DSH product services available to same-page local UI modules. */
export interface DshWebLocalHost {
  locale(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): DshWebLocaleBinding
  executeCommand(sessionId: string, line: string): Promise<DshWebCommandResult | undefined>
  readAttachment(sessionId: string, attachmentId: string): Promise<DshWebAttachment>
}

export interface DshWebUiFacetInput {
  readonly manifest: ComponentManifest
  readonly facet: string
  readonly module: FacetModule
}

export interface DshWebUiRuntimeFace {
  mountFacet(input: DshWebUiFacetInput): Promise<() => Promise<void>>
}

interface SlotRuntime {
  inject(name: string, setup: () => (() => void) | Iterable<() => void, void, void>): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshStdWebUi: DshWebUiRuntimeFace
  }
}

export const name = 'dsh-standard-web-ui-adapter'
export const inject = ['slots']

/** Install DSH Web surface owners. The package's dsh.client row loads this only in Web. */
export function apply(ctx: ClientContext): void {
  new DshWebUiRuntime(ctx)
}

/**
 * Browser-local facet runner. It negotiates concrete Web surfaces, then gives
 * the standard facet only its scoped ContributionHost client.
 */
export class DshWebUiRuntime extends Service implements DshWebUiRuntimeFace {
  private readonly providers: readonly UiContributionProvider[]

  constructor(ctx: Context) {
    super(ctx, 'dshStdWebUi')
    const slots = ctx.get('slots') as unknown as SlotRuntime | undefined
    if (slots === undefined) throw new Error('DSH Web UI adapter requires the client slot registry')
    const host = localHost(ctx)
    this.providers = Object.freeze([
      settingsSectionProvider(slots, host),
      toolCallViewProvider(slots, host),
    ])
  }

  async mountFacet(input: DshWebUiFacetInput): Promise<() => Promise<void>> {
    const manifest = defineComponentManifest(input.manifest)
    const facet = findFacet(manifest, input.facet)
    if (facet === undefined) throw new TypeError(`component has no Web facet ${JSON.stringify(input.facet)}`)
    if (facet.activation?.apiVersion !== WEB_CLIENT_ACTIVATION_API_VERSION
      || facet.activation.kind !== WEB_CLIENT_ACTIVATION_KIND) {
      throw new TypeError(`facet ${JSON.stringify(input.facet)} is not a DSH Web client facet`)
    }
    if (typeof input.module.activate !== 'function') throw new TypeError('Web client facet module must provide activate()')

    const requirements = facet.protocols?.requires ?? []
    for (const requirement of requirements) {
      if (!sameProtocol(requirement, { apiVersion: UI_API_VERSION, kind: CONTRIBUTION_HOST_KIND })) {
        throw new Error(`DSH Web UI adapter cannot provide ${requirement.apiVersion} ${requirement.kind}`)
      }
    }
    const protocols = new ProtocolCatalog({ name: '@dsh-std/adapter-dsh/client', version: '0.1.0' })
    registerUi(protocols)
    const providerDeclarations = this.providers.map(provider => defineProtocolDeclaration({
        participant: { id: provider.participantId },
        supports: [contributionHostSupport(provider.support)],
      }))
    const plan = compose({
      manifests: [manifest],
      drivers: [{
        id: '@dsh-std/adapter-dsh/client',
        apiVersion: WEB_CLIENT_ACTIVATION_API_VERSION,
        kind: WEB_CLIENT_ACTIVATION_KIND,
      }],
      protocols,
      liveDeclarations: providerDeclarations,
      select: [{ component: manifest.metadata.name, facet: facet.name, required: true }],
    })
    if (!plan.compatible || plan.selected.length !== 1) {
      throw new Error(plan.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '))
    }
    const selected = plan.selected[0]!
    const identity: ActivationInstanceIdentity = Object.freeze({
      component: manifest.metadata.name,
      version: manifest.metadata.version,
      facet: facet.name,
      instanceId: crypto.randomUUID(),
      participantId: selected.participantId,
    })
    const consumer = defineProtocolDeclaration({ participant: { id: identity.participantId }, requires: requirements })
    const declarations = [consumer, ...providerDeclarations]
    const report = protocols.negotiate(declarations)
    if (!report.compatible) {
      throw new Error(report.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('; '))
    }
    const negotiated = report.protocols.find(row => sameProtocol(row, {
      apiVersion: UI_API_VERSION,
      kind: CONTRIBUTION_HOST_KIND,
    }))
    if (negotiated?.agreement === undefined) throw new Error('Web UI facet did not negotiate ContributionHost')
    const host = bindContributionHosts(
      validateContributionHostAgreement(negotiated.agreement),
      identity,
      this.providers,
    )
    const scope = new BrowserCleanupScope()
    const context = activationContext(identity, plan, scope, negotiated, host.client)
    try {
      await input.module.activate(context)
    } catch (error) {
      await closeFacet(input.module, scope, host.close, 'Web UI facet activation failed')
      throw error
    }
    let active = true
    return async () => {
      if (!active) return
      active = false
      await closeFacet(input.module, scope, host.close, 'Web UI facet unmounted')
    }
  }
}

/** Wrap a standard Web UI facet as the ordinary DSH browser plugin entry. */
export function defineDshWebUiFacet(input: DshWebUiFacetInput): {
  readonly name: string
  readonly inject: readonly ['dshStdWebUi']
  apply(ctx: ClientContext): Promise<void>
} {
  return Object.freeze({
    name: `${input.manifest.metadata.name}-${input.facet}`,
    inject: ['dshStdWebUi'] as const,
    async apply(ctx: ClientContext): Promise<void> {
      const dispose = await ctx.dshStdWebUi.mountFacet(input)
      ctx.effect(() => dispose, `standard Web UI facet ${input.manifest.metadata.name}#${input.facet}`)
    },
  })
}

export function webSettingsSectionRequirement(): UiSurfaceRequirement {
  return Object.freeze({ ...WEB_SETTINGS_SECTION, mode: 'local-module' })
}

export function webToolCallViewRequirement(): UiSurfaceRequirement {
  return Object.freeze({ ...WEB_TOOL_CALL_VIEW, mode: 'local-module' })
}

function settingsSectionProvider(slots: SlotRuntime, host: DshWebLocalHost): UiContributionProvider {
  const provider: UiContributionProvider = {
    participantId: 'dsh/web/settings-section',
    support: { surfaces: [{ ...WEB_SETTINGS_SECTION, modes: ['local-module'] as const }] },
    register(_owner, contribution) {
      const content = settingsContent(contribution)
      const view = localView(contribution)
      const binding = bindLocalView(view, host)
      const retract = slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: contribution.descriptor.id,
        order: content.order ?? 100,
        label: binding.label ?? content.label,
        ...(binding.locale === undefined ? {} : { locale: binding.locale }),
        ...(binding.inject === undefined ? {} : { inject: binding.inject }),
      }, view.component))
      return async () => {
        retract()
        await binding.dispose?.()
      }
    },
  }
  return Object.freeze(provider)
}

function toolCallViewProvider(slots: SlotRuntime, host: DshWebLocalHost): UiContributionProvider {
  const provider: UiContributionProvider = {
    participantId: 'dsh/web/tool-call-view',
    support: { surfaces: [{ ...WEB_TOOL_CALL_VIEW, modes: ['local-module'] as const }] },
    register(_owner, contribution) {
      const content = toolViewContent(contribution)
      const view = localView(contribution)
      const binding = bindLocalView(view, host)
      const retract = slots.inject('tool.call.toolview', () => slots.register({
        name: 'tool.call.toolview',
        key: content.tool,
        ...(binding.locale === undefined ? {} : { locale: binding.locale }),
        ...(binding.inject === undefined ? {} : { inject: binding.inject }),
      }, view.component))
      return async () => {
        retract()
        await binding.dispose?.()
      }
    },
  }
  return Object.freeze(provider)
}

function settingsContent(contribution: UiContributionRegistration): DshWebSettingsSectionContent {
  const content = record(contribution.descriptor.content, 'Web settings section content')
  nonEmpty(content.label, 'Web settings section content.label')
  if (content.order !== undefined && (!Number.isInteger(content.order) || !Number.isSafeInteger(content.order))) {
    throw new TypeError('Web settings section content.order must be a safe integer')
  }
  return { label: content.label, ...(content.order === undefined ? {} : { order: content.order as number }) }
}

function toolViewContent(contribution: UiContributionRegistration): DshWebToolCallViewContent {
  const content = record(contribution.descriptor.content, 'Web tool call view content')
  nonEmpty(content.tool, 'Web tool call view content.tool')
  return { tool: content.tool }
}

function localView(contribution: UiContributionRegistration): DshWebLocalView {
  const value = record(contribution.localModule, 'Web local view')
  if (!Object.hasOwn(value, 'component')) throw new TypeError('Web local view.component is required')
  if (value.inject !== undefined && typeof value.inject !== 'function') throw new TypeError('Web local view.inject must be a function')
  if (value.locale !== undefined) nonEmpty(value.locale, 'Web local view.locale')
  if (value.label !== undefined && typeof value.label !== 'string' && typeof value.label !== 'function') {
    throw new TypeError('Web local view.label must be a string or function')
  }
  if (value.setup !== undefined && typeof value.setup !== 'function') throw new TypeError('Web local view.setup must be a function')
  if (value.dispose !== undefined && typeof value.dispose !== 'function') throw new TypeError('Web local view.dispose must be a function')
  return value as unknown as DshWebLocalView
}

function bindLocalView(view: DshWebLocalView, host: DshWebLocalHost): DshWebLocalViewBinding {
  const binding = view.setup?.(host) ?? view
  if (binding.inject !== undefined && typeof binding.inject !== 'function') throw new TypeError('Web local view binding.inject must be a function')
  if (binding.locale !== undefined) nonEmpty(binding.locale, 'Web local view binding.locale')
  if (binding.label !== undefined && typeof binding.label !== 'string' && typeof binding.label !== 'function') {
    throw new TypeError('Web local view binding.label must be a string or function')
  }
  if (binding.dispose !== undefined && typeof binding.dispose !== 'function') throw new TypeError('Web local view binding.dispose must be a function')
  return binding
}

function localHost(ctx: Context): DshWebLocalHost {
  const get = ctx.get.bind(ctx) as (name: string) => unknown
  return Object.freeze({
    locale(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): DshWebLocaleBinding {
      nonEmpty(namespace, 'locale namespace')
      const locale = get('locale') as {
        register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
        bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
      } | undefined
      if (locale === undefined || typeof locale.register !== 'function' || typeof locale.bind !== 'function') {
        throw new Error('DSH Web locale service is unavailable')
      }
      const dispose = locale.register(namespace, dictionaries)
      return Object.freeze({ t: locale.bind(namespace), dispose })
    },
    async executeCommand(sessionId: string, line: string): Promise<DshWebCommandResult | undefined> {
      nonEmpty(sessionId, 'sessionId')
      nonEmpty(line, 'command line')
      const remoteRoot = get('remote') as { dshStd?: unknown } | undefined
      const remote = (get('remote.dshStd') ?? remoteRoot?.dshStd) as {
        command(sessionId: string, line: string): Promise<RemoteResult<{
          result: DshWebCommandResult
        } | undefined>>
      } | undefined
      if (remote === undefined || typeof remote.command !== 'function') throw new Error('DSH standard command Remote is unavailable')
      const result = await remote.command(sessionId, line)
      if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
      return result.value?.result
    },
    async readAttachment(sessionId: string, attachmentId: string): Promise<DshWebAttachment> {
      nonEmpty(sessionId, 'sessionId')
      nonEmpty(attachmentId, 'attachmentId')
      const sessions = get('sessions') as {
        binding(id: string): { session: { readAttachment(id: string): Promise<RemoteResult<{
          attachment: { mediaType: string; name?: string }
          data: readonly number[]
        }>> } } | undefined
      } | undefined
      const session = sessions?.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session ${sessionId}`)
      const result = await session.readAttachment(attachmentId)
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return Object.freeze({
        mediaType: result.value.attachment.mediaType,
        ...(result.value.attachment.name === undefined ? {} : { name: result.value.attachment.name }),
        data: Uint8Array.from(result.value.data),
      })
    },
  })
}

type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

function activationContext(
  identity: ActivationInstanceIdentity,
  plan: CompositionPlan,
  scope: BrowserCleanupScope,
  negotiated: NegotiatedProtocol,
  ui: ContributionHostClient,
): ActivationContext {
  return Object.freeze({
    identity,
    plan,
    scope,
    protocols: Object.freeze({
      agreement(reference: ApiReference): NegotiatedProtocol | undefined {
        return sameProtocol(reference, negotiated) ? negotiated : undefined
      },
      client<T = unknown>(reference: ApiReference): T | undefined {
        return sameProtocol(reference, negotiated) ? ui as unknown as T : undefined
      },
      implement(): () => void {
        throw new Error('Web UI facets cannot publish protocol implementations')
      },
    }),
    extensions: Object.freeze({
      publish(): () => void {
        throw new Error('Web UI facets cannot publish manifest extensions')
      },
    }),
  })
}

class BrowserCleanupScope implements CleanupScope {
  private readonly controller = new AbortController()
  private readonly cleanups: Array<() => void | Promise<void>> = []
  get signal(): AbortSignal { return this.controller.signal }
  add(dispose: () => void | Promise<void>): () => void {
    if (this.controller.signal.aborted) throw new Error('Web UI facet cleanup scope is closed')
    this.cleanups.push(dispose)
    return () => {
      const index = this.cleanups.indexOf(dispose)
      if (index >= 0) this.cleanups.splice(index, 1)
    }
  }
  async close(reason: string): Promise<void> {
    if (this.controller.signal.aborted) return
    this.controller.abort(reason)
    const failures: unknown[] = []
    for (const dispose of this.cleanups.splice(0).reverse()) {
      try { await dispose() } catch (error) { failures.push(error) }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'one or more Web UI facet cleanups failed')
  }
}

async function closeFacet(
  module: FacetModule,
  scope: BrowserCleanupScope,
  closeHost: (reason?: string) => Promise<void>,
  reason: string,
): Promise<void> {
  const failures: unknown[] = []
  try { await module.deactivate?.(reason) } catch (error) { failures.push(error) }
  try { await scope.close(reason) } catch (error) { failures.push(error) }
  try { await closeHost(reason) } catch (error) { failures.push(error) }
  if (failures.length > 0) throw new AggregateError(failures, 'Web UI facet failed to close cleanly')
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

export default apply
