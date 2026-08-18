/** DeepSeek Harness browser-realm mapping for local standard UI facets. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
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
} from '@dsh-std/ui'
import {
  API_VERSION as BROWSER_UI_PROTOCOL_VERSION,
  FACET_HOST_SERVICE,
  LOCAL_MODULE_ACTIVATION_KIND,
  SETTINGS_SECTION,
  TOOL_CALL_VIEW,
  defineBrowserUiFacet,
  settingsSectionRequirement,
  toolCallViewRequirement,
  type SettingsSectionContent,
  type ToolCallViewContent,
  type BrowserUiAttachment,
  type BrowserUiCommandResult,
  type BrowserUiFacetHost,
  type BrowserUiFacetInput,
  type BrowserUiHost,
  type BrowserUiLocaleBinding,
  type BrowserUiView,
  type BrowserUiViewBinding,
} from '@dsh-std/ui-browser'

export const BROWSER_UI_API_VERSION = BROWSER_UI_PROTOCOL_VERSION
export const BROWSER_SETTINGS_SECTION_KIND = SETTINGS_SECTION.kind
export const BROWSER_TOOL_CALL_VIEW_KIND = TOOL_CALL_VIEW.kind
export const BROWSER_CLIENT_ACTIVATION_API_VERSION = BROWSER_UI_PROTOCOL_VERSION
export const BROWSER_CLIENT_ACTIVATION_KIND = LOCAL_MODULE_ACTIVATION_KIND

export const BROWSER_SETTINGS_SECTION = SETTINGS_SECTION

export const BROWSER_TOOL_CALL_VIEW = TOOL_CALL_VIEW

export type DshBrowserSettingsSectionContent = SettingsSectionContent

export type DshBrowserToolCallViewContent = ToolCallViewContent

/** Same-page React value consumed by the DSH browser slot registry. */
export type DshBrowserLocalView = BrowserUiView

export type DshBrowserLocalViewBinding = BrowserUiViewBinding

export type DshBrowserLocaleBinding = BrowserUiLocaleBinding

export type DshBrowserAttachment = BrowserUiAttachment

export type DshBrowserCommandResult = BrowserUiCommandResult

/** Narrow DSH product services available to same-page browser UI modules. */
export type DshBrowserLocalHost = BrowserUiHost

export type DshBrowserUiFacetInput = BrowserUiFacetInput

export type DshBrowserUiRuntimeFace = BrowserUiFacetHost

interface SlotRuntime {
  inject(name: string, setup: () => (() => void) | Iterable<() => void, void, void>): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshStdBrowserUi: DshBrowserUiRuntimeFace
  }
}

export const name = 'dsh-standard-browser-ui-adapter'
export const inject = ['slots', 'locale', 'remote', 'sessions']

/** Install browser-realm surface owners in every shell using the DSH client module graph. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const remote = ctx.remote as unknown as {
    $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>
  }
  const unmountRemote = await remote.$mount(DSH_STD_BROWSER_REMOTE)
  const commandRemote = ctx.get('remote.dshStd') as DshStdBrowserRemote | undefined
  if (commandRemote === undefined || typeof commandRemote.command !== 'function') {
    await unmountRemote()
    throw new Error('DSH browser UI adapter failed to mount its command Remote')
  }
  new DshBrowserUiRuntime(ctx, commandRemote)
  return unmountRemote
}

const DSH_STD_BROWSER_REMOTE: TypertRemoteContribution = Object.freeze({
  package: '@dsh-std/adapter-dsh',
  descriptors: Object.freeze([Object.freeze({
    id: '@dsh-std/adapter-dsh#dshStd/command',
    service: 'dshStd',
    namespace: 'dshStd',
    method: 'command',
    invocation: Object.freeze({ kind: 'direct' as const }),
    parameters: Object.freeze([
      remoteStringParameter('sessionId'),
      remoteStringParameter('line'),
    ]),
    result: Object.freeze({
      mode: 'strict' as const,
      typeSymbol: '@dsh-std/adapter-dsh#dshStd/command:result',
      schema: Object.freeze({ parse: parseBrowserCommandExecution }),
    }),
  })]),
})

/**
 * Browser-local facet runner. It negotiates concrete browser surfaces, then gives
 * the standard facet only its scoped ContributionHost client.
 */
export class DshBrowserUiRuntime extends Service implements DshBrowserUiRuntimeFace {
  private readonly providers: readonly UiContributionProvider[]

  constructor(ctx: Context, commandRemote?: DshStdBrowserRemote) {
    super(ctx, FACET_HOST_SERVICE)
    const slots = ctx.get('slots') as unknown as SlotRuntime | undefined
    if (slots === undefined) throw new Error('DSH browser UI adapter requires the client slot registry')
    const host = localHost(ctx, commandRemote)
    this.providers = Object.freeze([
      settingsSectionProvider(slots, host),
      toolCallViewProvider(slots, host),
    ])
  }

  async mountFacet(input: DshBrowserUiFacetInput): Promise<() => Promise<void>> {
    const manifest = defineComponentManifest(input.manifest)
    const facet = findFacet(manifest, input.facet)
    if (facet === undefined) throw new TypeError(`component has no browser UI facet ${JSON.stringify(input.facet)}`)
    if (facet.activation?.apiVersion !== BROWSER_CLIENT_ACTIVATION_API_VERSION
      || facet.activation.kind !== BROWSER_CLIENT_ACTIVATION_KIND) {
      throw new TypeError(`facet ${JSON.stringify(input.facet)} is not a DSH browser client facet`)
    }
    if (typeof input.module.activate !== 'function') throw new TypeError('Browser UI facet module must provide activate()')

    const requirements = facet.protocols?.requires ?? []
    for (const requirement of requirements) {
      if (!sameProtocol(requirement, { apiVersion: UI_API_VERSION, kind: CONTRIBUTION_HOST_KIND })) {
        throw new Error(`DSH browser UI adapter cannot provide ${requirement.apiVersion} ${requirement.kind}`)
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
        apiVersion: BROWSER_CLIENT_ACTIVATION_API_VERSION,
        kind: BROWSER_CLIENT_ACTIVATION_KIND,
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
    if (negotiated?.agreement === undefined) throw new Error('Browser UI facet did not negotiate ContributionHost')
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
      await closeFacet(input.module, scope, host.close, 'Browser UI facet activation failed')
      throw error
    }
    let active = true
    return async () => {
      if (!active) return
      active = false
      await closeFacet(input.module, scope, host.close, 'Browser UI facet unmounted')
    }
  }
}

/** Wrap a standard browser UI facet as an ordinary DSH client plugin entry. */
export function defineDshBrowserUiFacet(input: DshBrowserUiFacetInput): {
  readonly name: string
  readonly inject: readonly [typeof FACET_HOST_SERVICE]
  apply(ctx: ClientContext): Promise<void>
} {
  return defineBrowserUiFacet(input) as {
    readonly name: string
    readonly inject: readonly [typeof FACET_HOST_SERVICE]
    apply(ctx: ClientContext): Promise<void>
  }
}

export const browserSettingsSectionRequirement = settingsSectionRequirement

export const browserToolCallViewRequirement = toolCallViewRequirement

function settingsSectionProvider(slots: SlotRuntime, host: DshBrowserLocalHost): UiContributionProvider {
  const provider: UiContributionProvider = {
    participantId: 'dsh/browser/settings-section',
    support: { surfaces: [{ ...BROWSER_SETTINGS_SECTION, modes: ['local-module'] as const }] },
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

function toolCallViewProvider(slots: SlotRuntime, host: DshBrowserLocalHost): UiContributionProvider {
  const provider: UiContributionProvider = {
    participantId: 'dsh/browser/tool-call-view',
    support: { surfaces: [{ ...BROWSER_TOOL_CALL_VIEW, modes: ['local-module'] as const }] },
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

function settingsContent(contribution: UiContributionRegistration): DshBrowserSettingsSectionContent {
  const content = record(contribution.descriptor.content, 'Browser settings section content')
  nonEmpty(content.label, 'Browser settings section content.label')
  if (content.order !== undefined && (!Number.isInteger(content.order) || !Number.isSafeInteger(content.order))) {
    throw new TypeError('Browser settings section content.order must be a safe integer')
  }
  return { label: content.label, ...(content.order === undefined ? {} : { order: content.order as number }) }
}

function toolViewContent(contribution: UiContributionRegistration): DshBrowserToolCallViewContent {
  const content = record(contribution.descriptor.content, 'Browser tool call view content')
  nonEmpty(content.tool, 'Browser tool call view content.tool')
  return { tool: content.tool }
}

function localView(contribution: UiContributionRegistration): DshBrowserLocalView {
  const value = record(contribution.localModule, 'Browser local view')
  if (!Object.hasOwn(value, 'component')) throw new TypeError('Browser local view.component is required')
  if (value.inject !== undefined && typeof value.inject !== 'function') throw new TypeError('Browser local view.inject must be a function')
  if (value.locale !== undefined) nonEmpty(value.locale, 'Browser local view.locale')
  if (value.label !== undefined && typeof value.label !== 'string' && typeof value.label !== 'function') {
    throw new TypeError('Browser local view.label must be a string or function')
  }
  if (value.setup !== undefined && typeof value.setup !== 'function') throw new TypeError('Browser local view.setup must be a function')
  if (value.dispose !== undefined && typeof value.dispose !== 'function') throw new TypeError('Browser local view.dispose must be a function')
  return value as unknown as DshBrowserLocalView
}

function bindLocalView(view: DshBrowserLocalView, host: DshBrowserLocalHost): DshBrowserLocalViewBinding {
  const binding = view.setup?.(host) ?? view
  if (binding.inject !== undefined && typeof binding.inject !== 'function') throw new TypeError('Browser local view binding.inject must be a function')
  if (binding.locale !== undefined) nonEmpty(binding.locale, 'Browser local view binding.locale')
  if (binding.label !== undefined && typeof binding.label !== 'string' && typeof binding.label !== 'function') {
    throw new TypeError('Browser local view binding.label must be a string or function')
  }
  if (binding.dispose !== undefined && typeof binding.dispose !== 'function') throw new TypeError('Browser local view binding.dispose must be a function')
  return binding
}

function localHost(ctx: Context, commandRemote?: DshStdBrowserRemote): DshBrowserLocalHost {
  // Resolve the product services while the adapter's own fiber is active.
  // Cordis service proxies otherwise rebind property access to the calling
  // facet, which must not need to inject product-specific service names.
  const product = ctx as unknown as {
    locale: unknown
    sessions: unknown
  }
  const localeService = product.locale
  const sessionsService = product.sessions
  return Object.freeze({
    locale(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): DshBrowserLocaleBinding {
      nonEmpty(namespace, 'locale namespace')
      const locale = localeService as {
        register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
        bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
      } | undefined
      if (locale === undefined || typeof locale.register !== 'function' || typeof locale.bind !== 'function') {
        throw new Error('DSH browser locale service is unavailable')
      }
      const dispose = locale.register(namespace, dictionaries)
      return Object.freeze({ t: locale.bind(namespace), dispose })
    },
    async executeCommand(sessionId: string, line: string): Promise<DshBrowserCommandResult | undefined> {
      nonEmpty(sessionId, 'sessionId')
      nonEmpty(line, 'command line')
      if (commandRemote === undefined) throw new Error('DSH standard command Remote is unavailable')
      const result = await commandRemote.command(sessionId, line)
      if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
      return result.value?.result
    },
    async readAttachment(sessionId: string, attachmentId: string): Promise<DshBrowserAttachment> {
      nonEmpty(sessionId, 'sessionId')
      nonEmpty(attachmentId, 'attachmentId')
      const sessions = sessionsService as {
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

interface DshStdBrowserRemote {
  command(sessionId: string, line: string): Promise<RemoteResult<DshBrowserCommandResultEnvelope | undefined>>
}

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
        throw new Error('Browser UI facets cannot publish protocol implementations')
      },
    }),
    extensions: Object.freeze({
      publish(): () => void {
        throw new Error('Browser UI facets cannot publish manifest extensions')
      },
    }),
  })
}

class BrowserCleanupScope implements CleanupScope {
  private readonly controller = new AbortController()
  private readonly cleanups: Array<() => void | Promise<void>> = []
  get signal(): AbortSignal { return this.controller.signal }
  add(dispose: () => void | Promise<void>): () => void {
    if (this.controller.signal.aborted) throw new Error('Browser UI facet cleanup scope is closed')
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
    if (failures.length > 0) throw new AggregateError(failures, 'one or more Browser UI facet cleanups failed')
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
  if (failures.length > 0) throw new AggregateError(failures, 'Browser UI facet failed to close cleanly')
}

function remoteStringParameter(name: string) {
  return Object.freeze({
    name,
    wire: name,
    source: 'json' as const,
    codec: Object.freeze({
      mode: 'strict' as const,
      typeSymbol: `@dsh-std/adapter-dsh#dshStd/command:${name}`,
      schema: Object.freeze({
        parse(value: unknown): string {
          nonEmpty(value, `dshStd.command ${name}`)
          return value
        },
      }),
    }),
  })
}

function parseBrowserCommandExecution(value: unknown): DshBrowserCommandResultEnvelope | undefined {
  if (value === undefined) return undefined
  const execution = record(value, 'dshStd.command result')
  if (execution.apiVersion !== 'commands.dsh/v1alpha1') throw new TypeError('dshStd.command result.apiVersion is invalid')
  nonEmpty(execution.commandId, 'dshStd.command result.commandId')
  const result = record(execution.result, 'dshStd.command result.result')
  if (result.kind !== 'success' && result.kind !== 'error') throw new TypeError('dshStd.command result.result.kind is invalid')
  if (result.text !== undefined && typeof result.text !== 'string') throw new TypeError('dshStd.command result.result.text must be a string')
  if (result.kind === 'error' && (typeof result.text !== 'string' || result.text.trim() === '')) {
    throw new TypeError('dshStd.command error result requires text')
  }
  if (result.sourceEventSeq !== undefined
    && (!Number.isSafeInteger(result.sourceEventSeq) || (result.sourceEventSeq as number) < 0)) {
    throw new TypeError('dshStd.command result.result.sourceEventSeq must be a non-negative safe integer')
  }
  return value as DshBrowserCommandResultEnvelope
}

interface DshBrowserCommandResultEnvelope {
  readonly apiVersion: 'commands.dsh/v1alpha1'
  readonly commandId: string
  readonly result: DshBrowserCommandResult
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}
