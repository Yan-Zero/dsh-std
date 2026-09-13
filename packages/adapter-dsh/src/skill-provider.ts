import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type SkillRegistry from '@deepseek-ai/dsh-skill'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from '@deepseek-ai/dsh-skill'
import {
  resolveSkillInvocation,
  validateSkillSpec,
  type SkillResource,
} from '@dsh-std/skill'

const PROVIDER_NAME = 'dsh-std'
// DSH defines 600 as the packaged/bundled provider rank in both supported
// adapter peer lines. The rank is a product mapping detail, not Skill protocol data.
const DSH_BUNDLED_SKILL_RANK = 600

export interface StandardSkillOwner {
  readonly component: string
  readonly version: string
  readonly facet: string
  readonly instanceId: string
  readonly participantId: string
}

interface StandardSkillEntry {
  readonly resource: SkillResource
  readonly owner: StandardSkillOwner
  readonly packageRoot: string
  readonly entryPath: string
  active: boolean
}

/** DSH-native provider projection for active standard Skill resources. */
export class DshStandardSkillProvider implements SkillProvider {
  readonly name = PROVIDER_NAME
  private readonly entries = new Map<string, StandardSkillEntry>()

  constructor(private readonly control: SkillProviderControl) {}

  register(resource: SkillResource, packageRoot: string, owner: StandardSkillOwner): () => void {
    this.control.signal.throwIfAborted()
    const spec = validateSkillSpec(resource.spec)
    if (!isAbsolute(packageRoot)) throw new TypeError('standard Skill packageRoot must be absolute')
    const root = resolve(packageRoot)
    const entryPath = resolve(root, ...spec.entry.split('/'))
    assertContained(root, entryPath, 'standard Skill entry')
    const name = resource.metadata.name
    if (this.entries.has(name)) throw new Error(`standard Skill ${JSON.stringify(name)} is already active`)
    const entry: StandardSkillEntry = { resource, owner, packageRoot: root, entryPath, active: true }
    this.entries.set(name, entry)
    this.control.invalidate()
    return () => {
      if (!entry.active) return
      entry.active = false
      if (this.entries.get(name) === entry) this.entries.delete(name)
      this.control.invalidate()
    }
  }

  list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    options.signal?.throwIfAborted()
    this.control.signal.throwIfAborted()
    return Promise.resolve(Object.freeze([...this.entries.values()]
      .sort((left, right) => left.resource.metadata.name.localeCompare(right.resource.metadata.name))
      .map(entry => this.candidate(entry))))
  }

  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    options.signal?.throwIfAborted()
    this.control.signal.throwIfAborted()
    const entry = candidate.locator as StandardSkillEntry
    if (!entry.active || this.entries.get(entry.resource.metadata.name) !== entry) return undefined

    const [root, entryPath] = await Promise.all([
      realpath(entry.packageRoot),
      realpath(entry.entryPath),
    ])
    assertContained(root, entryPath, 'resolved standard Skill entry')
    const bytes = await readFile(entryPath, { signal: options.signal })
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    this.control.signal.throwIfAborted()
    if (!entry.active || this.entries.get(entry.resource.metadata.name) !== entry) return undefined
    return Object.freeze({
      ...this.summary(entry),
      path: entryPath,
      content,
    })
  }

  private candidate(entry: StandardSkillEntry): SkillCandidate {
    return Object.freeze({
      ...this.summary(entry),
      rank: DSH_BUNDLED_SKILL_RANK,
      locator: entry,
    })
  }

  private summary(entry: StandardSkillEntry): Omit<SkillDefinition, 'content'> {
    const spec = validateSkillSpec(entry.resource.spec)
    const invocation = resolveSkillInvocation(spec.invocation)
    return Object.freeze({
      name: entry.resource.metadata.name,
      description: spec.description,
      invocation: Object.freeze({
        modelInvocable: invocation.model,
        userInvocable: invocation.user,
      }),
      source: 'bundled',
      provider: PROVIDER_NAME,
    })
  }
}

export function installDshStandardSkillProvider(
  registry: Pick<SkillRegistry, 'registerProvider'>,
): { readonly provider: DshStandardSkillProvider; readonly dispose: () => void } {
  let provider: DshStandardSkillProvider | undefined
  const dispose = registry.registerProvider((control) => {
    provider = new DshStandardSkillProvider(control)
    return provider
  })
  if (provider === undefined) {
    dispose()
    throw new Error('DSH Skill registry did not create the standard provider synchronously')
  }
  return Object.freeze({ provider, dispose })
}

function assertContained(root: string, target: string, label: string): void {
  const inside = relative(root, target)
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new TypeError(`${label} must resolve to a file inside the plugin package`)
  }
}
