import type { ComponentManifest } from '@dsh-std/manifest'
import type { FacetModule } from '@dsh-std/sdk'
import type { UiSurfaceRequirement } from '@dsh-std/ui'

export const API_VERSION = 'browser.ui.dsh/v1alpha1'
export const SETTINGS_SECTION_KIND = 'SettingsSection'
export const TOOL_CALL_VIEW_KIND = 'ToolCallView'
export const LOCAL_MODULE_ACTIVATION_KIND = 'LocalModule'
export const FACET_HOST_SERVICE = 'dshStdBrowserUi'

export const SETTINGS_SECTION = Object.freeze({ apiVersion: API_VERSION, kind: SETTINGS_SECTION_KIND })
export const TOOL_CALL_VIEW = Object.freeze({ apiVersion: API_VERSION, kind: TOOL_CALL_VIEW_KIND })

export interface SettingsSectionContent {
  readonly label: string
  readonly order?: number
}

export interface ToolCallViewContent {
  readonly tool: string
}

export interface BrowserUiLocaleBinding {
  readonly t: (key: string, params?: Record<string, unknown>) => string
  dispose(): void
}

export interface BrowserUiCommandResult {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

export interface BrowserUiAttachment {
  readonly mediaType: string
  readonly name?: string
  readonly data: Uint8Array
}

export interface BrowserUiHost {
  locale(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): BrowserUiLocaleBinding
  executeCommand(contextId: string, line: string): Promise<BrowserUiCommandResult | undefined>
  readAttachment(contextId: string, attachmentId: string): Promise<BrowserUiAttachment>
}

export interface BrowserUiViewBinding {
  readonly inject?: (...args: unknown[]) => Record<string, unknown>
  readonly locale?: string
  readonly label?: string | (() => unknown)
  readonly dispose?: () => void | Promise<void>
}

export interface BrowserUiView {
  readonly component: unknown
  readonly inject?: (...args: unknown[]) => Record<string, unknown>
  readonly locale?: string
  readonly label?: string | (() => unknown)
  readonly dispose?: () => void | Promise<void>
  readonly setup?: (host: BrowserUiHost) => BrowserUiViewBinding
}

export interface BrowserUiFacetInput {
  readonly manifest: ComponentManifest
  readonly facet: string
  readonly module: FacetModule
}

export interface BrowserUiFacetHost {
  mountFacet(input: BrowserUiFacetInput): Promise<() => Promise<void>>
}

interface BrowserUiLoaderContext {
  get(name: typeof FACET_HOST_SERVICE): unknown
  effect(
    setup: () => (() => void | Promise<void>) | Promise<() => void | Promise<void>>,
    label?: string,
  ): unknown
}

export function settingsSectionRequirement(): UiSurfaceRequirement {
  return Object.freeze({ ...SETTINGS_SECTION, mode: 'local-module' })
}

export function toolCallViewRequirement(): UiSurfaceRequirement {
  return Object.freeze({ ...TOOL_CALL_VIEW, mode: 'local-module' })
}

/** Export a browser-realm local-module facet without importing a product adapter. */
export function defineBrowserUiFacet(input: BrowserUiFacetInput): {
  readonly name: string
  readonly inject: readonly [typeof FACET_HOST_SERVICE]
  apply(context: BrowserUiLoaderContext): Promise<void>
} {
  const name = `${input.manifest.metadata.name}-${input.facet}`
  return Object.freeze({
    name,
    inject: [FACET_HOST_SERVICE] as const,
    async apply(context: BrowserUiLoaderContext): Promise<void> {
      const host = context.get(FACET_HOST_SERVICE) as Partial<BrowserUiFacetHost> | undefined
      if (host === undefined || typeof host.mountFacet !== 'function') {
        throw new Error(`Browser UI facet ${JSON.stringify(name)} requires a compatible ${FACET_HOST_SERVICE}`)
      }
      const dispose = await host.mountFacet(input)
      context.effect(() => dispose, `Browser UI facet ${input.manifest.metadata.name}#${input.facet}`)
    },
  })
}
