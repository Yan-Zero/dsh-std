import { describe, expect, it, vi } from 'vitest'
import type { CapabilityHandlerContext, CapabilityImplementation } from '@dsh-std/connection'
import type { CreateSessionResult } from '@dsh-std/session/catalog'
import { DshSessionProtocolAdapter, type DshSessionControllerFace } from '../src/session-adapter.js'

interface FixtureEvent {
  type: string
  seq: number
  time: number
  data: unknown
}

interface FixtureSession {
  meta: {
    id: string
    createdAt: number
    parentSession?: string
    seedLength?: number
    origin?: 'subagent'
  }
  events: FixtureEvent[]
}

class FixtureController implements DshSessionControllerFace {
  readonly sessions = new Map<string, FixtureSession>()
  readonly createCalls: string[] = []
  readonly renameCalls: Array<{ sessionId: string; title: string }> = []
  followFrames: Array<{ type: 'snapshot'; cursor: number } | { type: 'event'; event: FixtureEvent }> = []

  async list(): Promise<{ items: Array<{ sessionId: string; origin?: 'subagent' }> }> {
    return {
      items: [...this.sessions.values()].map(session => ({
        sessionId: session.meta.id,
        ...(session.meta.origin === undefined ? {} : { origin: session.meta.origin }),
      })),
    }
  }

  async inspect(sessionId: string): Promise<FixtureSession> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      throw Object.assign(new Error('not found'), { code: 'session/not-found' })
    }
    return session
  }

  async create(request: { sessionId?: string }): Promise<{ sessionId: string }> {
    const sessionId = request.sessionId ?? 'generated'
    this.createCalls.push(sessionId)
    this.sessions.set(sessionId, { meta: { id: sessionId, createdAt: 1_000 }, events: [] })
    return { sessionId }
  }

  async rename(request: { sessionId: string; title: string }): Promise<{ title: string; seq: number }> {
    this.renameCalls.push(request)
    const session = await this.inspect(request.sessionId)
    const seq = session.events.length
    session.events.push({
      type: 'session/title', seq, time: 2_000 + seq,
      data: { title: request.title, source: { kind: 'user' } },
    })
    return { title: request.title, seq }
  }

  async *follow(): AsyncIterable<{ type: 'snapshot'; cursor: number } | { type: 'event'; event: FixtureEvent }> {
    yield* this.followFrames
  }
}

function fixture(): {
  controller: FixtureController
  catalog: CapabilityImplementation
  history: CapabilityImplementation
} {
  const controller = new FixtureController()
  const adapter = new DshSessionProtocolAdapter(
    'dsh/runtime',
    controller,
    type => type.startsWith('example/') ? 'required' : 'ignorable',
  )
  return {
    controller,
    catalog: adapter.implementations.find(row => row.protocol.kind === 'SessionCatalog')!,
    history: adapter.implementations.find(row => row.protocol.kind === 'SessionHistory')!,
  }
}

function context(
  progress: unknown[] = [],
  signal = new AbortController().signal,
  client: { connectionId?: string; instanceId?: string; participantId?: string } = {},
): CapabilityHandlerContext {
  const protocol = { apiVersion: 'session.dsh/v1alpha1', kind: 'SessionCatalog' }
  return {
    connectionId: client.connectionId ?? 'connection-1', planRevision: 1, invocationId: 'invocation-1',
    binding: {
      bindingId: 'binding-1', agreementId: 'agreement-1', planRevision: 1,
      consumer: {
        endpoint: { id: 'client', instanceId: client.instanceId ?? 'client-instance' },
        participantId: client.participantId ?? 'client/plugin',
      },
      provider: { endpoint: { id: 'dsh', instanceId: 'dsh-instance' }, participantId: 'dsh/runtime' },
      requirement: protocol, support: protocol,
    },
    signal, progress: value => { progress.push(value) },
  }
}

describe('DSH Session protocol adapter', () => {
  it('serves stable paginated catalog snapshots and excludes parent-qualified subagents', async () => {
    const { controller, catalog } = fixture()
    controller.sessions.set('session-a', {
      meta: { id: 'session-a', createdAt: 1_000 },
      events: [{ type: 'session/title', seq: 0, time: 1_100, data: { title: 'Alpha' } }],
    })
    controller.sessions.set('session-b', {
      meta: { id: 'session-b', createdAt: 2_000, parentSession: 'session-a', seedLength: 1 },
      events: [{ type: 'user/message', seq: 0, time: 2_100, data: { content: [] } }],
    })
    controller.sessions.set('child', {
      meta: { id: 'child', createdAt: 3_000, parentSession: 'session-a', origin: 'subagent' },
      events: [],
    })

    const first = await catalog.handle('list', { limit: 1 }, context()) as {
      sessions: Array<{ session: { id: string }; title?: string }>
      next: string
      catalogRevision: number
    }
    expect(first.sessions).toEqual([expect.objectContaining({
      session: { provider: 'dsh/runtime', id: 'session-a' }, title: 'Alpha',
    })])
    controller.sessions.delete('session-b')
    const second = await catalog.handle('list', { after: first.next, limit: 1 }, context()) as {
      sessions: Array<{ session: { id: string }; lineage?: unknown }>
      catalogRevision: number
    }
    expect(second.catalogRevision).toBe(first.catalogRevision)
    expect(second.sessions).toEqual([expect.objectContaining({
      session: { provider: 'dsh/runtime', id: 'session-b' },
      lineage: { parent: { provider: 'dsh/runtime', id: 'session-a' }, through: '0' },
    })])
  })

  it('maps create request ids idempotently and avoids duplicate title events', async () => {
    const { controller, catalog } = fixture()
    const input = { requestId: 'request-1', title: 'Portable title' }
    const first = await catalog.handle('create', input, context()) as { session: { session: { id: string } } }
    const second = await catalog.handle('create', input, context()) as { session: { session: { id: string } } }
    expect(second.session.session.id).toBe(first.session.session.id)
    expect(controller.createCalls).toEqual([first.session.session.id])
    expect(controller.renameCalls).toEqual([{ sessionId: first.session.session.id, title: 'Portable title' }])
  })

  it('replays the original create result without undoing a later rename', async () => {
    const { controller, catalog } = fixture()
    const input = { requestId: 'request-1', title: 'Original' }
    const first = await catalog.handle('create', input, context()) as CreateSessionResult
    await catalog.handle('rename', { session: first.session.session, title: 'User edited' }, context())

    const retry = await catalog.handle('create', input, { ...context(), invocationId: 'retry' })

    expect(retry).toEqual(first)
    expect(await catalog.handle('get', first.session.session, context())).toMatchObject({ title: 'User edited' })
    expect(controller.renameCalls.map(call => call.title)).toEqual(['Original', 'User edited'])
    expect(controller.createCalls).toHaveLength(1)
  })

  it.each([
    [{ title: 'Original' }, { title: 'Changed' }],
    [{}, { title: 'Added' }],
    [{ title: 'Original' }, {}],
  ])('rejects changed create input without writing to the existing session (%j -> %j)', async (original, changed) => {
    const { controller, catalog } = fixture()
    const first = await catalog.handle('create', { requestId: 'request-1', ...original }, context()) as CreateSessionResult
    const before = structuredClone(controller.sessions.get(first.session.session.id))

    await expect(catalog.handle('create', { requestId: 'request-1', ...changed }, context()))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' })

    expect(controller.sessions.get(first.session.session.id)).toEqual(before)
    expect(controller.createCalls).toHaveLength(1)
  })

  it('serializes concurrent retries into one creation and one title write', async () => {
    const { controller, catalog } = fixture()
    const input = { requestId: 'request-1', title: 'Original' }
    const [first, second] = await Promise.all([
      catalog.handle('create', input, context()),
      catalog.handle('create', input, { ...context(), invocationId: 'retry' }),
    ])
    expect(second).toEqual(first)
    expect(controller.createCalls).toHaveLength(1)
    expect(controller.renameCalls).toHaveLength(1)
  })

  it.each([
    { connectionId: 'connection-2' },
    { instanceId: 'other-client-instance' },
    { participantId: 'other/plugin' },
  ])('preserves the existing request-to-session mapping across caller changes (%j)', async client => {
    const { controller, catalog } = fixture()
    const input = { requestId: 'request-1', title: 'Original' }
    const first = await catalog.handle('create', input, context()) as CreateSessionResult
    await controller.rename({ sessionId: first.session.session.id, title: 'User edited' })
    const second = await catalog.handle('create', input, context([], undefined, client)) as CreateSessionResult
    expect(second).toEqual(first)
    expect(controller.createCalls).toHaveLength(1)
    expect(controller.renameCalls.map(call => call.title)).toEqual(['Original', 'User edited'])
  })

  it('retains the create receipt across plan revisions within the same client scope', async () => {
    const { catalog } = fixture()
    const input = { requestId: 'request-1', title: 'Original' }
    const first = await catalog.handle('create', input, context()) as CreateSessionResult
    await catalog.handle('rename', { session: first.session.session, title: 'User edited' }, context())
    const next = context()
    expect(await catalog.handle('create', input, {
      ...next, planRevision: 2,
      binding: { ...next.binding, planRevision: 2, bindingId: 'binding-2', agreementId: 'agreement-2' },
    })).toEqual(first)
  })

  it('finishes a title write that failed before committing without creating another session', async () => {
    const { controller, catalog } = fixture()
    vi.spyOn(controller, 'rename').mockRejectedValueOnce(new Error('temporary title failure'))
    const input = { requestId: 'request-1', title: 'Original' }
    await expect(catalog.handle('create', input, context())).rejects.toThrow('temporary title failure')
    expect(await catalog.handle('create', input, context())).toMatchObject({ session: { title: 'Original' } })
    expect(controller.createCalls).toHaveLength(1)
    expect(controller.renameCalls).toHaveLength(1)
  })

  it('does not repeat a title write that committed before its response failed', async () => {
    const { controller, catalog } = fixture()
    const rename = controller.rename.bind(controller)
    vi.spyOn(controller, 'rename').mockImplementationOnce(async input => {
      await rename(input)
      throw new Error('title response lost')
    })
    const input = { requestId: 'request-1', title: 'Original' }
    await expect(catalog.handle('create', input, context())).rejects.toThrow('title response lost')
    const sessionId = controller.createCalls[0]!
    await rename({ sessionId, title: 'User edited' })

    expect(await catalog.handle('create', input, context())).toMatchObject({ session: { title: 'User edited' } })
    expect(controller.renameCalls.map(call => call.title)).toEqual(['Original', 'User edited'])
    expect(controller.createCalls).toHaveLength(1)
  })

  it('recovers when creation committed before its response failed', async () => {
    const { controller, catalog } = fixture()
    const create = controller.create.bind(controller)
    vi.spyOn(controller, 'create').mockImplementationOnce(async input => {
      await create(input)
      throw new Error('create response lost')
    })
    const input = { requestId: 'request-1', title: 'Original' }
    await expect(catalog.handle('create', input, context())).rejects.toThrow('create response lost')
    expect(await catalog.handle('create', input, context())).toMatchObject({ session: { title: 'Original' } })
    expect(controller.createCalls).toHaveLength(1)
  })

  it('rejects changed input even when the first create has not finished', async () => {
    const { controller, catalog } = fixture()
    vi.spyOn(controller, 'rename').mockRejectedValueOnce(new Error('temporary title failure'))
    const input = { requestId: 'request-1', title: 'Original' }
    await expect(catalog.handle('create', input, context())).rejects.toThrow('temporary title failure')
    await expect(catalog.handle('create', { ...input, title: 'Changed' }, context()))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(await catalog.handle('create', input, context())).toMatchObject({ session: { title: 'Original' } })
    expect(controller.renameCalls.map(call => call.title)).toEqual(['Original'])
  })

  it('resumes initialization after cancellation without creating another session', async () => {
    const { controller, catalog } = fixture()
    const abort = new AbortController()
    const create = controller.create.bind(controller)
    vi.spyOn(controller, 'create').mockImplementationOnce(async input => {
      const result = await create(input)
      abort.abort(new Error('cancelled after create'))
      return result
    })
    const input = { requestId: 'request-1', title: 'Original' }
    await expect(catalog.handle('create', input, context([], abort.signal)))
      .rejects.toThrow('cancelled after create')
    expect(controller.renameCalls).toHaveLength(0)
    expect(await catalog.handle('create', input, context())).toMatchObject({ session: { title: 'Original' } })
    expect(controller.createCalls).toHaveLength(1)
  })

  it.each([{}, { title: 'Original' }])('adopts an existing session without reinitializing its title after adapter recreation (%j)', async original => {
    const { controller, catalog } = fixture()
    const input = { requestId: 'request-1', ...original }
    const first = await catalog.handle('create', input, context()) as CreateSessionResult
    await controller.rename({ sessionId: first.session.session.id, title: 'User edited' })
    const recreated = new DshSessionProtocolAdapter('dsh/runtime', controller, () => 'ignorable')
      .implementations.find(row => row.protocol.kind === 'SessionCatalog')!
    const before = controller.renameCalls.length

    expect(await recreated.handle('create', input, context())).toMatchObject({
      session: { session: first.session.session, title: 'User edited' },
    })
    expect(controller.createCalls).toHaveLength(1)
    expect(controller.renameCalls).toHaveLength(before)
  })

  it('translates durable event cursors, direction and replay classification', async () => {
    const { controller, history } = fixture()
    controller.sessions.set('session-a', {
      meta: { id: 'session-a', createdAt: 1_000 },
      events: [
        { type: 'user/message', seq: 0, time: 1_100, data: { text: 'a' } },
        { type: 'example/fact', seq: 1, time: 1_200, data: { value: 1 } },
        { type: 'assistant/message', seq: 2, time: 1_300, data: { text: 'b' } },
      ],
    })
    const session = { provider: 'dsh/runtime', id: 'session-a' }
    const page = await history.handle('read', {
      session, after: '0', direction: 'backward', limit: 1,
    }, context()) as { events: Array<{ cursor: string; replay: string }>; hasMore: boolean }
    expect(page).toMatchObject({ events: [{ cursor: '2', replay: 'ignorable' }], hasMore: true })
    await expect(history.handle('read', { session, after: '9' }, context()))
      .rejects.toThrow('cursor does not exist')
  })

  it('uses the product snapshot as the gap-free follow boundary', async () => {
    const { controller, history } = fixture()
    const events: FixtureEvent[] = [
      { type: 'user/message', seq: 0, time: 1_100, data: {} },
      { type: 'example/fact', seq: 1, time: 1_200, data: { value: 1 } },
      { type: 'assistant/message', seq: 2, time: 1_300, data: {} },
    ]
    controller.sessions.set('session-a', {
      meta: { id: 'session-a', createdAt: 1_000 }, events,
    })
    controller.followFrames = [
      { type: 'snapshot', cursor: 1 },
      { type: 'event', event: events[2]! },
    ]
    const progress: unknown[] = []
    await history.handle('follow', {
      session: { provider: 'dsh/runtime', id: 'session-a' }, after: '0',
    }, context(progress))
    expect(progress).toEqual([
      { type: 'ready', session: { provider: 'dsh/runtime', id: 'session-a' }, boundary: '1' },
      { type: 'event', event: expect.objectContaining({ cursor: '1', replay: 'required' }) },
      { type: 'event', event: expect.objectContaining({ cursor: '2', replay: 'ignorable' }) },
    ])
  })
})
