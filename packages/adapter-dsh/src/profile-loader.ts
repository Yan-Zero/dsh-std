import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from './index.js'

export interface ProfileLoaderConfig {
  readonly profileBaseUrl?: string
}

export const name = 'dsh-standard-profile-loader'

/** Activate standard components after the Host has published its built-in participants. */
export async function apply(ctx: Context, config: ProfileLoaderConfig = {}): Promise<void> {
  const profileDir = profileDirectory(config.profileBaseUrl?.trim() || ctx.baseUrl)
  if (profileDir === undefined) return
  const disposers = await ctx.dshStd.mountProfileComponents(profileDir)
  ctx.effect(() => async () => {
    for (const dispose of [...disposers].reverse()) await dispose()
  }, '@dsh-std/adapter-dsh profile components')
}

apply.inject = ['dshStd']
apply.Config = z.object({ profileBaseUrl: z.string() })

function profileDirectory(baseUrl: string | URL | undefined): string | undefined {
  if (baseUrl === undefined) return undefined
  try {
    const path = fileURLToPath(typeof baseUrl === 'string' ? new URL(baseUrl) : baseUrl)
    return /[/\\]$/u.test(path) ? path.replace(/[/\\]+$/u, '') : dirname(path)
  } catch {
    return undefined
  }
}

export default apply
