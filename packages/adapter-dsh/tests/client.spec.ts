import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { defineComponentManifest } from '@dsh-std/manifest'
import { defineFacet } from '@dsh-std/sdk'
import {
  contributionHostRequirement,
  type ContributionHostClient,
} from '@dsh-std/ui'
import {
  DshWebUiRuntime,
  WEB_CLIENT_ACTIVATION_API_VERSION,
  WEB_CLIENT_ACTIVATION_KIND,
  WEB_SETTINGS_SECTION,
  WEB_TOOL_CALL_VIEW,
  webSettingsSectionRequirement,
  webToolCallViewRequirement,
  type DshWebLocalHost,
} from '../src/client.js'

describe('DSH Web UI adapter', () => {
  it('maps negotiated local UI contributions to live Web slots and retracts them with the facet', async () => {
    const entries: Array<{ name: string; options: Record<string, unknown>; component: unknown }> = []
    const slots = {
      inject(name: string, setup: () => () => void): () => void {
        const dispose = setup()
        return dispose
      },
      register(options: Record<string, unknown>, component: unknown): () => void {
        const entry = { name: String(options.name), options, component }
        entries.push(entry)
        return () => {
          const index = entries.indexOf(entry)
          if (index >= 0) entries.splice(index, 1)
        }
      },
    }
    const ctx = new Context()
    ctx.provide('slots', slots as never)
    const runtime = new DshWebUiRuntime(ctx)
    const settingsComponent = (): null => null
    const toolComponent = (): null => null
    const manifest = defineComponentManifest({
      apiVersion: 'manifest.dsh/internal/v1alpha1',
      kind: 'Component',
      metadata: { name: 'example.acme.web', version: '1.0.0' },
      spec: { facets: [{
        name: 'web',
        activation: {
          apiVersion: WEB_CLIENT_ACTIVATION_API_VERSION,
          kind: WEB_CLIENT_ACTIVATION_KIND,
          spec: { module: './client.js' },
        },
        protocols: { requires: [contributionHostRequirement({ surfaces: [
          webSettingsSectionRequirement(),
          webToolCallViewRequirement(),
        ] })] },
      }] },
    })
    const facet = defineFacet(activation => {
      const ui = activation.protocols.client<ContributionHostClient>({
        apiVersion: 'ui.dsh/v1alpha1', kind: 'ContributionHost',
      })
      expect(ui).toBeDefined()
      ui!.register({
        descriptor: {
          id: 'account', surface: WEB_SETTINGS_SECTION,
          content: { label: 'Account', order: 15 },
        },
        localModule: { component: settingsComponent },
      })
      ui!.register({
        descriptor: {
          id: 'imagegen', surface: WEB_TOOL_CALL_VIEW,
          content: { tool: 'imagegen' },
        },
        localModule: { component: toolComponent },
      })
    })

    const dispose = await runtime.mountFacet({ manifest, facet: 'web', module: facet })
    expect(entries).toEqual([
      expect.objectContaining({
        name: 'settings.section',
        options: expect.objectContaining({ id: 'account', label: 'Account', order: 15 }),
        component: settingsComponent,
      }),
      expect.objectContaining({
        name: 'tool.call.toolview',
        options: expect.objectContaining({ key: 'imagegen' }),
        component: toolComponent,
      }),
    ])
    await dispose()
    expect(entries).toEqual([])
  })

  it('resolves optional locale, command and attachment services only for a requesting contribution', async () => {
    const entries: Array<{ options: Record<string, unknown> }> = []
    const slots = {
      inject(_name: string, setup: () => () => void): () => void { return setup() },
      register(options: Record<string, unknown>): () => void {
        const entry = { options }; entries.push(entry)
        return () => { entries.splice(entries.indexOf(entry), 1) }
      },
    }
    let localeDisposed = false
    const ctx = new Context()
    ctx.provide('slots', slots as never)
    ctx.provide('locale', {
      register: () => () => { localeDisposed = true },
      bind: () => (key: string) => `translated:${key}`,
    } as never)
    ctx.provide('remote', { dshStd: { command: async () => ({
      ok: true, value: { result: { kind: 'success', text: 'done' } },
    }) } } as never)
    ctx.provide('sessions', { binding: () => ({ session: { readAttachment: async () => ({
      ok: true, value: { attachment: { mediaType: 'image/png', name: 'output.png' }, data: [1, 2, 3] },
    }) } }) } as never)
    const runtime = new DshWebUiRuntime(ctx)
    let host: DshWebLocalHost | undefined
    const manifest = defineComponentManifest({
      apiVersion: 'manifest.dsh/internal/v1alpha1', kind: 'Component',
      metadata: { name: 'example.acme.web-services', version: '1.0.0' },
      spec: { facets: [{
        name: 'web',
        activation: { apiVersion: WEB_CLIENT_ACTIVATION_API_VERSION, kind: WEB_CLIENT_ACTIVATION_KIND, spec: { module: './client.js' } },
        protocols: { requires: [contributionHostRequirement({ surfaces: [webSettingsSectionRequirement()] })] },
      }] },
    })
    const facet = defineFacet(activation => {
      activation.protocols.client<ContributionHostClient>({ apiVersion: 'ui.dsh/v1alpha1', kind: 'ContributionHost' })!.register({
        descriptor: { id: 'account', surface: WEB_SETTINGS_SECTION, content: { label: 'Account' } },
        localModule: {
          component: () => null,
          setup(value: DshWebLocalHost) {
            host = value
            const locale = value.locale('account', { en: { title: 'Account' } })
            return { label: () => locale.t('title'), dispose: locale.dispose }
          },
        },
      })
    })
    const dispose = await runtime.mountFacet({ manifest, facet: 'web', module: facet })
    expect((entries[0]!.options.label as () => string)()).toBe('translated:title')
    await expect(host!.executeCommand('session-1', '/account')).resolves.toEqual({ kind: 'success', text: 'done' })
    await expect(host!.readAttachment('session-1', 'attachment-1')).resolves.toEqual({
      mediaType: 'image/png', name: 'output.png', data: Uint8Array.from([1, 2, 3]),
    })
    await dispose()
    expect(localeDisposed).toBe(true)
    expect(entries).toEqual([])
  })
})
