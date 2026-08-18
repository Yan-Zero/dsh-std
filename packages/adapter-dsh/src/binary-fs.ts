/** DSH-host binary workspace publication used by standard local tools. */

import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

export interface WorkspaceTarget { readonly displayPath: string }
export type WorkspaceWriteIntent =
  | { readonly kind: 'createIfAbsent' }
  | { readonly kind: 'replaceIfVersion'; readonly version: unknown }
export interface WorkspaceSandboxPolicy {
  readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly workspaceRoot: string
}
export interface WorkspaceWriteOutcome {
  readonly operation: 'create' | 'update'
  readonly bytes: number
  readonly version: unknown
}
export interface WorkspaceFileSystem {
  readonly sandboxMode?: unknown
  resolve(path: string, options?: { readonly cwd?: unknown; readonly signal?: AbortSignal }): Promise<WorkspaceTarget>
  stat(target: WorkspaceTarget, signal?: AbortSignal): Promise<{ readonly type: string; readonly version: unknown } | undefined>
  readBytes(target: WorkspaceTarget, signal: AbortSignal, maxBytes: number): Promise<Uint8Array>
  fileUrl?(target: WorkspaceTarget): string | URL
  processPath?(target: WorkspaceTarget): string
  contains?(parent: WorkspaceTarget, child: WorkspaceTarget): boolean
  writeBytes?(
    target: WorkspaceTarget,
    data: Uint8Array,
    expected?: WorkspaceWriteIntent,
    signal?: AbortSignal,
    policy?: WorkspaceSandboxPolicy,
  ): Promise<WorkspaceWriteOutcome>
}

interface WorkspaceSandboxResolver {
  resolve(request?: { readonly session?: unknown }): WorkspaceSandboxPolicy
}

const localLocks = new Map<string, Promise<unknown>>()

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw signal.reason
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function withLocalLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const prior = localLocks.get(path) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  const tail = prior.then(() => current)
  localLocks.set(path, tail)
  await prior
  try {
    return await operation()
  } finally {
    release()
    if (localLocks.get(path) === tail) localLocks.delete(path)
  }
}

async function publishLocal(
  path: string,
  displayPath: string,
  content: Uint8Array,
  createIfAbsent: boolean,
  mode: number | undefined,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  const parent = dirname(path)
  await mkdir(parent, { recursive: true })
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx', mode ?? 0o600)
    await handle.writeFile(content, signal === undefined ? {} : { signal })
    await handle.sync()
    if (mode !== undefined && process.platform !== 'win32') await handle.chmod(mode)
    await handle.close()
    handle = undefined
    throwIfAborted(signal)
    if (createIfAbsent) {
      try {
        await link(temporary, path)
      } catch (error: unknown) {
        if (isCode(error, 'EEXIST')) {
          throw new Error(`cannot overwrite existing ${JSON.stringify(displayPath)} without reading it first`, { cause: error })
        }
        throw error
      }
    } else {
      await rename(temporary, path)
    }
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function resolveSandboxPolicy(ctx: Context, exec: ToolRunContext): WorkspaceSandboxPolicy | undefined {
  const resolver = ctx.get('sandboxPolicy') as unknown as WorkspaceSandboxResolver | undefined
  return resolver?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
}

async function checkedLocalTarget(
  fs: WorkspaceFileSystem,
  original: WorkspaceTarget,
  policy: WorkspaceSandboxPolicy | undefined,
  signal: AbortSignal,
): Promise<WorkspaceTarget> {
  if (fs.sandboxMode === undefined) return original
  if (policy === undefined) throw new Error('the active filesystem confines writes but its sandbox policy is unavailable')
  if (policy.mode === 'read-only') throw new Error(`cannot write ${JSON.stringify(original.displayPath)} under read-only mode`)
  if (policy.mode === 'danger-full-access') return original
  if (typeof fs.contains !== 'function') throw new Error('the active filesystem cannot validate its workspace boundary')
  const target = await fs.resolve(original.displayPath, { signal })
  const root = await fs.resolve(policy.workspaceRoot, { signal })
  if (!fs.contains(root, target)) throw new Error(`cannot write ${JSON.stringify(original.displayPath)} outside the active workspace`)
  return target
}

async function writeLocalBytes(
  fs: WorkspaceFileSystem,
  target: WorkspaceTarget,
  content: Uint8Array,
  expected: WorkspaceWriteIntent | undefined,
  policy: WorkspaceSandboxPolicy | undefined,
  signal: AbortSignal,
): Promise<WorkspaceWriteOutcome> {
  if (typeof fs.fileUrl !== 'function' || typeof fs.processPath !== 'function') {
    throw new Error('the active local filesystem cannot expose a safe native path for binary writes')
  }
  const checked = await checkedLocalTarget(fs, target, policy, signal)
  const native = fileURLToPath(fs.fileUrl(checked))
  if (native !== fs.processPath(checked)) throw new Error('local filesystem path and file URL disagree')
  return withLocalLock(native, async () => {
    throwIfAborted(signal)
    const before = await fs.stat(checked, signal)
    if (before !== undefined && before.type !== 'file') {
      throw new Error(`cannot write ${JSON.stringify(checked.displayPath)}: not a regular file`)
    }
    if (expected?.kind === 'replaceIfVersion' && (before === undefined || before.version !== expected.version)) {
      throw new Error(`cannot write ${JSON.stringify(checked.displayPath)}: file changed since it was read`)
    }
    if (expected?.kind === 'createIfAbsent' && before !== undefined) {
      throw new Error(`cannot overwrite existing ${JSON.stringify(checked.displayPath)} without reading it first`)
    }
    const nativeInfo = before === undefined ? undefined : await lstat(native)
    await publishLocal(native, checked.displayPath, content, expected?.kind === 'createIfAbsent', nativeInfo?.mode, signal)
    const after = await fs.stat(checked, signal)
    if (after === undefined) throw new Error(`cannot stat written ${JSON.stringify(checked.displayPath)}`)
    return { operation: before === undefined ? 'create' : 'update', version: after.version, bytes: content.byteLength }
  })
}

/** Publish bytes under DSH write-intent and sandbox policy. */
export async function writeWorkspaceBytes(
  ctx: Context,
  exec: ToolRunContext,
  fs: WorkspaceFileSystem,
  target: WorkspaceTarget,
  content: Uint8Array,
  expected?: WorkspaceWriteIntent,
): Promise<WorkspaceWriteOutcome> {
  const policy = resolveSandboxPolicy(ctx, exec)
  if (typeof fs.fileUrl === 'function' && new URL(fs.fileUrl(target)).protocol === 'file:') {
    return writeLocalBytes(fs, target, content, expected, policy, exec.signal)
  }
  if (typeof fs.writeBytes !== 'function') throw new Error('the active workspace provider cannot write binary files')
  return fs.writeBytes(target, content, expected, exec.signal, policy)
}
