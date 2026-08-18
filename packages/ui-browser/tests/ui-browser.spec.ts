import { describe, expect, it, vi } from 'vitest'
import { defineComponentManifest } from '@dsh-std/manifest'
import { defineFacet } from '@dsh-std/sdk'
import { defineBrowserUiFacet, FACET_HOST_SERVICE } from '../src/index.js'

describe('@dsh-std/ui-browser local module entry', () => {
  it('depends only on the negotiated browser-local facet host', async () => {
    const manifest = defineComponentManifest({
      apiVersion: 'manifest.dsh/internal/v1alpha1',
      kind: 'Component',
      metadata: { name: 'example.browser', version: '1.0.0' },
      spec: { facets: [{
        name: 'browser',
        activation: { apiVersion: 'browser.ui.dsh/v1alpha1', kind: 'LocalModule', spec: { module: './client.js' } },
      }] },
    })
    const module = defineFacet(() => undefined)
    const dispose = vi.fn(async () => undefined)
    const mountFacet = vi.fn(async () => dispose)
    let cleanup: (() => void | Promise<void>) | undefined
    const entry = defineBrowserUiFacet({ manifest, facet: 'browser', module })

    expect(entry.inject).toEqual([FACET_HOST_SERVICE])
    await entry.apply({
      get: name => name === FACET_HOST_SERVICE ? { mountFacet } : undefined,
      effect: setup => { cleanup = setup() as () => void | Promise<void> },
    })

    expect(mountFacet).toHaveBeenCalledWith({ manifest, facet: 'browser', module })
    await cleanup?.()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
